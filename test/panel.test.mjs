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
    this.style = { props: new Map(), setProperty(n, v) { this.props.set(n, String(v)) }, removeProperty(n) { this.props.delete(n) } }
    this.classList = { add() {}, remove() {}, contains: () => false }
  }
  get id() { return this.attributes.id ?? '' }
  set id(value) { this.attributes.id = String(value) }
  get textContent() { return this._text }
  set textContent(value) { this._text = String(value); this.children = [] }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'value') this.value = String(value) }
  getAttribute(name) { return this.attributes[name] ?? null }
  hasAttribute(name) { return name in this.attributes }
  removeAttribute(name) { delete this.attributes[name] }
  appendChild(child) { if (child.parentNode) child.remove(); this.children.push(child); child.parentNode = this; return child }
  insertBefore(child, ref) { if (child.parentNode) child.remove(); const i = this.children.indexOf(ref); if (i >= 0) this.children.splice(i, 0, child); else this.children.push(child); child.parentNode = this; return child }
  prepend(child) { if (child.parentNode) child.remove(); this.children.unshift(child); child.parentNode = this; return child }
  remove() { const p = this.parentNode; if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1) } this.parentNode = null }
  contains(node) { return node === this || this.children.some((child) => child.contains?.(node) ?? false) }
  allNodes() { const out = []; const visit = (n) => { out.push(n); for (const c of n.children) visit(c) }; visit(this); return out }
  matches(sel) {
    if (sel.startsWith('#')) return this.attributes.id === sel.slice(1)
    if (sel.startsWith('.')) return this.className.split(' ').includes(sel.slice(1))
    if (sel.startsWith('style[')) return this.tagName === 'STYLE'
    return this.tagName === sel.toUpperCase()
  }
  querySelectorAll(sel) { return this.allNodes().filter((n) => n !== this && n.matches(sel)) }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn) }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((x) => x !== fn) }
  dispatch(type) { for (const fn of this.listeners[type] ?? []) fn({ type, target: this }) }
  click() { this.dispatch('click') }
  play() { return Promise.resolve() }
  pause() {}
}

const SCENES = Array.from({ length: 5 }, (_, index) => ({
  index,
  id: `tier-${index}`,
  label: ['满汉全席', '拉面自由', '咖喱饭', '白饭梅干', '空碗'][index],
  custom: false,
  settings: { fit: 'cover', x: 50, y: 50, scale: 1 },
  imageUrl: `/s/${index}.webp`,
  videoUrl: `/s/${index}.webm`,
}))

