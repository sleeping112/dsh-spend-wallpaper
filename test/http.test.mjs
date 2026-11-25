/**
 * Route-admission tests: every plugin HTTP route must run DSH's Connection
 * guard (`ctx.connection.requestRejection`) before doing any work.
 *
 * Run with: node --test
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import { parseByteRange, registerRoutes } from '../lib/http.js'

const PREFIX = '/plugins/dsh-spend-wallpaper'

function createRuntime() {
  const calls = []
  return {
    calls,
    snapshot() {
      calls.push('snapshot')
      return { schema: 1, spend1h: '0.4' }
    },
    async refresh() {
      calls.push('refresh')
      return { schema: 1, spend1h: '0.5' }
    },
    applyOverrides(body) {
      calls.push('applyOverrides')
      return { ok: true, snapshot: { ...body } }
    },
    sceneFile() {
      calls.push('sceneFile')
      return null
    },
    resetScene() {
      calls.push('resetScene')
      return { ok: true, snapshot: {} }
    },
    uploadScene() {
      calls.push('uploadScene')
      return { ok: true, snapshot: {} }
    },
  }
}

function createContext(rejection) {
  const routes = new Map()
  const seen = []
  const ctx = {
    webServer: {
      protocol: 'http:',
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    connection: {
      requestRejection(request) {
        seen.push(request)
        return typeof rejection === 'function' ? rejection(request) : rejection
      },
    },
  }
  return { ctx, routes, seen }
}

function nodeRequest({ method = 'GET', url = `${PREFIX}/scenes/0`, headers = {} } = {}) {
  return { method, url, headers, on() {} }
}

function nodeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers ?? {}
      return this
    },
    end(body) {
      this.body = body
    },
  }
}

function stateRequest(headers = {}) {
  return new Request(`http://127.0.0.1:1234${PREFIX}/state`, { headers })
}

test('registration fails closed when the connection service is missing', () => {
  assert.throws(
    () => registerRoutes({ webServer: { register() {} } }, createRuntime()),
    /connection service is required/,
  )
})

test('state rejects with the status returned by the Connection guard', async () => {
  const runtime = createRuntime()
  const { ctx, routes, seen } = createContext(403)
  registerRoutes(ctx, runtime)
  const request = stateRequest()
  const response = await routes.get(`${PREFIX}/state`).resource(request)
  assert.equal(response.status, 403)
  assert.equal(await response.text(), 'forbidden')
  assert.equal(seen[0], request)
  assert.deepEqual(runtime.calls, [])
})

test('state reports 401 for an unauthenticated request', async () => {
  const runtime = createRuntime()
  const { ctx, routes } = createContext(401)
  registerRoutes(ctx, runtime)
  const response = await routes.get(`${PREFIX}/state`).resource(stateRequest())
  assert.equal(response.status, 401)
  assert.equal(await response.text(), 'unauthorized')
  assert.deepEqual(runtime.calls, [])
})

test('state reports 503 when the Connection guard itself fails', async () => {
  const runtime = createRuntime()
  const { ctx, routes } = createContext(() => {
    throw new Error('connection disposed')
  })
  registerRoutes(ctx, runtime)
  const response = await routes.get(`${PREFIX}/state`).resource(stateRequest())
  assert.equal(response.status, 503)
  assert.deepEqual(runtime.calls, [])
})

test('state serves the snapshot for an admitted request', async () => {
  const runtime = createRuntime()
  const { ctx, routes } = createContext(undefined)
  registerRoutes(ctx, runtime)
  const response = await routes.get(`${PREFIX}/state`).resource(stateRequest())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { schema: 1, spend1h: '0.4' })
  assert.deepEqual(runtime.calls, ['snapshot'])
})

test('state keeps the same-origin fence even when DSH admits the request', async () => {
  const runtime = createRuntime()
  const { ctx, routes } = createContext(undefined)
  registerRoutes(ctx, runtime)
  const request = stateRequest({ 'sec-fetch-site': 'cross-site' })
  const response = await routes.get(`${PREFIX}/state`).resource(request)
  assert.equal(response.status, 403)
  assert.deepEqual(runtime.calls, [])
})

test('scenes refuses before reading the scene', async () => {
  const runtime = createRuntime()
  const { ctx, routes } = createContext(403)
  registerRoutes(ctx, runtime)
  const res = nodeResponse()
  await routes.get(`${PREFIX}/scenes`).handler(nodeRequest(), res)
  assert.equal(res.statusCode, 403)
  assert.equal(res.body, 'forbidden')
  assert.deepEqual(runtime.calls, [])
})

test('refresh refuses before refreshing', async () => {
  const runtime = createRuntime()
  const { ctx, routes } = createContext(401)
  registerRoutes(ctx, runtime)
  const res = nodeResponse()
  await routes.get(`${PREFIX}/refresh`).handler(nodeRequest({ method: 'POST', url: `${PREFIX}/refresh` }), res)
  assert.equal(res.statusCode, 401)
  assert.deepEqual(runtime.calls, [])
})

test('config refuses before applying overrides', async () => {
  const runtime = createRuntime()
  const { ctx, routes } = createContext(403)
  registerRoutes(ctx, runtime)
  const res = nodeResponse()
  await routes.get(`${PREFIX}/config`).handler(nodeRequest({ method: 'POST', url: `${PREFIX}/config` }), res)
  assert.equal(res.statusCode, 403)
  assert.deepEqual(runtime.calls, [])
})

test('scenes passes an admitted request through to the handler', async () => {
  const runtime = createRuntime()
  const { ctx, routes, seen } = createContext(undefined)
  registerRoutes(ctx, runtime)
  const req = nodeRequest()
  const res = nodeResponse()
  await routes.get(`${PREFIX}/scenes`).handler(req, res)
  assert.equal(res.statusCode, 404)
  assert.equal(seen[0], req)
  assert.deepEqual(runtime.calls, ['sceneFile'])
})

test('the returned disposer removes every route', () => {
  const { ctx, routes } = createContext(undefined)
  const dispose = registerRoutes(ctx, createRuntime())
  assert.equal(routes.size, 4)
  dispose()
  assert.equal(routes.size, 0)
})

test('parseByteRange handles explicit, suffix, capped and invalid ranges', () => {
  assert.deepEqual(parseByteRange('bytes=0-9', 100), { start: 0, end: 9 })
  assert.deepEqual(parseByteRange('bytes=90-', 100), { start: 90, end: 99 })
  assert.deepEqual(parseByteRange('bytes=0-999', 100), { start: 0, end: 99 })
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 })
  assert.deepEqual(parseByteRange('bytes=-200', 100), { start: 0, end: 99 })
  assert.deepEqual(parseByteRange('bytes=200-', 100), { unsatisfiable: true })
  assert.deepEqual(parseByteRange('bytes=5-3', 100), { unsatisfiable: true })
  assert.deepEqual(parseByteRange('bytes=-0', 100), { unsatisfiable: true })
  assert.deepEqual(parseByteRange('bytes=-', 100), { unsatisfiable: true })
  assert.equal(parseByteRange('bytes=0-1,3-4', 100), null)
  assert.equal(parseByteRange('bytes=abc', 100), null)
  assert.equal(parseByteRange(undefined, 100), null)
})

test('scene responses stream ranges and answer HEAD without a body', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-spend-wallpaper-http-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'clip.webm')
  const bytes = Buffer.from(Array.from({ length: 100 }, (_, index) => index))
  fs.writeFileSync(file, bytes)

  const runtime = createRuntime()
  runtime.sceneFile = () => ({ path: file, contentType: 'video/webm' })
  const { ctx, routes } = createContext(undefined)
  registerRoutes(ctx, runtime)
  const handler = routes.get(`${PREFIX}/scenes`).handler

  const collect = (res) => {
    const chunks = []
    res.on('data', (chunk) => chunks.push(chunk))
    return new Promise((resolve, reject) => {
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
  }
  const response = () => {
    const res = new PassThrough()
    res.statusCode = 0
    res.headers = {}
    res.writeHead = function writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers ?? {}
      return this
    }
    return res
  }

  const ranged = response()
  const rangedBody = collect(ranged)
  await handler(nodeRequest({ headers: { range: 'bytes=10-19' } }), ranged)
  assert.equal(ranged.statusCode, 206)
  assert.equal(ranged.headers['content-range'], 'bytes 10-19/100')
  assert.equal(ranged.headers['content-length'], 10)
  assert.deepEqual(await rangedBody, bytes.subarray(10, 20))

  const head = response()
  const headBody = collect(head)
  await handler(nodeRequest({ method: 'HEAD', headers: { range: 'bytes=-10' } }), head)
  assert.equal(head.statusCode, 206)
  assert.equal(head.headers['content-range'], 'bytes 90-99/100')
  assert.equal(head.headers['content-length'], 10)
  assert.equal((await headBody).length, 0)

  const unsatisfiable = response()
  const unsatisfiableBody = collect(unsatisfiable)
  await handler(nodeRequest({ headers: { range: 'bytes=200-' } }), unsatisfiable)
  assert.equal(unsatisfiable.statusCode, 416)
  assert.equal(unsatisfiable.headers['content-range'], 'bytes */100')
  assert.equal((await unsatisfiableBody).length, 0)

  const full = response()
  const fullBody = collect(full)
  await handler(nodeRequest(), full)
  assert.equal(full.statusCode, 200)
  assert.equal(full.headers['content-length'], 100)
  assert.deepEqual(await fullBody, bytes)
})
