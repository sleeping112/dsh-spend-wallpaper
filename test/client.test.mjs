/**
 * Browser bundle smoke test: evaluate lib/client.js against a stub DOM and
 * Module Loader, feed it a realistic `/state` payload, then dispose it.
 *
 * This proves the bundle wrapper, the apply/effect contract, the snapshot
 * rendering path (full mode, video frame, stylesheet injection) and teardown
 * without launching a browser.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')

const STATE = {
  schema: 1,
  enabled: true,
  source: 'manual',
  status: 'ok',
  currency: 'CNY',
  spend1h: '0.4',
  windowMinutes: 60,
  tier: { index: 2, id: 'swell', label: '起浪', min: '0.30', nextAt: '1.50', nextLabel: '浪涌', pending: null },
  wallpaper: {
    kind: 'video',
    src: '/plugins/dsh-spend-wallpaper/assets/default/2-swell.webm?v=1',
    poster: '/plugins/dsh-spend-wallpaper/assets/default/2-swell.webp?v=1',
    packId: 'default',
    tierIndex: 2,
    tierId: 'swell',
    transitionMs: 600,
  },
  rendering: {
    mode: 'full',
    media: 'auto',
    scrim: 0.28,
    dim: 0.08,
    blur: 0,
    surfaceOpacity: 0.7,
    inset: 16,
    radius: 16,
    transitionMs: 600,
    direction: 'poor',
  },
  pack: { id: 'default', name: '深海情绪', tiers: [] },
  updatedAt: 0,
  nextSampleAt: 0,
  diagnostics: { samples: 0, windowReason: 'ok', lastError: null, packErrors: [], packs: ['default'] },
}

function createElement(tag) {
  const element = {
    tagName: String(tag).toUpperCase(),
    style: {
      props: new Map(),
      setProperty(name, value) { this.props.set(name, value) },
      removeProperty(name) { this.props.delete(name) },
    },
    dataset: {},
    children: [],
    attributes: {},
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { this.attributes[name] = String(value) },
    getAttribute(name) { return this.attributes[name] ?? null },
    hasAttribute(name) { return name in this.attributes },
    removeAttribute(name) { delete this.attributes[name] },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child },
    insertBefore(child) { this.children.unshift(child); child.parentNode = this; return child },
    prepend(child) { this.children.unshift(child); child.parentNode = this; return child },
    remove() {
      const index = this.parentNode?.children?.indexOf(this) ?? -1
      if (index >= 0) this.parentNode.children.splice(index, 1)
      this.parentNode = null
    },
    querySelector() { return null },
    querySelectorAll() { return [] },
    addEventListener() {},
    removeEventListener() {},
    play() { return Promise.resolve() },
    pause() {},
  }
  return element
}

test('bundle installs the wallpaper layer, renders state and disposes cleanly', async () => {
  const elements = []
  const body = createElement('body')
  const documentStub = {
    body,
    head: createElement('head'),
    documentElement: createElement('html'),
    visibilityState: 'visible',
    createElement(tag) {
      const element = createElement(tag)
      elements.push(element)
      return element
    },
    getElementById() { return null },
    querySelector() { return null },
    addEventListener() {},
    removeEventListener() {},
  }
  let captured = null
  const windowStub = {
    __ModuleLoader__: { load(entry) { captured = entry } },
    matchMedia: () => ({ matches: false }),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn) => { fn(); return 1 },
    clearTimeout: () => {},
    addEventListener() {},
    removeEventListener() {},
  }
  let fetchCalls = 0
  const sandbox = {
    window: windowStub,
    document: documentStub,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    fetch: async () => {
      fetchCalls += 1
      return { ok: true, json: async () => STATE }
    },
    requestAnimationFrame: (fn) => { fn() },
    console,
    URL,
    JSON,
    Promise,
    Number,
    Math,
    String,
    Array,
    Object,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'lib/client.js' })

  assert.ok(captured, 'bundle must call window.__ModuleLoader__.load')
  assert.equal(captured.id, 'dsh-spend-wallpaper')
  const exports = captured.factory((name) => { throw new Error(`unexpected require(${name})`) })
  assert.equal(exports.name, 'spend-wallpaper-client')
  assert.equal(typeof exports.apply, 'function')
  assert.equal(exports.inject.length, 0)

  let disposer = null
  exports.apply({ effect(start) { disposer = start() } })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(documentStub.documentElement.dataset.dswp, 'on', 'wallpaper layer must be enabled')
  assert.equal(documentStub.documentElement.dataset.dswpMode, 'full', 'full mode must be applied')
  assert.equal(documentStub.documentElement.style.props.get('--dswp-fade'), '600ms')
  assert.match(documentStub.documentElement.style.props.get('--dswp-surface') ?? '', /^rgba\(/)
  assert.match(documentStub.documentElement.style.props.get('--dswp-composer') ?? '', /^rgba\(/)
  assert.match(documentStub.documentElement.style.props.get('--dswp-document') ?? '', /^rgba\(/)
  assert.ok(fetchCalls >= 1, 'client must poll /state')

  const video = elements.find((element) => element.tagName === 'VIDEO')
  assert.ok(video, 'a <video> frame must be created for a video wallpaper')
  assert.match(video.src, /\/plugins\/dsh-spend-wallpaper\/assets\/default\/2-swell\.webm/)
  assert.equal(video.muted, true)

  const style = elements.find((element) => element.tagName === 'STYLE' && element.dataset.pluginCss === 'dsh-spend-wallpaper/client.css')
  assert.ok(style, 'the plugin stylesheet must be injected')
  assert.match(style.textContent, /--dsw-specific-input-major/)
  assert.match(style.textContent, /--dsw-alias-bg-document-preview/)

  const quickButton = elements.find((element) => element.attributes.id === 'dswp-quick')
  assert.ok(quickButton, 'a quick-switch button must be injected')
  const quickPanel = elements.find((element) => element.attributes.id === 'dswp-panel')
  assert.ok(quickPanel, 'a quick-switch panel must be injected')
  assert.ok(quickPanel.attributes.hidden !== undefined, 'the panel starts hidden')

  assert.equal(typeof disposer, 'function')
  disposer()
  assert.equal(documentStub.documentElement.dataset.dswp, undefined, 'disposer must remove rendering attributes')
  assert.equal(style.parentNode, null, 'disposer must remove the injected stylesheet')
  assert.equal(documentStub.documentElement.style.props.size, 0, 'disposer must clear inline variables')
})
