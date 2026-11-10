/**
 * Quick-switch panel interaction test: evaluates the client bundle against a
 * stub DOM, opens the panel and exercises preview, direction mapping, pack
 * switching, sliders and teardown. Guards the panel bugs fixed in 0.8.1:
 * stale pack cache, reversed rich-direction labels, and previews that never
 * expired.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')

class Element {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentNode = null
    this.attributes = {}
    this.dataset = {}
    this.listeners = {}
    this.value = ''
    this.className = ''
    this._text = ''
    this.style = {
      props: new Map(),
      setProperty(name, value) { this.props.set(name, String(value)) },
      removeProperty(name) { this.props.delete(name) },
    }
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' ') },
      remove: (...names) => { this.className = this.className.split(' ').filter((name) => name && !names.includes(name)).join(' ') },
      contains: (name) => this.className.split(' ').includes(name),
    }
  }
  get id() { return this.attributes.id ?? '' }
  set id(value) { this.attributes.id = String(value) }
  get textContent() { return this._text }
  set textContent(value) { this._text = String(value); this.children = [] }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
    if (name === 'value') this.value = String(value)
  }
  getAttribute(name) { return this.attributes[name] ?? null }
  hasAttribute(name) { return name in this.attributes }
  removeAttribute(name) { delete this.attributes[name] }
  appendChild(child) { if (child.parentNode) child.remove(); this.children.push(child); child.parentNode = this; return child }
  insertBefore(child, reference) {
    if (child.parentNode) child.remove()
    const index = this.children.indexOf(reference)
    if (index >= 0) this.children.splice(index, 0, child); else this.children.push(child)
    child.parentNode = this; return child
  }
  prepend(child) { if (child.parentNode) child.remove(); this.children.unshift(child); child.parentNode = this; return child }
  remove() {
    const parent = this.parentNode
    if (parent) {
      const index = parent.children.indexOf(this)
      if (index >= 0) parent.children.splice(index, 1)
    }
    this.parentNode = null
  }
  contains(node) { return node === this || this.children.some((child) => child.contains?.(node) ?? false) }
  allNodes() { const out = []; const visit = (node) => { out.push(node); for (const child of node.children) visit(child) }; visit(this); return out }
  matches(selector) {
    if (selector.startsWith('#')) return this.attributes.id === selector.slice(1)
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1))
    if (selector.startsWith('style[')) return this.tagName === 'STYLE'
    return this.tagName === selector.toUpperCase()
  }
  querySelectorAll(selector) { return this.allNodes().filter((node) => node !== this && node.matches(selector)) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler) }
  removeEventListener(type, handler) { this.listeners[type] = (this.listeners[type] ?? []).filter((item) => item !== handler) }
  dispatch(type) { for (const handler of this.listeners[type] ?? []) handler({ type, target: this }) }
  click() { this.dispatch('click') }
  play() { return Promise.resolve() }
  pause() {}
}

const PACKS = {
  schema: 1,
  selected: 'deepseek-eats',
  packs: [
    {
      id: 'deepseek-eats', name: 'DeepSeek 干饭', direction: 'poor', license: 'CC0-1.0',
      tiers: [
        ['feast', '满汉全席'], ['ramen', '拉面自由'], ['curry', '咖喱饭'], ['rice', '白饭梅干'], ['empty', '空碗'],
      ].map(([id, label], index) => ({
        id, label, min: String(index), staticUrl: `/a/${index}.webp`,
        dynamic: { type: 'video', url: `/a/${id}.webm`, posterUrl: `/a/${index}.webp` },
      })),
    },
    {
      id: 'default', name: '深海情绪', direction: 'poor', license: 'CC0-1.0',
      tiers: Array.from({ length: 5 }, (_, index) => ({
        id: `tier-${index}`, label: `档 ${index}`, min: String(index), staticUrl: `/b/${index}.webp`,
        dynamic: { type: 'video', url: `/b/${index}.webm`, posterUrl: `/b/${index}.webp` },
      })),
    },
  ],
  errors: [],
}

test('quick panel previews, maps rich direction, refreshes packs and posts changes', async () => {
  const elements = []
  const documentStub = {
    body: new Element('body'),
    documentElement: new Element('html'),
    head: new Element('head'),
    visibilityState: 'visible',
    activeElement: null,
    createElement(tag) { const element = new Element(tag); elements.push(element); return element },
    getElementById(id) { return elements.find((element) => element.attributes.id === id) ?? null },
    querySelector(selector) { return elements.find((element) => element.matches(selector)) ?? null },
    querySelectorAll(selector) { return elements.filter((element) => element.matches(selector)) },
    addEventListener() {}, removeEventListener() {},
  }

  const state = {
    schema: 1, enabled: true, source: 'manual', status: 'ok', currency: 'CNY', spend1h: '0.42',
    windowMinutes: 60, thresholds: ['0', '0.05', '0.3', '1.5', '6'],
    sampling: { sampleSeconds: 180, hysteresis: 0.25, minDwellSeconds: 600 },
    tier: { index: 2, id: 'curry', label: '咖喱饭' },
    wallpaper: { kind: 'video', src: '/a/curry.webm', poster: '/a/2.webp', packId: 'deepseek-eats', tierIndex: 2, tierId: 'curry', transitionMs: 600 },
    rendering: { mode: 'full', media: 'auto', scrim: 0.1, dim: 0.03, blur: 0, surfaceOpacity: 0.45, inset: 16, radius: 16, transitionMs: 600, direction: 'poor' },
    pack: { id: 'deepseek-eats', name: 'DeepSeek 干饭', tiers: [] },
    overrides: {}, updatedAt: 0,
    diagnostics: { samples: 0, windowReason: 'ok', lastError: null, packErrors: [], packs: ['default', 'deepseek-eats'] },
  }

  const posts = []
  const timers = []
  const fetchMock = async (input, options = {}) => {
    const url = String(input)
    if (url.endsWith('/packs')) return { ok: true, json: async () => ({ ...PACKS, selected: state.pack.id }) }
    if (url.endsWith('/config')) {
      const body = JSON.parse(options.body ?? '{}')
      posts.push(body)
      if (body.reset) state.overrides = {}
      else {
        Object.assign(state.overrides, body)
        if (body.direction) state.rendering.direction = body.direction
        if (body.surfaceOpacity !== undefined) state.rendering.surfaceOpacity = body.surfaceOpacity
        if (body.pack) {
          const pack = PACKS.packs.find((candidate) => candidate.id === body.pack)
          state.pack = { id: pack.id, name: pack.name, tiers: [] }
          const tier = pack.tiers[state.tier.index]
          state.tier = { ...state.tier, id: tier.id, label: tier.label }
          state.wallpaper = { ...state.wallpaper, src: tier.dynamic.url, packId: pack.id }
        }
      }
      return { ok: true, json: async () => state }
    }
    return { ok: true, json: async () => state }
  }

  let captured = null
  const windowStub = {
    __ModuleLoader__: { load(entry) { captured = entry } },
    matchMedia: () => ({ matches: false }),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeout: (id) => { timers[id - 1] = null },
    addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (fn) => fn(),
  }
  const sandbox = {
    window: windowStub, document: documentStub,
    MutationObserver: class { observe() {} disconnect() {} },
    fetch: fetchMock, requestAnimationFrame: (fn) => fn(), console,
    URL, JSON, Promise, Number, Math, String, Array, Object, Set, Map,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const bundle = captured.factory(() => { throw new Error('unexpected require') })
  let disposer = null
  bundle.apply({ effect(start) { disposer = start() } })
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  await flush()

  const layer = elements.find((element) => element.attributes.id === 'dswp-root')
  const button = elements.find((element) => element.attributes.id === 'dswp-quick')
  const panel = elements.find((element) => element.attributes.id === 'dswp-panel')
  const findButton = (text) => panel.allNodes().find((node) => node.tagName === 'BUTTON' && node.textContent === text)
  const previewLabels = () => panel.allNodes()
    .find((node) => node.textContent === '预览档位')?.parentNode?.children?.[1]?.children
    ?.map((chip) => chip.textContent) ?? []
  const frameSources = () => layer.querySelectorAll('.dswp-frame').map((frame) => frame.src)

  assert.ok(button && panel)
  assert.ok(panel.hasAttribute('hidden'), 'panel starts hidden')
  button.click()
  await flush()
  assert.equal(panel.hasAttribute('hidden'), false, 'button opens the panel')
  assert.equal(findButton('铺满'), undefined, 'full/frame mode toggle was removed')
  assert.equal(findButton('相框'), undefined, 'frame mode toggle was removed')
  assert.deepEqual(previewLabels(), ['满汉全席', '拉面自由', '咖喱饭', '白饭梅干', '空碗'])

  // Rich direction must reverse the preview labels (tier 0 is the worst meal).
  findButton('越花越好').click()
  await flush()
  assert.deepEqual(previewLabels(), ['空碗', '白饭梅干', '咖喱饭', '拉面自由', '满汉全席'])
  layer.dataset.dswpHidden = '1'
  findButton('空碗').click()
  await flush()
  assert.equal(layer.dataset.dswpHidden, undefined, 'previewing unhides a previously hidden layer')
  assert.ok(frameSources().some((src) => src.endsWith('/a/empty.webm')), 'preview shows the mapped tier asset')

  // Regression: an older transition cleanup must not remove the new preview
  // frame (this made the wallpaper briefly disappear when switching quickly).
  const fireFadeTimers = () => {
    for (const timer of timers.filter((timer) => timer && timer.ms === 650)) timer.fn()
  }
  fireFadeTimers()
  await flush()
  assert.ok(frameSources().some((src) => src.endsWith('/a/empty.webm')), 'older cleanup timers must not remove the preview frame')

  // Regression: an error on a *stale* preview video must not hijack the
  // cleanup frame from a newer preview.
  findButton('拉面自由').click()
  await flush()
  const staleVideo = layer.querySelectorAll('video').find((video) => video.src.endsWith('/a/empty.webm'))
  assert.ok(staleVideo, 'old preview video is still attached during the fade')
  staleVideo.dispatch('error')
  await flush()
  fireFadeTimers()
  await flush()
  assert.ok(layer.querySelectorAll('video').some((video) => video.src.endsWith('/a/ramen.webm')), 'newest preview survives a stale video error')
  assert.ok(!layer.querySelectorAll('img').some((image) => image.src.endsWith('/a/4.webp')), 'stale error fallback is cleaned up')

  // Regression: if the *active* preview video errors, its poster fallback must
  // survive the cleanup timer instead of leaving an empty layer.
  const activeVideo = layer.querySelectorAll('video').find((video) => video.src.endsWith('/a/ramen.webm'))
  activeVideo.dispatch('error')
  await flush()
  fireFadeTimers()
  await flush()
  assert.ok(layer.querySelectorAll('img').some((image) => image.src.endsWith('/a/1.webp')), 'active video error fallback survives cleanup')

  const previewTimer = timers.filter((timer) => timer && timer.ms === 15_000).at(-1)
  assert.ok(previewTimer, 'preview must schedule an expiry timer')
  previewTimer.fn()
  await flush()
  assert.ok(frameSources().some((src) => src.endsWith('/a/curry.webm')), 'expired preview returns to the live wallpaper')

  // Switching pack must refetch the pack list, not keep stale tier labels.
  findButton('深海情绪').click()
  await flush()
  assert.deepEqual(previewLabels(), ['档 4', '档 3', '档 2', '档 1', '档 0'])

  // Sliders post their value.
  const range = panel.allNodes().find((node) => node.tagName === 'INPUT' && node.attributes.type === 'range')
  assert.ok(range, 'appearance sliders are rendered')
  range.value = '0.72'
  range.dispatch('input')
  range.dispatch('change')
  await flush()
  assert.ok(posts.some((post) => post.surfaceOpacity === 0.72), 'slider change is posted to /config')

  disposer()
  assert.equal(button.parentNode, null)
  assert.equal(panel.parentNode, null)
})
