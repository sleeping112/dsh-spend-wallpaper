/**
 * Host-side unit tests for the pure modules (no DSH runtime needed).
 *
 * Run with: node --test
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseAmount, formatAmount, cmpAmount, mulRatio } from '../lib/money.js'
import { resolveTier, mapPackIndex, parseTierTable, nextThreshold } from '../lib/tiers.js'
import { appendSample, trimSamples, windowSpend } from '../lib/window.js'
import { normalizeApiBase, readCostMeterSpend } from '../lib/sources.js'
import { sanitizeOverrides, sanitizeStoredOverrides } from '../lib/control.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ------------------------------------------------------------------ money

test('parseAmount handles decimals and negatives', () => {
  assert.equal(parseAmount('0'), 0)
  assert.equal(parseAmount('0.05'), 50_000)
  assert.equal(parseAmount('1.5'), 1_500_000)
  assert.equal(parseAmount('-2.25'), -2_250_000)
  assert.equal(parseAmount(0.3), 300_000)
  assert.equal(parseAmount('6.000000'), 6_000_000)
})

test('parseAmount rejects malformed input', () => {
  for (const value of ['', 'abc', '1.2.3', '1e3', '--1', '1.2345678']) {
    assert.throws(() => parseAmount(value), /invalid amount/)
  }
})

test('formatAmount round-trips', () => {
  for (const value of ['0', '0.05', '1.5', '6', '123.456789', '-2.25']) {
    assert.equal(formatAmount(parseAmount(value)), value)
  }
})

test('cmpAmount and mulRatio are exact', () => {
  assert.equal(cmpAmount(parseAmount('0.3'), parseAmount('0.30')), 0)
  assert.equal(cmpAmount(parseAmount('0.05'), parseAmount('0.3')), -1)
  assert.equal(mulRatio(parseAmount('6'), 0.25), 1_500_000)
})

// ------------------------------------------------------------------ tiers

const TIERS = parseTierTable(['0', '0.05', '0.30', '1.50', '6.00'])

test('tier table is strict and starts at 0', () => {
  assert.deepEqual(TIERS, [0, 50_000, 300_000, 1_500_000, 6_000_000])
  assert.throws(() => parseTierTable(['0.05', '1']), /thresholds\[0\]/)
  assert.throws(() => parseTierTable(['0', '1', '1']), /strictly ascending/)
})

test('resolveTier maps spend to tier', () => {
  const base = { thresholdsMicro: TIERS, currentIndex: 0, changedAt: 0, now: 0, hysteresis: 0, minDwellMs: 0 }
  assert.equal(resolveTier({ ...base, spendMicro: 0 }).index, 0)
  assert.equal(resolveTier({ ...base, spendMicro: 40_000 }).index, 0)
  assert.equal(resolveTier({ ...base, spendMicro: 60_000 }).index, 1)
  assert.equal(resolveTier({ ...base, spendMicro: 2_000_000 }).index, 3)
  assert.equal(resolveTier({ ...base, spendMicro: 9_000_000 }).index, 4)
  assert.equal(resolveTier({ ...base, spendMicro: null }).index, 0)
})

test('resolveTier keeps the current tier inside the hysteresis band', () => {
  const base = { thresholdsMicro: TIERS, currentIndex: 1, changedAt: 0, now: 0, hysteresis: 0.25, minDwellMs: 0 }
  // 0.30 boundary needs +25% overshoot (0.375) to move up.
  assert.equal(resolveTier({ ...base, spendMicro: parseAmount('0.31') }).index, 1)
  assert.equal(resolveTier({ ...base, spendMicro: parseAmount('0.38') }).index, 2)
  // Dropping below 0.05 needs -25% of the boundary (0.0125): 0.04 is inside the band.
  assert.equal(resolveTier({ ...base, spendMicro: parseAmount('0.04') }).index, 1)
  assert.equal(resolveTier({ ...base, spendMicro: parseAmount('0.02') }).index, 0)
})

test('resolveTier defers a change until the dwell time elapsed', () => {
  const base = { thresholdsMicro: TIERS, currentIndex: 0, changedAt: 0, now: 100, hysteresis: 0, minDwellMs: 1000 }
  const result = resolveTier({ ...base, spendMicro: 9_000_000 })
  assert.equal(result.index, 0)
  assert.equal(result.pendingIndex, 4)
  const later = resolveTier({ ...base, now: 1001, spendMicro: 9_000_000 })
  assert.equal(later.index, 4)
})

test('mapPackIndex reverses for rich direction', () => {
  assert.equal(mapPackIndex(0, 5, 'poor', 'poor'), 0)
  assert.equal(mapPackIndex(4, 5, 'poor', 'poor'), 4)
  assert.equal(mapPackIndex(0, 5, 'poor', 'rich'), 4)
  assert.equal(mapPackIndex(4, 5, 'poor', 'rich'), 0)
  assert.equal(mapPackIndex(3, 5, 'poor', 'poor'), 3)
})

test('nextThreshold returns null on the top tier', () => {
  assert.equal(nextThreshold(TIERS, 0), 50_000)
  assert.equal(nextThreshold(TIERS, 4), null)
})

// ------------------------------------------------------------------ window

function samples(entries) {
  return entries.map(([seconds, amount]) => ({ t: seconds * 1000, totalMicro: parseAmount(amount), currency: 'CNY' }))
}

test('windowSpend is null while warming up', () => {
  assert.equal(windowSpend({ samples: [], now: 0, windowMs: 60_000 }).reason, 'warming')
  const two = samples([[0, '10'], [60, '9']])
  assert.equal(windowSpend({ samples: two, now: 60_000, windowMs: 60_000 }).spendMicro, parseAmount('1'))
})

test('windowSpend requires most of the window to be covered', () => {
  const short = samples([[0, '10'], [10, '9']])
  assert.equal(windowSpend({ samples: short, now: 20_000, windowMs: 60_000 }).reason, 'warming')
})

test('windowSpend computes the delta over exactly one window', () => {
  const data = samples([[0, '10'], [1800, '9'], [3600, '8']])
  const result = windowSpend({ samples: data, now: 3600_000, windowMs: 3600_000 })
  assert.equal(result.spendMicro, parseAmount('2'))
  assert.equal(result.reason, 'ok')
})

test('windowSpend clamps a top-up to zero', () => {
  const data = samples([[0, '10'], [3600, '12']])
  const result = windowSpend({ samples: data, now: 3600_000, windowMs: 3600_000 })
  assert.equal(result.spendMicro, 0)
  assert.equal(result.reason, 'reset')
})

test('windowSpend restarts on currency change', () => {
  const data = [
    { t: 0, totalMicro: parseAmount('10'), currency: 'CNY' },
    { t: 3600_000, totalMicro: parseAmount('9'), currency: 'USD' },
  ]
  assert.equal(windowSpend({ samples: data, now: 3600_000, windowMs: 3600_000 }).reason, 'warming')
})

test('windowSpend handles growing cost-counter samples', () => {
  const data = [
    { t: 0, totalMicro: -1_000_000, currency: 'CNY', kind: 'spend' },
    { t: 3600_000, totalMicro: -1_400_000, currency: 'CNY', kind: 'spend' },
  ]
  const result = windowSpend({ samples: data, now: 3600_000, windowMs: 3600_000 })
  assert.equal(result.spendMicro, 400_000)
  assert.equal(result.reason, 'ok')
})

test('windowSpend never mixes balance and cost samples', () => {
  const data = [
    { t: 0, totalMicro: -1_000_000, currency: 'CNY', kind: 'spend' },
    { t: 1800_000, totalMicro: 10_000_000, currency: 'CNY', kind: 'balance' },
    { t: 3600_000, totalMicro: -1_400_000, currency: 'CNY', kind: 'spend' },
  ]
  const result = windowSpend({ samples: data, now: 3600_000, windowMs: 3600_000 })
  assert.equal(result.spendMicro, 400_000)
})

test('appendSample keeps samples monotonic and trims', () => {
  const data = []
  appendSample(data, { t: 1000, totalMicro: 1, currency: 'CNY' })
  appendSample(data, { t: 1000, totalMicro: 99, currency: 'CNY' })
  appendSample(data, { t: 500, totalMicro: 5, currency: 'CNY' })
  assert.equal(data.length, 1)
  appendSample(data, { t: 2000, totalMicro: 2, currency: 'CNY', kind: 'spend' })
  appendSample(data, { t: 3000, totalMicro: 3, currency: 'CNY' })
  assert.equal(data[1].kind, 'spend')
  trimSamples(data, 2500)
  assert.deepEqual(data.map((sample) => sample.t), [2000, 3000])
})

// ------------------------------------------------------------------ sources

test('cost-meter source reads the daily counter in the configured currency', async () => {
  const ctx = {
    get: (name) => (name === 'costMeter'
      ? { getState: async () => ({ today: { apiCostCny: 2.5, apiCost: 0.35, cost: 0.4, costCny: 2.8 } }) }
      : undefined),
  }
  const cny = await readCostMeterSpend(ctx, { currency: 'CNY', usdCny: 7.2 })
  assert.equal(cny.ok, true)
  assert.equal(cny.source, 'cost-meter')
  assert.equal(cny.currency, 'CNY')
  assert.equal(cny.counterMicro, 2_500_000)

  const usd = await readCostMeterSpend(ctx, { currency: 'USD', usdCny: 7.2 })
  assert.equal(usd.ok, true)
  assert.equal(usd.counterMicro, 350_000)
})

test('cost-meter source reports absence instead of fabricating a value', async () => {
  const absent = await readCostMeterSpend({ get: () => undefined }, { currency: 'CNY' })
  assert.equal(absent.ok, false)
  assert.equal(absent.reason, 'cost-meter-absent')
  const empty = await readCostMeterSpend({ get: () => ({ getState: async () => ({}) }) }, { currency: 'CNY' })
  assert.equal(empty.ok, false)
  assert.equal(empty.reason, 'cost-meter-no-today')
})

// ------------------------------------------------------------------ control

test('sanitizeOverrides accepts presentation fields', () => {
  const result = sanitizeOverrides({
    media: 'auto', scrim: 0.1, dim: 0.03, blur: 4, surfaceOpacity: 0.5,
    lockedTier: '2', enabled: true,
  })
  assert.equal(result.ok, true, result.errors.join('; '))
  assert.equal(result.overrides.scrim, 0.1)
  assert.equal(result.overrides.lockedTier, '2')
})

test('removed pack format and direction are rejected', () => {
  assert.equal(sanitizeOverrides({ pack: 'deepseek-eats' }).ok, false)
  assert.equal(sanitizeOverrides({ direction: 'rich' }).ok, false)
})

test('removed frame mode and frame-only knobs are rejected', () => {
  assert.equal(sanitizeOverrides({ mode: 'full' }).ok, false)
  assert.equal(sanitizeOverrides({ mode: 'frame' }).ok, false)
  assert.equal(sanitizeOverrides({ inset: 16 }).ok, false)
  assert.equal(sanitizeOverrides({ radius: 16 }).ok, false)
})

test('sanitizeOverrides rejects invalid values', () => {
  assert.equal(sanitizeOverrides({ scrim: 2 }).ok, false)
  assert.equal(sanitizeOverrides({ lockedTier: '99' }).ok, false)
  assert.equal(sanitizeOverrides({ surprise: true }).ok, false)
})

test('sanitizeOverrides accepts custom scene names', () => {
  const result = sanitizeOverrides({ sceneNames: ['早饭', '', '晚饭'] })
  assert.equal(result.ok, true, result.errors.join('; '))
  assert.deepEqual(result.overrides.sceneNames, ['早饭', '', '晚饭'])
})

test('sanitizeOverrides rejects bad scene names', () => {
  assert.equal(sanitizeOverrides({ sceneNames: 'x' }).ok, false)
  assert.equal(sanitizeOverrides({ sceneNames: ['a'.repeat(41)] }).ok, false)
})

test('sanitizeOverrides reset clears overrides and ignores unknown data', () => {
  const result = sanitizeOverrides({ reset: true })
  assert.equal(result.ok, true)
  assert.deepEqual(result.overrides, {})
})

test('sanitizeOverrides accepts sampling and appearance knobs', () => {
  const result = sanitizeOverrides({
    transitionMs: 600, windowMinutes: 30, sampleSeconds: 120,
    hysteresis: 0.4, minDwellSeconds: 1800, thresholds: ['0', '0.02', '0.1', '0.5', '2'],
  })
  assert.equal(result.ok, true, result.errors.join('; '))
  assert.equal(result.overrides.windowMinutes, 30)
  assert.deepEqual(result.overrides.thresholds, ['0', '0.02', '0.1', '0.5', '2'])
})

test('sanitizeOverrides rejects malformed thresholds and out-of-range knobs', () => {
  assert.equal(sanitizeOverrides({ thresholds: ['0', '0.1', '0.05'] }).ok, false)
  assert.equal(sanitizeOverrides({ thresholds: ['0.1', '0.2'] }).ok, false)
  assert.equal(sanitizeOverrides({ windowMinutes: 0 }).ok, false)
  assert.equal(sanitizeOverrides({ sampleSeconds: 30.5 }).ok, false)
})

test('sanitizeStoredOverrides keeps only valid persisted values', () => {
  assert.deepEqual(sanitizeStoredOverrides({ mode: 'frame', scrim: 0.3 }), { scrim: 0.3 })
  assert.deepEqual(sanitizeStoredOverrides({ mode: 'bad' }), {})
  assert.deepEqual(sanitizeStoredOverrides(null), {})
})
