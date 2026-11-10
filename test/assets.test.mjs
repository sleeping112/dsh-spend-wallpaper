/**
 * Built-in asset pack integrity checks: manifest schema, referenced files,
 * magic bytes, size budgets, and localization completeness.
 *
 * Every pack under `lib/assets/packs/` is checked, so adding a new shipped pack
 * automatically gets the same guard rails.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packsDir = path.join(root, 'lib', 'assets', 'packs')

function readMagic(file, bytes) {
  const buffer = Buffer.alloc(bytes)
  const descriptor = fs.openSync(file, 'r')
  try {
    fs.readSync(descriptor, buffer, 0, bytes, 0)
  } finally {
    fs.closeSync(descriptor)
  }
  return buffer
}

const packs = fs
  .readdirSync(packsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .map((id) => {
    const dir = path.join(packsDir, id)
    return { id, dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) }
  })

test('at least the two shipped packs exist', () => {
  assert.ok(packs.some((pack) => pack.id === 'default'))
  assert.ok(packs.some((pack) => pack.id === 'deepseek-eats'))
})

for (const pack of packs) {
  test(`${pack.id}: manifest covers five tiers with zh/en labels`, () => {
    assert.equal(pack.manifest.schema, 1)
    assert.equal(pack.manifest.id, pack.id)
    assert.equal(pack.manifest.tiers.length, 5)
    assert.equal(pack.manifest.direction, 'poor')
    for (const tier of pack.manifest.tiers) {
      assert.match(tier.id, /^[a-z0-9-]+$/)
      assert.ok(tier.label?.zh && tier.label?.en, `tier ${tier.id} needs zh/en labels`)
      assert.ok(tier.static, `tier ${tier.id} needs a static asset`)
      assert.ok(tier.dynamic?.src, `tier ${tier.id} should ship a dynamic asset`)
    }
  })

  test(`${pack.id}: every referenced asset exists and is a plausible media file`, () => {
    for (const tier of pack.manifest.tiers) {
      const staticFile = path.join(pack.dir, tier.static)
      const stat = fs.statSync(staticFile)
      assert.ok(stat.size > 1024, `${tier.static} must not be empty`)
      assert.ok(stat.size < 16 * 1024 * 1024, `${tier.static} exceeds 16 MiB`)
      const webp = readMagic(staticFile, 12)
      assert.equal(webp.toString('ascii', 0, 4), 'RIFF', `${tier.static} must be a RIFF container`)
      assert.equal(webp.toString('ascii', 8, 12), 'WEBP', `${tier.static} must be a WebP image`)

      const videoFile = path.join(pack.dir, tier.dynamic.src)
      const videoStat = fs.statSync(videoFile)
      assert.ok(videoStat.size > 1024, `${tier.dynamic.src} must not be empty`)
      assert.ok(videoStat.size < 16 * 1024 * 1024, `${tier.dynamic.src} exceeds 16 MiB`)
      const ebml = readMagic(videoFile, 4)
      assert.equal(ebml.readUInt32BE(0), 0x1a45dfa3, `${tier.dynamic.src} must be a WebM/EBML file`)
    }
  })

  test(`${pack.id}: pack ships a redistributable license`, () => {
    assert.match(pack.manifest.license, /CC0|MIT|CC-BY/i)
    assert.ok(fs.existsSync(path.join(root, 'LICENSE')))
  })
}
