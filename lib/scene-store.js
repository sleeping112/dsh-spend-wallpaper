/**
 * Scene storage: built-in scenes are copied into a writable directory so the
 * existing asset-serving code can treat them as ordinary files, and user
 * uploads live next to them. There is no pack manifest on disk anymore; the
 * host synthesizes a single virtual pack from the current tier count + uploads.
 */

import fs from 'node:fs'
import path from 'node:path'

import {
  BUILTIN_SCENES,
  IMAGE_EXTENSIONS,
  MAX_TIERS,
  MIN_TIERS,
  SCENES_DIR,
  extensionForContentType,
  normalizedExtension,
} from './scenes.js'

export const SCENE_PACK_ID = 'scenes'

export function sceneStorageDir(storageRoot) {
  return path.join(storageRoot, 'scenes')
}

/** Copy built-in media into the writable scene dir (idempotent). */
export function ensureBuiltinScenes(dir) {
  fs.mkdirSync(dir, { recursive: true })
  BUILTIN_SCENES.forEach((scene, index) => {
    for (const name of [scene.image, scene.video]) {
      const source = path.join(SCENES_DIR, name)
      const target = path.join(dir, `builtin-${index}${path.extname(name)}`)
      try {
        if (!fs.existsSync(target) || fs.statSync(target).size !== fs.statSync(source).size) {
          fs.copyFileSync(source, target)
        }
      } catch {
        // A missing built-in file just means that tier has no fallback.
      }
    }
  })
}

export function clampTierCount(value) {
  const count = Math.round(Number(value))
  if (!Number.isFinite(count)) return 5
  return Math.max(MIN_TIERS, Math.min(MAX_TIERS, count))
}

/**
 * Build the synthesized pack description for the current tier count + uploads.
 * @param {string} dir writable scene directory
 * @param {object} overrides { [tierIndex]: { file, kind } }
 * @param {number} tierCount
 */
export function buildScenePack(dir, overrides, tierCount) {
  const count = clampTierCount(tierCount)
  const tiers = []
  for (let index = 0; index < count; index += 1) {
    const builtin = BUILTIN_SCENES[Math.min(index, BUILTIN_SCENES.length - 1)]
    const override = overrides?.[String(index)] ?? overrides?.[index]
    let staticName = `builtin-${Math.min(index, BUILTIN_SCENES.length - 1)}.webp`
    let dynamicName = `builtin-${Math.min(index, BUILTIN_SCENES.length - 1)}.webm`
    let custom = false
    let label = builtin.label
    if (override && typeof override.file === 'string') {
      const ext = normalizedExtension(override.file)
      if (ext !== null && fs.existsSync(path.join(dir, override.file))) {
        custom = true
        label = { zh: `自定义场景 ${index + 1}`, en: `Custom scene ${index + 1}` }
        if (IMAGE_EXTENSIONS.has(ext)) {
          staticName = override.file
          dynamicName = null
        } else {
          staticName = null
          dynamicName = override.file
        }
      }
    }
    tiers.push({
      id: `tier-${index}`,
      label,
      min: '0',
      static: staticName,
      dynamic: dynamicName === null ? null : { type: 'video', src: dynamicName, poster: staticName },
      custom,
    })
  }
  return {
    id: SCENE_PACK_ID,
    dir,
    manifest: {
      schema: 1,
      id: SCENE_PACK_ID,
      name: { zh: '自定义场景', en: 'Custom Scenes' },
      direction: 'poor',
      license: 'CC0-1.0',
      tiers,
    },
  }
}

export function uploadSceneFile(dir, index, buffer, contentType) {
  const tierIndex = Number(index)
  if (!Number.isInteger(tierIndex) || tierIndex < 0 || tierIndex > MAX_TIERS - 1) {
    return { ok: false, error: 'invalid tier index' }
  }
  const extension = extensionForContentType(contentType)
  if (extension === null) return { ok: false, error: 'only image or video uploads are supported' }
  fs.mkdirSync(dir, { recursive: true })
  const file = `custom-${tierIndex}${extension}`
  fs.writeFileSync(path.join(dir, file), buffer)
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(`custom-${tierIndex}.`) && name !== file) {
      try { fs.unlinkSync(path.join(dir, name)) } catch { /* ignore */ }
    }
  }
  return { ok: true, file, kind: IMAGE_EXTENSIONS.has(extension) ? 'image' : 'video' }
}
