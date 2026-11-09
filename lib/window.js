/**
 * Rolling-window spend computation over persisted samples.
 *
 * A sample is `{ t, totalMicro, currency, kind }`:
 *  - `kind: 'balance'` — `totalMicro` is the wallet balance; spend is
 *    `older − newer` (the balance fell while you used it).
 *  - `kind: 'spend'` — `totalMicro` is the **negated** cumulative cost counter
 *    (local estimated cost, e.g. from dsh-cost-meter); spend is still
 *    `older − newer`, so a growing counter yields a positive delta.
 *
 * Samples are kept sorted by time. Only one currency and one kind are compared
 * at a time; switching source/currency restarts the warm-up window instead of
 * producing a bogus delta.
 */

export const SAMPLE_SCHEMA = 1

export function sampleKind(sample) {
  return sample?.kind === 'spend' ? 'spend' : 'balance'
}

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
  const tail = samples[samples.length - 1]
  const currency = tail.currency
  const kind = sampleKind(tail)
  const comparable = samples.filter((sample) => sample.currency === currency && sampleKind(sample) === kind)
  if (comparable.length < 2) {
    return { spendMicro: null, reason: 'warming', resetAt: null }
  }
  const from = now - windowMs
  const older = lastAtOrBefore(comparable, from)
  const newer = lastAtOrBefore(comparable, now)
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
    // Balance top-up / granted balance reclaimed; a cost counter never goes
    // negative except at the local-midnight reset of its source.
    return { spendMicro: 0, reason: 'reset', resetAt: now }
  }
  return { spendMicro: delta, reason: 'ok', resetAt: null }
}

/** Append a sample if it is newer than the current tail. Returns true when stored. */
export function appendSample(samples, sample, maxSamples = 4096) {
  if (!sample || !Number.isFinite(sample.t) || !Number.isFinite(sample.totalMicro)) return false
  const tail = samples[samples.length - 1]
  if (tail !== undefined && sample.t <= tail.t) return false
  samples.push({
    t: sample.t,
    totalMicro: sample.totalMicro,
    currency: sample.currency,
    kind: sampleKind(sample),
  })
  while (samples.length > maxSamples) samples.shift()
  return true
}

/** Drop every sample older than `keepAfter`, keeping at least two entries. */
export function trimSamples(samples, keepAfter) {
  let cut = 0
  while (cut < samples.length - 2 && samples[cut].t < keepAfter) cut += 1
  if (cut > 0) samples.splice(0, cut)
}
