/**
 * Fixed-point money helpers.
 *
 * Every amount crossing this plugin is a decimal string (or number) and is
 * converted to an integer number of micro-units (1e-6 of the currency unit).
 * Integer arithmetic keeps balance deltas and threshold comparisons exact up
 * to ~9e9 units, which is far beyond any wallet balance we care about.
 */

const SCALE = 1_000_000
const MAX_MICRO = Number.MAX_SAFE_INTEGER

/** Parse a decimal amount into integer micro-units. Throws on malformed input. */
export function parseAmount(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`invalid amount: ${value}`)
    const micro = Math.round(value * SCALE)
    if (!Number.isSafeInteger(micro)) throw new RangeError(`amount out of range: ${value}`)
    return micro
  }
  if (typeof value !== 'string') throw new TypeError(`invalid amount: ${String(value)}`)
  const text = value.trim()
  if (text.length === 0) throw new TypeError('invalid amount: empty')
  const match = /^([+-]?)(\d+)(?:\.(\d{1,6}))?$/.exec(text)
  if (match === null) throw new SyntaxError(`invalid amount: ${value}`)
  const [, sign, whole, fraction = ''] = match
  const micro = Number(whole) * SCALE + Number(fraction.padEnd(6, '0'))
  if (!Number.isSafeInteger(micro)) throw new RangeError(`amount out of range: ${value}`)
  return sign === '-' ? -micro : micro
}

/** Format integer micro-units back to a trimmed decimal string. */
export function formatAmount(micro) {
  if (!Number.isFinite(micro)) return '0'
  const negative = micro < 0
  const abs = Math.abs(Math.round(micro))
  const whole = Math.floor(abs / SCALE)
  const fraction = String(abs % SCALE).padStart(6, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction.length > 0 ? `.${fraction}` : ''}`
}

export function addAmount(a, b) {
  return a + b
}

export function subAmount(a, b) {
  return a - b
}

export function cmpAmount(a, b) {
  return a === b ? 0 : a < b ? -1 : 1
}

/** Multiply by a plain ratio (e.g. hysteresis), rounding to the nearest micro. */
export function mulRatio(micro, ratio) {
  return Math.round(micro * ratio)
}

/** Normalize a configured threshold list into ascending micro-units starting at 0. */
export function normalizeThresholds(list) {
  if (!Array.isArray(list) || list.length === 0) throw new TypeError('thresholds must be a non-empty array')
  const parsed = list.map((value, index) => {
    try {
      return parseAmount(value)
    } catch (error) {
      throw new TypeError(`thresholds[${index}]: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  parsed[0] = 0
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index] <= parsed[index - 1]) {
      throw new RangeError(`thresholds must be strictly ascending (index ${index})`)
    }
  }
  return parsed
}

/** Format an amount for the diagnostics/state payload, keeping the currency code. */
export function formatMoney(micro, currency) {
  return { amount: formatAmount(micro), currency }
}

/** Convert between currencies using a plain decimal ratio (e.g. 7.2 CNY per USD). */
export function convertAmount(micro, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return micro
  return Math.round(micro * ratio)
}

export function clampSafe(micro) {
  if (!Number.isFinite(micro)) return 0
  if (micro > MAX_MICRO) return MAX_MICRO
  if (micro < -MAX_MICRO) return -MAX_MICRO
  return Math.round(micro)
}