test('quick panel edits thresholds, previews scenes and has no pack/frame controls', async () => {
  const elements = []
  const documentStub = {
    body: new Element('body'),
    documentElement: new Element('html'),
    head: new Element('head'),
    visibilityState: 'visible',
    activeElement: null,
    createElement(tag) { const el = new Element(tag); elements.push(el); return el },
    getElementById(id) { return elements.find((el) => el.attributes.id === id) ?? null },
    querySelector(sel) { return elements.find((el) => el.matches(sel)) ?? null },
    querySelectorAll(sel) { return elements.filter((el) => el.matches(sel)) },
    addEventListener() {}, removeEventListener() {},
  }
  const state = {
    enabled: true, spend1h: '0.42', tier: { index: 2, label: '咖喱饭' },
    thresholds: ['0', '0.05', '0.3', '1.5', '6'],
    windowMinutes: 60,
    sampling: { sampleSeconds: 180, hysteresis: 0.25, minDwellSeconds: 600 },
    scenes: SCENES,
    wallpaper: { kind: 'video', src: '/s/2.webm', poster: '/s/2.webp', sceneIndex: 2, transitionMs: 600 },
    rendering: { surfaceOpacity: 0.45, scrim: 0.1, dim: 0.03, blur: 0, transitionMs: 600 },
    lockedTier: '', enabled: true, overrides: {},
  }
  const posts = []
  const timers = []
  let captured = null
  const windowStub = {
    __ModuleLoader__: { load(entry) { captured = entry } },
    matchMedia: () => ({ matches: false }),
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeout: (id) => { timers[id - 1] = null },
    addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (fn) => fn(),
  }
  const fetchMock = async (url, options = {}) => {
    const text = String(url)
    if (text.endsWith('/config')) {
      const body = JSON.parse(options.body ?? '{}')
      posts.push(body)
      if (Array.isArray(body.thresholds)) state.thresholds = body.thresholds
      return { ok: true, json: async () => state }
    }
    return { ok: true, json: async () => state }
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
  const bundle = captured.factory(() => { throw new Error('require') })
  let disposer = null
  bundle.apply({ effect(start) { disposer = start() } })
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  await flush()

  const layer = elements.find((el) => el.attributes.id === 'dswp-root')
  const button = elements.find((el) => el.attributes.id === 'dswp-quick')
  const panel = elements.find((el) => el.attributes.id === 'dswp-panel')
  const findButton = (text) => panel.allNodes().find((n) => n.tagName === 'BUTTON' && n.textContent === text)
  state.scenes[2].custom = true
  button.click()
  await flush()

  assert.ok(panel.allNodes().some((n) => n.textContent === '当前场景画面（已上传，可直接调）'), 'active uploaded scene shows its display editor without clicking')
  assert.ok(panel.allNodes().some((n) => n.className === 'dswp-scene-display'), 'active scene display controls are rendered')

  assert.equal(findButton('相框'), undefined)
  assert.equal(panel.allNodes().filter((n) => n.className === 'dswp-threshold').length, 5, 'one threshold input per tier')
  assert.equal(panel.allNodes().filter((n) => n.className === 'dswp-scene-row').length, 5, 'one scene row per tier')
  assert.equal(panel.allNodes().filter((n) => n.textContent === '上传').length, 5)
  const nameInputs = panel.allNodes().filter((n) => n.className === 'dswp-scene-name')
  assert.equal(nameInputs.length, 5, 'each scene has an editable name')
  nameInputs[0].value = '我的场景'
  nameInputs[0].dispatch('change')
  await flush()
  assert.ok(posts.some((post) => Array.isArray(post.sceneNames) && post.sceneNames[0] === '我的场景'), 'scene name edit is posted')

  // Per-tier display settings (fit / focal point / zoom) can be edited.
  documentStub.activeElement = nameInputs[0]
  findButton('调整画面').click()
  await flush()
  assert.ok(findButton('完整'), 'display editor opens even with an input focused')
  findButton('完整').click()
  await flush()
  assert.ok(posts.some((post) => Array.isArray(post.sceneSettings) && post.sceneSettings.some((item) => item.fit === 'contain')), 'fit mode is posted')

  const inputs = panel.allNodes().filter((n) => n.className === 'dswp-threshold')
  inputs[1].value = '0.08'
  inputs[1].dispatch('change')
  inputs[2].value = '0.4'
  inputs[2].dispatch('change')
  await flush()
  const thresholdPosts = posts.filter((post) => Array.isArray(post.thresholds))
  assert.ok(thresholdPosts.length > 0, 'threshold edit is posted')
  const latestThresholds = thresholdPosts[thresholdPosts.length - 1].thresholds
  assert.equal(latestThresholds[1], '0.08', 'first of two quick threshold edits survives')
  assert.equal(latestThresholds[2], '0.4', 'second quick threshold edit is included')
  const sampleInput = panel.allNodes().find((n) => n.className === 'dswp-param')
  assert.ok(sampleInput, 'sampling interval is a fill-in field')
  sampleInput.value = '90'
  sampleInput.dispatch('change')
  await flush()
  assert.ok(posts.some((post) => post.sampleSeconds === 90), 'sampling interval edit is posted')
  const windowInput = panel.allNodes().filter((n) => n.className === 'dswp-param')[1]
  assert.ok(windowInput, 'statistic window is a fill-in field')
  windowInput.value = '30'
  windowInput.dispatch('change')
  await flush()
  assert.ok(posts.some((post) => post.windowMinutes === 30), 'statistic window edit is posted')

  findButton('空碗').click()
  await flush()
  const frames = layer.querySelectorAll('.dswp-frame').map((frame) => frame.src)
  assert.ok(frames.some((src) => src.endsWith('/s/4.webm')), 'preview uses the selected scene')

  // A custom video has no poster; static mode must fall back to a paused video
  // element, not an <img> with a .webm src.
  state.rendering.media = 'static'
  state.scenes[0].imageUrl = null
  state.scenes[0].custom = true
  findButton('刷新数据').click()
  await flush()
  findButton('满汉全席').click()
  await flush()
  const staticVideo = layer.querySelectorAll('video').find((video) => video.src.endsWith('/s/0.webm'))
  assert.ok(staticVideo, 'static preview of a posterless video still uses a video element')

  findButton('+').click()
  await flush()
  assert.ok(posts.some((post) => Array.isArray(post.thresholds) && post.thresholds.length === 6), 'tier count can be increased')

  disposer()
  assert.equal(button.parentNode, null)
})
