/**
 * Wallpaper pack discovery + manifest validation.
 *
 * Packs live either inside the plugin (`lib/assets/packs/<id>/`) or under
 * `$DSH_HOME/spend-wallpaper/packs/<id>/`; a user pack with the same id as a
 * built-in pack wins. Manifests are deliberately small and validated by hand so
 * a broken pack can never take the plugin down: it is skipped with a diagnostic.
 */

import fs from 'node:fs'
import path from 'node:path'

export const PACK_SCHEMA = 1
export const DEFAULT_PACK_ID = 'default'

const IMAGE_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.png', '.avif', '.gif', '.apng'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm'])
const CONTENT_TYPES = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.apng': 'image/apng',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

const PACK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** Localized text helper: strings or `{ zh, en }` maps. */
export function localizedText(value, locale = 'zh') {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const preferred = value[locale] ?? value.zh ?? value.en
    if (typeof preferred === 'string' && preferred.length > 0) return preferred
  }
  return ''
}

/**
 * Validate one dynamic object from a manifest.
 * @returns {{ type: 'video'|'image', src: string, poster: string|null }|null}
 */
function validateDynamic(dynamic, label) {
  if (dynamic === undefined || dynamic === null) return null
  if (typeof dynamic !== 'object' || Array.isArray(dynamic)) throw new TypeError(`${label}: dynamic must be an object`)
  const type = dynamic.type === 'image' ? 'image' : dynamic.type === 'video' ? 'video' : null
  if (type === null) throw new TypeError(`${label}: dynamic.type must be "video" or "image"`)
  if (typeof dynamic.src !== 'string' || dynamic.src.length === 0) throw new TypeError(`${label}: dynamic.src is required`)
  const poster = typeof dynamic.poster === 'string' && dynamic.poster.length > 0 ? dynamic.poster : null
  return { type, src: dynamic.src, poster }
}

/** Validate a manifest object; throws with a human-readable message. */
export function validateManifest(manifest, packId) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new TypeError('manifest must be an object')
  if (manifest.schema !== PACK_SCHEMA) throw new TypeError(`manifest.schema must be ${PACK_SCHEMA}`)
  if (manifest.id !== packId) throw new TypeError(`manifest.id "${manifest.id}" does not match directory "${packId}"`)
  if (!Array.isArray(manifest.tiers) || manifest.tiers.length === 0) throw new TypeError('manifest.tiers must be a non-empty array')
  const tiers = manifest.tiers.map((raw, index) => {
    const label = `tiers[${index}]`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} must be an object`)
    if (typeof raw.id !== 'string' || raw.id.length === 0) throw new TypeError(`${label}.id is required`)
    if (typeof raw.static !== 'string' || raw.static.length === 0) throw new TypeError(`${label}.static is required`)
    return {
      id: raw.id,
      min: typeof raw.min === 'string' ? raw.min : String(raw.min ?? '0'),
      label: raw.label ?? raw.id,
      static: raw.static,
      dynamic: validateDynamic(raw.dynamic, label),
    }
  })
  return {
    schema: PACK_SCHEMA,
    id: packId,
    name: manifest.name ?? packId,
    description: manifest.description ?? '',
    author: typeof manifest.author === 'string' ? manifest.author : '',
    license: typeof manifest.license === 'string' ? manifest.license : '',
    direction: manifest.direction === 'rich' ? 'rich' : 'poor',
    defaults: manifest.defaults && typeof manifest.defaults === 'object' ? manifest.defaults : {},
    tiers,
  }
}

/** True when `candidate` resolves inside `root` (and not `root` itself). */
export function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/** Validate a relative asset filename from a manifest: no separators, allowed extension. */
export function validateAssetName(packId, name) {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError(`pack ${packId}: asset name is required`)
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    throw new TypeError(`pack ${packId}: asset name "${name}" must be a plain file name`)
  }
  const extension = path.extname(name).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension) && !VIDEO_EXTENSIONS.has(extension)) {
    throw new TypeError(`pack ${packId}: unsupported asset type "${name}"`)
  }
  return name
}

function readManifestFrom(dir, packId) {
  const manifestPath = path.join(dir, 'manifest.json')
  const raw = fs.readFileSync(manifestPath, 'utf8')
  const parsed = JSON.parse(raw)
  const manifest = validateManifest(parsed, packId)
  for (const tier of manifest.tiers) {
    validateAssetName(packId, tier.static)
    if (tier.dynamic !== null) {
      validateAssetName(packId, tier.dynamic.src)
      if (tier.dynamic.poster !== null) validateAssetName(packId, tier.dynamic.poster)
    }
  }
  // Every referenced static file must exist; a missing dynamic file only falls
  // back to the static sibling (reported by the runtime snapshot).
  for (const tier of manifest.tiers) {
    if (!fs.existsSync(path.join(dir, tier.static))) {
      throw new TypeError(`pack ${packId}: missing static asset "${tier.static}"`)
    }
  }
  return { id: packId, dir, manifest }
}

/**
 * Discover packs from the built-in directory and the user directory.
 * @returns {{ packs: Map<string, object>, order: string[], diagnostics: Array<{ pack: string, message: string }> }}
 */
export function loadPacks({ builtinDir, userDir }) {
  const packs = new Map()
  const order = []
  const diagnostics = []
  const scan = (dir) => {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !PACK_ID_RE.test(entry.name)) continue
      const packDir = path.join(dir, entry.name)
      if (!fs.existsSync(path.join(packDir, 'manifest.json'))) continue
      try {
        const pack = readManifestFrom(packDir, entry.name)
        if (!packs.has(entry.name)) order.push(entry.name)
        packs.set(entry.name, pack)
      } catch (error) {
        diagnostics.push({ pack: entry.name, message: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  scan(builtinDir)
  scan(userDir)
  return { packs, order, diagnostics }
}

/** Resolve a pack by id, falling back to the built-in default. */
export function resolvePack(packs, packId) {
  if (packId && packs.has(packId)) return packs.get(packId)
  if (packs.has(DEFAULT_PACK_ID)) return packs.get(DEFAULT_PACK_ID)
  const first = packs.values().next()
  return first.done ? null : first.value
}

/**
 * Resolve one asset file inside a pack.
 * @returns {{ path: string, contentType: string }|null}
 */
export function resolveAsset(pack, name) {
  let safe
  try {
    safe = validateAssetName(pack.id, name)
  } catch {
    return null
  }
  const candidate = path.resolve(pack.dir, safe)
  if (!isInside(pack.dir, candidate)) return null
  let real
  try {
    real = fs.realpathSync(candidate)
  } catch {
    return null
  }
  if (!isInside(fs.realpathSync(pack.dir), real)) return null
  let stat
  try {
    stat = fs.statSync(real)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  return { path: real, contentType: CONTENT_TYPES[path.extname(real).toLowerCase()] ?? 'application/octet-stream', mtimeMs: stat.mtimeMs }
}

/** Public (wire) description of one pack. */
export function describePack(pack, locale = 'zh') {
  return {
    id: pack.id,
    name: localizedText(pack.manifest.name, locale) || pack.id,
    direction: pack.manifest.direction,
    tiers: pack.manifest.tiers.map((tier) => ({
      id: tier.id,
      label: localizedText(tier.label, locale) || tier.id,
      min: tier.min,
      static: tier.static,
      dynamic: tier.dynamic,
    })),
  }
}
