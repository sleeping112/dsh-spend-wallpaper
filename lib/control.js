/**
 * Validation for runtime wallpaper overrides (the quick-switch UI and CLI).
 *
 * These overrides live in the plugin's own state file (`state.json`) and take
 * precedence over the profile config. They intentionally cover only the
 * presentation knobs, not the data-source/window settings.
 */

const MEDIA = ['auto', 'static', 'dynamic']
const DIRECTIONS = ['poor', 'rich']
const PACK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ALLOWED_FIELDS = new Set(['pack', 'media', 'direction', 'enabled', 'lockedTier', 'scrim', 'dim',
  'surfaceOpacity', 'blur', 'transitionMs', 'hysteresis', 'windowMinutes',
  'sampleSeconds', 'minDwellSeconds', 'thresholds'])

import { formatAmount, parseAmount } from './money.js'

function numberInRange(value, min, max, field, errors) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    errors.push(`${field} must be a number in [${min}, ${max}]`)
    return undefined
  }
  return parsed
}

function integerInRange(value, min, max, field, errors) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    errors.push(`${field} must be an integer in [${min}, ${max}]`)
    return undefined
  }
  return parsed
}

function sanitizeThresholds(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 6) return null
  try {
    const micros = value.map((item) => parseAmount(String(item)))
    if (micros[0] !== 0) return null
    for (let index = 1; index < micros.length; index += 1) {
      if (micros[index] <= micros[index - 1]) return null
    }
    return micros.map((micro) => formatAmount(micro))
  } catch {
    return null
  }
}

/**
 * Sanitize a control patch.
 * @param {object} patch raw JSON body
 * @returns {{ ok: boolean, overrides: object, errors: string[] }}
 */
export function sanitizeOverrides(patch) {
  const errors = []
  const overrides = {}
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, overrides, errors: ['body must be a JSON object'] }
  }
  if (patch.reset === true) return { ok: true, overrides, errors }
  if ('pack' in patch) {
    if (typeof patch.pack !== 'string' || !PACK_ID.test(patch.pack)) errors.push('pack must be a pack id')
    else overrides.pack = patch.pack
  }
  if ('media' in patch) {
    if (!MEDIA.includes(patch.media)) errors.push(`media must be one of ${MEDIA.join(', ')}`)
    else overrides.media = patch.media
  }
  if ('direction' in patch) {
    if (!DIRECTIONS.includes(patch.direction)) errors.push(`direction must be one of ${DIRECTIONS.join(', ')}`)
    else overrides.direction = patch.direction
  }
  if ('enabled' in patch) {
    if (typeof patch.enabled !== 'boolean') errors.push('enabled must be a boolean')
    else overrides.enabled = patch.enabled
  }
  if ('lockedTier' in patch) {
    const value = patch.lockedTier
    const okay = value === '' ||
      (typeof value === 'string' && (/^\d+$/.test(value) ? Number(value) <= 4 : /^[a-z0-9-]{1,32}$/i.test(value)))
    if (!okay) errors.push('lockedTier must be "", 0-4, or a tier id')
    else overrides.lockedTier = value
  }
  for (const [field, min, max] of [['scrim', 0, 1], ['dim', 0, 1], ['surfaceOpacity', 0.2, 1], ['blur', 0, 24],
    ['transitionMs', 0, 5000], ['hysteresis', 0, 1]]) {
    if (field in patch) {
      const value = numberInRange(patch[field], min, max, field, errors)
      if (value !== undefined) overrides[field] = value
    }
  }
  for (const [field, min, max] of [['windowMinutes', 5, 180], ['sampleSeconds', 60, 600], ['minDwellSeconds', 60, 3600]]) {
    if (field in patch) {
      const value = integerInRange(patch[field], min, max, field, errors)
      if (value !== undefined) overrides[field] = value
    }
  }
  if ('thresholds' in patch) {
    const thresholds = sanitizeThresholds(patch.thresholds)
    if (thresholds === null) errors.push('thresholds must be 2-6 ascending decimal strings starting at 0')
    else overrides.thresholds = thresholds
  }
  const unknown = Object.keys(patch).filter((key) => key !== 'reset' && !ALLOWED_FIELDS.has(key))
  for (const key of unknown) errors.push(`unknown field ${key}`)
  return { ok: errors.length === 0, overrides, errors }
}

/** Remove empty/invalid values loaded from persistence (best effort). */
export function sanitizeStoredOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  // Persisted overrides may come from older versions (e.g. the removed
  // `mode`/`inset`/`radius` fields); drop unknown keys instead of discarding
  // every valid setting in the same object.
  const filtered = {}
  for (const [key, item] of Object.entries(value)) {
    if (ALLOWED_FIELDS.has(key)) filtered[key] = item
  }
  const { ok, overrides } = sanitizeOverrides(filtered)
  return ok ? overrides : {}
}
