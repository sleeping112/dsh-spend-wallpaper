import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'

const PLUGIN_ID = 'dsh-spend-wallpaper'
const ROUTE_PREFIX = `/plugins/${PLUGIN_ID}`

function json(res, status, payload) {
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function plain(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function originHost(origin) {
  try { return new URL(origin).host } catch { return null }
}

export function requestAllowed(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  if (origin !== null) {
    const host = request.headers.get('host')
    if (host !== null && originHost(origin) !== host) return false
  }
  return true
}

export function nodeRequestAllowed(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    const host = req.headers.host
    if (typeof host === 'string' && originHost(origin) !== host) return false
  }
  return true
}

/**
 * Parse one HTTP byte range against a file size.
 * Returns null when the header is absent/malformed (serve the whole file),
 * `{ unsatisfiable: true }` for a syntactically valid range outside the file,
 * or inclusive `{ start, end }` byte offsets.
 */
export function parseByteRange(header, total) {
  if (typeof header !== 'string') return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null
  const [, startText, endText] = match
  if (startText === '' && endText === '') return { unsatisfiable: true }
  let start
  let end
  if (startText === '') {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || total === 0) return { unsatisfiable: true }
    start = Math.max(0, total - suffix)
    end = total - 1
  } else {
    start = Number(startText)
    end = endText === '' ? total - 1 : Number(endText)
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { unsatisfiable: true }
  if (start < 0 || start >= total || start > end) return { unsatisfiable: true }
  return { start, end: Math.min(end, total - 1) }
}

function rejectionText(status) {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  return 'unavailable'
}

/**
 * DSH's Connection guard: rejects unauthenticated requests and requests whose
 * Host/Origin does not belong to this listener. A plugin route registered on
 * `webServer` is outside DSH's own `/api` fence, so it must apply this itself.
 * Returns a status (401/403/503) or undefined when the request may proceed.
 */
function requestRejection(connection, request) {
  try {
    return connection.requestRejection(request)
  } catch {
    return 503
  }
}

async function stateResource(connection, runtime, request) {
  const rejected = requestRejection(connection, request)
  if (rejected !== undefined) return new Response(rejectionText(rejected), { status: rejected })
  if (!requestAllowed(request)) return new Response('forbidden', { status: 403 })
  return new Response(JSON.stringify(runtime.snapshot()), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('upload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function readJsonBody(req, limit = 16 * 1024) {
  return readBody(req, limit).then((buffer) => {
    if (buffer.length === 0) return {}
    try { return JSON.parse(buffer.toString('utf8')) } catch { throw new Error('invalid JSON body') }
  })
}

function createControlHandler(runtime, connection) {
  return (req, res) => {
    const rejected = requestRejection(connection, req)
    if (rejected !== undefined) return plain(res, rejected, rejectionText(rejected))
    if (!nodeRequestAllowed(req)) return plain(res, 403, 'forbidden')
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req)
      .then((body) => {
        const result = runtime.applyOverrides(body)
        if (result.ok) json(res, 200, result.snapshot)
        else json(res, 400, { ok: false, errors: result.errors })
      })
      .catch((error) => json(res, 400, { ok: false, errors: [String(error.message ?? error)] }))
  }
}

function createRefreshHandler(runtime, connection) {
  return (req, res) => {
    const rejected = requestRejection(connection, req)
    if (rejected !== undefined) return plain(res, rejected, rejectionText(rejected))
    if (!nodeRequestAllowed(req)) return plain(res, 403, 'forbidden')
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    Promise.resolve(runtime.refresh())
      .then((snapshot) => json(res, 200, snapshot))
      .catch((error) => json(res, 500, { error: 'refresh-failed', message: String(error.message ?? error) }))
  }
}

function createScenesHandler(runtime, connection) {
  return async (req, res) => {
    const rejected = requestRejection(connection, req)
    if (rejected !== undefined) return plain(res, rejected, rejectionText(rejected))
    if (!nodeRequestAllowed(req)) return plain(res, 403, 'forbidden')
    let url
    try { url = new URL(req.url, 'http://127.0.0.1') } catch { return plain(res, 404, 'not found') }
    const match = /^\/plugins\/dsh-spend-wallpaper\/scenes\/(\d+)(\/reset)?$/.exec(url.pathname)
    if (!match) return plain(res, 404, 'not found')
    const index = Number(match[1])
    const reset = match[2] === '/reset'
    if (req.method === 'GET' || req.method === 'HEAD') {
      const kind = url.searchParams.get('kind')
      const info = runtime.sceneFile(index, kind)
      if (!info) return plain(res, 404, 'not found')
      let total
      try { total = (await fs.stat(info.path)).size } catch { return plain(res, 404, 'not found') }
      const headers = {
        'content-type': info.contentType,
        'cache-control': 'no-cache',
        'accept-ranges': 'bytes',
        'x-content-type-options': 'nosniff',
      }
      const range = typeof req.headers.range === 'string'
        ? parseByteRange(req.headers.range, total)
        : null
      if (range?.unsatisfiable === true) {
        res.writeHead(416, {
          ...headers,
          'content-range': `bytes */${total}`,
          'content-length': 0,
        })
        res.end()
        return
      }
      const start = range === null ? 0 : range.start
      const end = range === null ? Math.max(0, total - 1) : range.end
      const length = total === 0 ? 0 : end - start + 1
      const status = range === null ? 200 : 206
      res.writeHead(status, {
        ...headers,
        'content-length': length,
        ...(range === null ? {} : { 'content-range': `bytes ${start}-${end}/${total}` }),
      })
      if (req.method === 'HEAD' || length === 0) {
        res.end()
        return
      }
      const stream = createReadStream(info.path, { start, end })
      stream.on('error', () => {
        try { res.destroy() } catch { /* response already gone */ }
      })
      res.on('close', () => stream.destroy())
      stream.pipe(res)
      return
    }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'GET, HEAD, POST' }); res.end(); return }
    if (reset) {
      const result = runtime.resetScene(index)
      if (result.ok) json(res, 200, result.snapshot)
      else json(res, 400, { ok: false, errors: result.errors })
      return
    }
    try {
      const body = await readBody(req)
      const result = runtime.uploadScene(index, body, req.headers['content-type'])
      if (result.ok) json(res, 200, result.snapshot)
      else json(res, 400, { ok: false, errors: result.errors })
    } catch (error) {
      json(res, 400, { ok: false, errors: [String(error.message ?? error)] })
    }
  }
}

export function registerRoutes(ctx, runtime) {
  const server = ctx.webServer
  const connection = ctx.connection
  if (typeof connection?.requestRejection !== 'function') {
    throw new Error('dsh-spend-wallpaper: the connection service is required for authenticated HTTP routes')
  }
  const disposers = []
  disposers.push(server.register({ kind: 'exact', path: `${ROUTE_PREFIX}/state`, resource: (request) => stateResource(connection, runtime, request) }))
  disposers.push(server.register({ kind: 'prefix', path: `${ROUTE_PREFIX}/scenes`, handler: createScenesHandler(runtime, connection) }))
  disposers.push(server.register({ kind: 'exact', path: `${ROUTE_PREFIX}/refresh`, handler: createRefreshHandler(runtime, connection) }))
  disposers.push(server.register({ kind: 'exact', path: `${ROUTE_PREFIX}/config`, handler: createControlHandler(runtime, connection) }))
  return () => {
    for (const dispose of disposers) {
      try { dispose() } catch { /* ignore */ }
    }
  }
}
