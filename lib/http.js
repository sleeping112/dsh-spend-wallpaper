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

async function stateResource(runtime, request) {
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

function createControlHandler(runtime) {
  return (req, res) => {
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

function createRefreshHandler(runtime) {
  return (req, res) => {
    if (!nodeRequestAllowed(req)) return plain(res, 403, 'forbidden')
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    Promise.resolve(runtime.refresh())
      .then((snapshot) => json(res, 200, snapshot))
      .catch((error) => json(res, 500, { error: 'refresh-failed', message: String(error.message ?? error) }))
  }
}

function createScenesHandler(runtime) {
  return async (req, res) => {
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
      let body
      try { body = await fs.readFile(info.path) } catch { return plain(res, 404, 'not found') }
      const total = body.length
      const rangeHeader = req.headers.range
      const headers = {
        'content-type': info.contentType,
        'cache-control': 'no-cache',
        'accept-ranges': 'bytes',
        'x-content-type-options': 'nosniff',
      }
      if (typeof rangeHeader === 'string') {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
        if (match !== null) {
          let start = match[1] === '' ? 0 : Number(match[1])
          let end = match[2] === '' ? total - 1 : Number(match[2])
          if (Number.isFinite(start) && Number.isFinite(end)) {
            start = Math.max(0, Math.min(total - 1, start))
            end = Math.max(start, Math.min(total - 1, end))
            const chunk = body.subarray(start, end + 1)
            res.writeHead(206, {
              ...headers,
              'content-range': `bytes ${start}-${end}/${total}`,
              'content-length': chunk.length,
            })
            res.end(req.method === 'HEAD' ? undefined : chunk)
            return
          }
        }
      }
      res.writeHead(200, { ...headers, 'content-length': total })
      res.end(req.method === 'HEAD' ? undefined : body)
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
  const disposers = []
  disposers.push(server.register({ kind: 'exact', path: `${ROUTE_PREFIX}/state`, resource: (request) => stateResource(runtime, request) }))
  disposers.push(server.register({ kind: 'prefix', path: `${ROUTE_PREFIX}/scenes`, handler: createScenesHandler(runtime) }))
  disposers.push(server.register({ kind: 'exact', path: `${ROUTE_PREFIX}/refresh`, handler: createRefreshHandler(runtime) }))
  disposers.push(server.register({ kind: 'exact', path: `${ROUTE_PREFIX}/config`, handler: createControlHandler(runtime) }))
  return () => {
    for (const dispose of disposers) {
      try { dispose() } catch { /* ignore */ }
    }
  }
}
