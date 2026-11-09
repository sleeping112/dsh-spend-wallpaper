/**
 * Tier resolution: map a spend observation onto a wallpaper tier with
 * hysteresis and a minimum dwell time so the background does not flap while a
 * value sits on a boundary.
 */

import { cmpAmount, mulRatio, parseAmount } from './money.js'

/**
 * Resolve the active tier index.
 *
 * @param {object} input
 * @param {number|null} input.spendMicro hourly spend in micro-units, or null when unknown
 * @param {number[]} input.thresholdsMicro ascending thresholds, first entry 0
 * @param {number} input.currentIndex current tier index
 * @param {number} input.changedAt epoch ms when the current tier started
 * @param {number} input.now epoch ms
 * @param {number} input.hysteresis ratio (0..1) of the crossed boundary that must be exceeded
 * @param {number} input.minDwellMs minimum time a tier stays active
 * @returns {{ index: number, changedAt: number, pendingIndex: number|null }}
 */
export function resolveTier({ spendMicro, thresholdsMicro, currentIndex, changedAt, now, hysteresis, minDwellMs }) {
  const clampedCurrent = clampIndex(currentIndex, thresholdsMicro.length)
  if (spendMicro === null || !Number.isFinite(spendMicro)) {
    return { index: clampedCurrent, changedAt, pendingIndex: null }
  }
  let target = 0
  for (let index = 0; index < thresholdsMicro.length; index += 1) {
    if (cmpAmount(spendMicro, thresholdsMicro[index]) >= 0) target = index
  }
  if (target === clampedCurrent) {
    return { index: clampedCurrent, changedAt, pendingIndex: null }
  }

  const goingUp = target > clampedCurrent
  const boundary = goingUp ? thresholdsMicro[target] : thresholdsMicro[clampedCurrent]
  const overshoot = goingUp
    ? spendMicro - boundary
    : boundary - spendMicro
  const required = mulRatio(boundary, Math.max(0, hysteresis))
  if (overshoot < required) {
    return { index: clampedCurrent, changedAt, pendingIndex: null }
  }
  if (now - changedAt < minDwellMs) {
    return { index: clampedCurrent, changedAt, pendingIndex: target }
  }
  return { index: target, changedAt: now, pendingIndex: null }
}

export function clampIndex(index, count) {
  if (!Number.isFinite(index)) return 0
  const rounded = Math.trunc(index)
  if (rounded < 0) return 0
  if (rounded >= count) return count - 1
  return rounded
}

/**
 * Map the spend tier onto a wallpaper slot inside a pack.
 *
 * `direction: 'poor'` uses the pack order as authored (tier 0 calm .. tier N
 * loud). `direction: 'rich'` reverses the mapping so spending more reveals the
 * calmest artwork instead.
 */
export function mapPackIndex(tierIndex, packTierCount, packDirection, direction) {
  const count = Math.max(1, packTierCount)
  const index = clampIndex(tierIndex, count)
  const effective = packDirection === 'rich' ? 'rich' : 'poor'
  if (direction === 'rich' && effective === 'poor') return count - 1 - index
  if (direction === 'poor' && effective === 'rich') return count - 1 - index
  return index
}

/** Parse and validate the configured tier table. */
export function parseTierTable(thresholds) {
  const micros = thresholds.map(parseAmount)
  if (micros[0] !== 0) throw new RangeError('thresholds[0] must be 0')
  for (let index = 1; index < micros.length; index += 1) {
    if (micros[index] <= micros[index - 1]) throw new RangeError('thresholds must be strictly ascending')
  }
  return micros
}

/**
 * The next threshold above a tier, or null for the top tier.
 */
export function nextThreshold(thresholdsMicro, index) {
  const next = thresholdsMicro[index + 1]
  return next === undefined ? null : next
}
