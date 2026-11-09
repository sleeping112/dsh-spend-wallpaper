/**
 * Rolling-window spend computation over persisted balance samples.
 *
 * A sample is `{ t, totalMicro, currency }` where `totalMicro` is the summed
 * wallet balance (top-up + granted) in micro-units. Samples are kept sorted by
 * time and only one currency is ever considered at a time; a currency switch
 * restarts the warm-up window instead of producing a bogus delta.
 */

export const SAMPLE_SCHEMA = 1

/** Binary-search the last sample whose `t` is <= `time`. */
export function lastAtOrBefore(samples, time) {
  if (!Array.isArray(samples) || samples.length === 0) return null
  let low = 0
  let high = samples.length - 1
  let answer = null
  while (low <= high) {
    const mid = (low + high) >> 1
    if (samples[mid].t <= time) {
      answer = samples[mid]
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return answer
}

/**
 * Compute spend over `windowMs` ending at `now`.
 *
 * @returns {{ spendMicro: number|null, reason: 'ok'|'warming'|'reset', resetAt: number|null }}
 */
export function windowSpend({ samples, now, windowMs }) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return { spendMicro: null, reason: 'warming', resetAt: null }
  }
  const currency = samples[samples.length - 1].currency
  const sameCurrency = samples.filter((sample) => sample.currency === currency)
  if (sameCurrency.length < 2) {
    return { spendMicro: null, reason: 'warming', resetAt: null }
  }
  const from = now - windowMs
  const older = lastAtOrBefore(sameCurrency, from)
  const newer = lastAtOrBefore(sameCurrency, now)
  if (older === null || newer === null) {
    return { spendMicro: null, reason: 'warming', resetAt: null }
  }
  // The two ends must span most of the requested window; otherwise the plugin
  // was just installed and the 1-hour answer would be misleading.
  if (newer.t - older.t < Math.floor(windowMs * 0.75)) {
    return { spendMicro: null, reason: 'warming', resetAt: null }
  }
  const delta = older.totalMicro - newer.totalMicro
  if (delta < 0) {
    // Top-up, wallet switch, or granted balance reclaimed: not a negative spend.
    return { spendMicro: 0, reason: 'reset', resetAt: now }
  }
  return { spendMicro: delta, reason: 'ok', resetAt: null }
}

/** Append a sample if it is newer than the current tail. Returns true when stored. */
export function appendSample(samples, sample, maxSamples = 4096) {
  if (!sample || !Number.isFinite(sample.t) || !Number.isFinite(sample.totalMicro)) return false
  const tail = samples[samples.length - 1]
  if (tail !== undefined && sample.t <= tail.t) return false
  samples.push(sample)
  while (samples.length > maxSamples) samples.shift()
  return true
}

/** Drop every sample older than `keepAfter`, keeping at least two entries. */
export function trimSamples(samples, keepAfter) {
  let cut = 0
  while (cut < samples.length - 2 && samples[cut].t < keepAfter) cut += 1
  if (cut > 0) samples.splice(0, cut)
}
