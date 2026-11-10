/**
 * Terminal surface tests: ANSI renderer geometry/colors, status card, and the
 * `dsh-spend-wallpaper` CLI reading the persisted host state.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { displayWidth, renderStatusCard, renderWallpaperFrame, truncateToWidth } from '../lib/terminal.js'
import { run } from '../lib/terminal-cli.js'
import { loadState, saveState, stateFilePath } from '../lib/store.js'

function fakeIo(env = {}) {
  const out = []
  const err = []
  return {
    stdout: {
      isTTY: false,
      columns: 100,
      rows: 30,
      write(chunk) { out.push(String(chunk)) },
      on() {},
      off() {},
    },
    stderr: { write(chunk) { err.push(String(chunk)) } },
    stdin: { isTTY: false, on() {}, off() {}, pause() {}, resume() {}, setRawMode() {} },
    env: { ...process.env, NO_COLOR: '1', ...env },
    out: () => out.join(''),
    err: () => err.join(''),
  }
}

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dswp-terminal-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await fn(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
}

const STATE = {
  samples: [{ t: Date.now() - 10_000, totalMicro: -400_000, currency: 'CNY', kind: 'spend' }],
  tier: { index: 2, changedAt: 0 },
  currency: 'CNY',
  spendMicro: 400_000, // ¥0.40
  source: 'manual',
  status: 'ok',
  updatedAt: Date.now(),
  config: {
    enabled: true,
    source: 'manual',
    currency: 'CNY',
    direction: 'poor',
    mode: 'full',
    media: 'auto',
    sceneLabels: ['满汉全席', '拉面自由', '咖喱饭', '白饭梅干', '空碗'],
    windowMinutes: 60,
    thresholds: ['0', '0.05', '0.30', '1.50', '6.00'],
  },
}

const ANSI = /\x1b\[[0-9;]*m/g

test('renderWallpaperFrame fills the requested grid', () => {
  const lines = renderWallpaperFrame({ width: 24, height: 6, tier: 2, phase: 0.4, colorMode: 'truecolor' })
  assert.equal(lines.length, 6)
  for (const line of lines) {
    assert.equal(line.replace(ANSI, '').length, 24)
    assert.match(line, /\x1b\[38;2;/)
  }
})

test('renderWallpaperFrame can disable colors', () => {
  const lines = renderWallpaperFrame({ width: 10, height: 4, tier: 4, colorMode: 'none' })
  assert.equal(lines.length, 4)
  for (const line of lines) {
    assert.equal(line.includes('\x1b'), false)
    assert.equal([...line].length, 10)
  }
})

test('different tiers produce different palettes', () => {
  const calm = renderWallpaperFrame({ width: 8, height: 3, tier: 0, colorMode: 'truecolor' }).join('')
  const storm = renderWallpaperFrame({ width: 8, height: 3, tier: 4, colorMode: 'truecolor' }).join('')
  assert.notEqual(calm, storm)
})

test('display width helpers handle CJK text', () => {
  assert.equal(displayWidth('起浪ab'), 6)
  assert.equal(truncateToWidth('起浪ab', 5), '起浪a')
  assert.equal(truncateToWidth('起浪ab', 4), '起浪')
})

test('status card carries spend, tier and source', () => {
  const card = renderStatusCard({
    spend: '0.40', tierIndex: 2, tierLabel: '起浪', nextAt: '1.50', nextLabel: '浪涌',
    source: 'manual', samples: 1, updatedAt: Date.now(),
  })
  assert.match(card, /最近 1 小时/)
  assert.match(card, /0\.40/)
  assert.match(card, /起浪/)
  assert.match(card, /手动值/)
})

test('status card labels the cost-meter source', () => {
  const card = renderStatusCard({ spend: '0.12', tierIndex: 1, tierLabel: '微澜', source: 'cost-meter', samples: 3, updatedAt: Date.now() })
  assert.match(card, /本地用量估算/)
})

test('CLI status --json reads the persisted snapshot', () => withHome(async (home) => {
  saveState(stateFilePath(), STATE)
  const io = fakeIo({ DSH_HOME: home })
  const code = await run(['status', '--json'], io)
  assert.equal(code, 0)
  const payload = JSON.parse(io.out())
  assert.equal(payload.ok, true)
  assert.equal(payload.spend, '0.4')
  assert.equal(payload.tierIndex, 2)
  assert.equal(payload.tierLabel, '咖喱饭')
  assert.equal(payload.nextAt, '1.5')
  assert.equal(payload.samples, 1)
}))

test('CLI status text prints the status card', () => withHome(async (home) => {
  saveState(stateFilePath(), STATE)
  const io = fakeIo({ DSH_HOME: home })
  const code = await run(['status'], io)
  assert.equal(code, 0)
  assert.match(io.out(), /当前档位/)
  assert.match(io.out(), /咖喱饭/)
}))

test('CLI status reports missing state', () => withHome(async (home) => {
  const io = fakeIo({ DSH_HOME: home })
  const code = await run(['status'], io)
  assert.equal(code, 1)
  assert.match(io.err(), /还没有状态数据/)
}))

test('CLI render --once prints one colored frame', () => withHome(async (home) => {
  saveState(stateFilePath(), STATE)
  const io = fakeIo({ DSH_HOME: home })
  const code = await run(['render', '--once', '--tier', '3', '--width', '30', '--height', '8', '--color', 'truecolor'], io)
  assert.equal(code, 0)
  const lines = io.out().trimEnd().split('\n')
  assert.equal(lines.length, 8)
  assert.match(io.out(), /\x1b\[38;2;/)
  assert.match(io.out(), /余额壁纸/)
}))

test('CLI render works without any state (preview mode)', () => withHome(async (home) => {
  const io = fakeIo({ DSH_HOME: home })
  const code = await run(['render', '--tier', '4', '--once', '--color', 'none', '--width', '20', '--height', '6'], io)
  assert.equal(code, 0)
  const lines = io.out().trimEnd().split('\n')
  assert.equal(lines.length, 6)
  assert.equal(io.out().includes('\x1b'), false)
}))

test('CLI help and version exit cleanly', async () => {
  const helpIo = fakeIo()
  assert.equal(await run(['--help'], helpIo), 0)
  assert.match(helpIo.out(), /dsh-spend-wallpaper/)

  const versionIo = fakeIo()
  assert.equal(await run(['--version'], versionIo), 0)
  assert.match(versionIo.out().trim(), /^\d+\.\d+\.\d+/)
})

test('store round-trips snapshot fields for the CLI', () => withHome(() => {
  saveState(stateFilePath(), STATE)
  const loaded = loadState(stateFilePath())
  assert.equal(loaded.spendMicro, STATE.spendMicro)
  assert.equal(loaded.source, 'manual')
  assert.deepEqual(loaded.config.thresholds, STATE.config.thresholds)
  assert.equal(loaded.samples[0].kind, 'spend')
}))
