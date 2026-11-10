/**
 * HTTP surface for the browser half.
 *
 * Routes live under `/plugins/dsh-spend-wallpaper/` and are deliberately
 * read-mostly: the writes are the POST refresh trigger and the POST config
 * quick-switch handler. `resource` handlers answer GET/HEAD; the POST routes use
 * raw node handlers because the host webserver refuses non-GET resource requests.
 *
 * The host webserver provides no authentication of its own, so every route
 * applies the same small same-origin fence (cross-site fetches and mismatched
 * Origin headers are refused). The server binds to loopback by default.
 */

import fs from 'node:fs/promises'

export const PLUGIN_ID = 'dsh-spend-wallpaper'
export const ROUTE_PREFIX = `/plugins/${PLUGIN_ID}`
// The webserver matches a prefix route by `pathname === prefix` or
// `pathname.startsWith(prefix + '/')`, so the registered prefix must not end
// with a slash; asset URLs append `/<pack>/<file>` to it.
export const ASSET_PREFIX = `${ROUTE_PREFIX}/assets`

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function plainResponse(status, message) {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function originHost(origin) {
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

/** Same-origin fence for Fetch `Request` resources. */
export function requestAllowed(request) {
  const site = request.headers.get('sec-fetch-site')
  if (site === 'cross-site') return false
  const origin = request.headers.get('origin')
  if (origin !== null) {
    const host = request.headers.get('host')
    if (host !== null && originHost(origin) !== host) return false
  }
  return true
}

/** Same fence for raw node requests (the POST refresh handler). */
export function nodeRequestAllowed(req) {
  const header = req.headers['sec-fetch-site']
  if (header === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    const host = req.headers.host
    if (typeof host === 'string' && originHost(origin) !== host) return false
  }
  return true
}

async function stateResource(runtime, request) {
  if (!requestAllowed(request)) return plainResponse(403, 'forbidden')
  return jsonResponse(runtime.snapshot())
}

async function packsResource(runtime, request) {
  if (!requestAllowed(request)) return plainResponse(403, 'forbidden')
  return jsonResponse(runtime.packsSnapshot())
}

async function assetsResource(runtime, request) {
  if (!requestAllowed(request)) return plainResponse(403, 'forbidden')
  const url = new URL(request.url)
  if (url.pathname !== ASSET_PREFIX && !url.pathname.startsWith(`${ASSET_PREFIX}/`)) {
    return plainResponse(404, 'not found')
  }
  let decoded
  try {
    decoded = decodeURIComponent(url.pathname.slice(ASSET_PREFIX.length))
  } catch {
    return plainResponse(404, 'not found')
  }
  const segments = decoded.split('/').filter((segment) => segment.length > 0)
  if (segments.length !== 2) return plainResponse(404, 'not found')
  const [packId, name] = segments
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(packId)) return plainResponse(404, 'not found')
  const info = runtime.packFile(packId, name)
  if (info === null) return plainResponse(404, 'not found')
  const etag = `"${packId}/${name}-${Math.round(info.mtimeMs)}"`
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': 'public, max-age=3600' } })
  }
  let body
  try {
    body = await fs.readFile(info.path)
  } catch {
    return plainResponse(404, 'not found')
  }
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': info.contentType,
      'cache-control': 'public, max-age=3600',
      etag,
      'x-content-type-options': 'nosniff',
    },
  })
}

function readJsonBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function createControlHandler(runtime) {
  return (req, res) => {
    if (!nodeRequestAllowed(req)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('forbidden')
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    readJsonBody(req)
      .then((body) => {
        const result = runtime.applyOverrides(body)
        const payload = result.ok ? result.snapshot : { ok: false, errors: result.errors }
        const text = JSON.stringify(payload)
        res.writeHead(result.ok ? 200 : 400, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(text),
        })
        res.end(text)
      })
      .catch((error) => {
        const text = JSON.stringify({ ok: false, errors: [String(error instanceof Error ? error.message : error)] })
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(text)
      })
  }
}

function createRefreshHandler(runtime) {
  return (req, res) => {
    if (!nodeRequestAllowed(req)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('forbidden')
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    Promise.resolve(runtime.refresh())
      .then((snapshot) => {
        const body = JSON.stringify(snapshot)
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(body),
        })
        res.end(body)
      })
      .catch((error) => {
        const body = JSON.stringify({
          error: 'refresh-failed',
          message: String(error instanceof Error ? error.message : error).slice(0, 200),
        })
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(body)
      })
  }
}

/**
 * Register every plugin route on the host webserver.
 * @returns {() => void} disposer removing all routes again
 */
export function registerRoutes(ctx, runtime) {
  const server = ctx.webServer
  const disposers = []
  disposers.push(server.register({ kind: 'exact', path: `${ROUTE_PREFIX}/state`, resource: (request) => stateResource(runtime, request) }))
  disposers.push(server.register({ kind: 'exact', path: `${ROUTE_PREFIX}/packs`, resource: (request) => packsResource(runtime, request) }))
  disposers.push(server.register({ kind: 'prefix', path: ASSET_PREFIX, resource: (request) => assetsResource(runtime, request) }))
  disposers.push(server.register({ kind: 'exact', path: `${ROUTE_PREFIX}/refresh`, handler: createRefreshHandler(runtime) }))
  disposers.push(server.register({ kind: 'exact', path: `${ROUTE_PREFIX}/config`, handler: createControlHandler(runtime) }))
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // Ignore double-dispose during reload.
      }
    }
  }
}
