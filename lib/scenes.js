/**
 * Built-in scene list + helpers. The old "pack" format (manifest + pack id) is
 * gone: each tier/threshold now has its own scene, which can be replaced by a
 * user-uploaded image or video.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCENES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'scenes')

export const BUILTIN_SCENES = [
  { id: 'feast', label: { zh: '满汉全席', en: 'Grand Feast' }, image: '0-feast.webp', video: '0-feast.webm' },
  { id: 'ramen', label: { zh: '拉面自由', en: 'Ramen Day' }, image: '1-ramen.webp', video: '1-ramen.webm' },
  { id: 'curry', label: { zh: '咖喱饭', en: 'Curry Rice' }, image: '2-curry.webp', video: '2-curry.webm' },
  { id: 'rice', label: { zh: '白饭梅干', en: 'Rice & Pickle' }, image: '3-rice.webp', video: '3-rice.webm' },
  { id: 'empty', label: { zh: '空碗', en: 'Empty Bowl' }, image: '4-empty.webp', video: '4-empty.webm' },
]

export const MIN_TIERS = 2
export const MAX_TIERS = 8

export const FIT_MODES = ['cover', 'contain', 'fill']
export const DEFAULT_SCENE_SETTINGS = { fit: 'cover', x: 50, y: 50, scale: 1 }

/** Normalize one tier's display settings (used by snapshot/wallpaper/control). */
export function normalizeSceneSettings(value) {
  const raw = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const fit = FIT_MODES.includes(raw.fit) ? raw.fit : DEFAULT_SCENE_SETTINGS.fit
  const clampNumber = (input, fallback, min, max) => {
    const parsed = Number(input)
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
  }
  return {
    fit,
    x: clampNumber(raw.x, DEFAULT_SCENE_SETTINGS.x, 0, 100),
    y: clampNumber(raw.y, DEFAULT_SCENE_SETTINGS.y, 0, 100),
    scale: clampNumber(raw.scale, DEFAULT_SCENE_SETTINGS.scale, 1, 3),
  }
}


export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'])
export const VIDEO_EXTENSIONS = new Set(['.webm', '.mp4', '.mov', '.m4v'])

export function normalizedExtension(name) {
  const ext = path.extname(String(name)).toLowerCase()
  if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) return ext
  return null
}

export function contentTypeForExt(ext) {
  switch (ext) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.avif': return 'image/avif'
    case '.webm': return 'video/webm'
    case '.mp4': return 'video/mp4'
    case '.mov': return 'video/quicktime'
    case '.m4v': return 'video/x-m4v'
    default: return 'application/octet-stream'
  }
}

export function extensionForContentType(contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  switch (type) {
    case 'image/png': return '.png'
    case 'image/jpeg': return '.jpg'
    case 'image/webp': return '.webp'
    case 'image/gif': return '.gif'
    case 'image/avif': return '.avif'
    case 'video/webm': return '.webm'
    case 'video/mp4': return '.mp4'
    case 'video/quicktime': return '.mov'
    case 'video/x-m4v': return '.m4v'
    default: return null
  }
}

export function builtinFor(index) {
  return BUILTIN_SCENES[index] ?? BUILTIN_SCENES[BUILTIN_SCENES.length - 1]
}

export function sceneLabel(index, custom) {
  if (custom) return { zh: `自定义场景 ${index + 1}`, en: `Custom scene ${index + 1}` }
  return builtinFor(index).label
}
