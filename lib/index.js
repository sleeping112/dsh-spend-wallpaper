/**
 * dsh-spend-wallpaper — host half.
 *
 * Samples the DeepSeek wallet (account login or open-platform API key) on an
 * interval, turns the balance delta over a rolling window into an hourly spend,
 * maps it to a wallpaper tier and exposes the resulting snapshot over
 * `/plugins/dsh-spend-wallpaper/*` for the browser half to paint.
 */

import { fileURLToPath } from 'node:url'

import z from '@deepseek-ai/schemastery'

import { formatAmount, parseAmount } from './money.js'
import { clampIndex, mapPackIndex, nextThreshold, resolveTier } from './tiers.js'
import { appendSample, trimSamples, windowSpend } from './window.js'
import { loadPacks, resolveAsset, resolvePack } from './packs.js'
import { readAccountBalance, readApiBalance, readCostMeterSpend, readManualSpend, sourcePlan } from './sources.js'
import { DebouncedStateWriter, loadState, stateFilePath, userPacksDir } from './store.js'
import { ASSET_PREFIX, registerRoutes as registerHttpRoutes } from './http.js'
import { sanitizeOverrides, sanitizeStoredOverrides } from './control.js'

const DEFAULT_THRESHOLDS = ['0', '0.05', '0.30', '1.50', '6.00']
const BUILTIN_PACKS_DIR = fileURLToPath(new URL('./assets/packs', import.meta.url))
const REFRESH_THROTTLE_MS = 10_000

function numberOr(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function failureText(failure) {
  if (!failure) return null
  const code = String(failure.reason ?? 'unknown')
  const message = typeof failure.message === 'string' ? failure.message : ''
  return message.length > 0 ? `${code}: ${message}` : code
}

export const name = 'spend-wallpaper'

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  source: z.union(['auto', 'account', 'api', 'cost-meter', 'manual']).default('auto').volatile(),
  currency: z.union(['CNY', 'USD']).default('CNY').volatile(),
  usdCny: z.number().default(7.2).volatile(),
  apiBase: z.string().default('https://api.deepseek.com').volatile(),
  apiKeyEnv: z.string().default('DEEPSEEK_API_KEY').volatile(),
  locale: z.string().default('zh').volatile(),
  windowMinutes: z.number().min(5).max(180).default(60).volatile(),
  sampleSeconds: z.number().min(60).max(600).default(180).volatile(),
  direction: z.union(['poor', 'rich']).default('poor').volatile(),
  mode: z.union(['frame', 'full']).default('full').volatile(),
  media: z.union(['auto', 'static', 'dynamic']).default('auto').volatile(),
  pack: z.string().default('deepseek-eats').volatile(),
  scrim: z.number().min(0).max(1).default(0.10).volatile(),
  dim: z.number().min(0).max(1).default(0.03).volatile(),
  blur: z.number().min(0).max(24).default(0).volatile(),
  surfaceOpacity: z.number().min(0.2).max(1).default(0.50).volatile(),
  inset: z.number().min(0).max(64).default(16).volatile(),
  radius: z.number().min(0).max(48).default(16).volatile(),
  transitionMs: z.number().min(0).max(5000).default(600).volatile(),
  hysteresis: z.number().min(0).max(1).default(0.25).volatile(),
  minDwellSeconds: z.number().min(60).max(3600).default(600).volatile(),
  thresholds: z.array(z.string()).default(DEFAULT_THRESHOLDS).volatile(),
  manualSpend: z.string().default('0').volatile(),
  lockedTier: z.string().default('').volatile(),
})

class WallpaperRuntime {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.stopped = false
    this.timer = null
    this.inFlight = null
    this.failures = 0
    this.nextSampleAt = null
    this.packCache = null
    this.packCacheAt = 0
    this.packCacheId = null
    this.lastRefreshAt = 0
    this.overrides = {}
    this.writer = new DebouncedStateWriter(stateFilePath(), 2000)
    this.state = {
      schema: 1,
      samples: [],
      tier: { index: 0, changedAt: 0 },
      pendingTier: null,
      currency: null,
      source: null,
      status: 'warming',
      windowReason: 'warming',
      spendMicro: null,
      resetAt: null,
      lastError: null,
      lastAttemptAt: 0,
      lastSuccessAt: 0,
    }
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    const persisted = loadState(stateFilePath())
    if (persisted !== null) {
      this.state.samples = persisted.samples
      this.state.tier = persisted.tier
      this.state.currency = persisted.currency
      this.state.lastError = persisted.lastError
      this.overrides = sanitizeStoredOverrides(persisted.overrides)
      if (this.state.samples.length > 0) this.state.status = 'stale'
    }
    this.updateTier(Date.now())
    this.sample()
    return () => {
      this.stopped = true
      if (this.timer !== null) {
        clearTimeout(this.timer)
        this.timer = null
      }
      this.writer.dispose()
    }
  }

  scheduleNext() {
    if (this.stopped || this.timer !== null) return
    const config = this.readConfig()
    const base = clamp(numberOr(config.sampleSeconds, 180), 60, 600) * 1000
    const delay = this.failures > 0
      ? Math.min(base * Math.pow(2, Math.min(this.failures, 6)), 30 * 60 * 1000)
      : base
    const jittered = Math.round(delay * (0.9 + Math.random() * 0.2))
    this.nextSampleAt = Date.now() + jittered
    this.timer = setTimeout(() => {
      this.timer = null
      this.sample()
    }, jittered)
    this.timer.unref?.()
  }

  async sample() {
    if (this.stopped) return
    if (this.inFlight !== null) return this.inFlight
    this.inFlight = this.doSample()
      .catch(() => {})
      .finally(() => {
        this.inFlight = null
        this.scheduleNext()
      })
    return this.inFlight
  }

  async doSample() {
    const config = this.readConfig()
    const now = Date.now()
    this.state.lastAttemptAt = now
    const plan = sourcePlan(config)

    if (plan[0] === 'manual') {
      const manual = readManualSpend(config)
      this.state.source = 'manual'
      this.state.status = manual.ok ? 'ok' : 'error'
      this.state.currency = String(config.currency ?? 'CNY')
      this.state.lastError = manual.ok ? null : (manual.message ?? 'manual spend is invalid')
      this.failures = manual.ok ? 0 : this.failures + 1
      this.state.lastSuccessAt = manual.ok ? now : this.state.lastSuccessAt
      this.updateTier(now)
      this.persist()
      return
    }

    let lastFailure = null
    let usefulFailure = null
    for (const source of plan) {
      let result
      if (source === 'cost-meter') result = await readCostMeterSpend(this.ctx, config)
      else if (source === 'account') result = await readAccountBalance(this.ctx, config)
      else result = await readApiBalance(this.ctx, config)
      if (!result || result.ok !== true) {
        if (result !== null && result.available !== false) usefulFailure = usefulFailure ?? result
        lastFailure = result
        continue
      }
      // Balance samples fall as money is spent; cost-counter samples grow. Store
      // the counter negated so both kinds share the same `older − newer` delta.
      const sample = source === 'cost-meter'
        ? { t: result.at ?? now, totalMicro: -Math.abs(result.counterMicro), currency: result.currency, kind: 'spend' }
        : { t: result.at ?? now, totalMicro: result.totalMicro, currency: result.currency, kind: 'balance' }
      appendSample(this.state.samples, sample)
      trimSamples(this.state.samples, now - Math.max(3 * 3600_000, this.windowMs() * 3))
      this.state.source = source
      this.state.currency = result.currency
      this.state.status = 'ok'
      this.state.lastError = null
      this.state.lastSuccessAt = now
      this.failures = 0
      this.updateTier(now)
      this.persist()
      return
    }

    this.failures += 1
    this.state.status = this.state.samples.length > 0 ? 'stale' : 'unavailable'
    this.state.lastError = failureText(usefulFailure ?? lastFailure)
    this.updateTier(now)
    this.persist()
  }

  /** Force one sample (settings "refresh"); throttled to one call per 10s. */
  async refresh() {
    const now = Date.now()
    if (now - this.lastRefreshAt < REFRESH_THROTTLE_MS) {
      return { ...this.snapshot(), throttled: true }
    }
    this.lastRefreshAt = now
    await this.sample()
    return this.snapshot()
  }

  // -------------------------------------------------------------------- state

  readConfig() {
    // Volatile Config fields arrive as getter refs (`{ get() }`); unwrap them on
    // every read so settings changes apply without remounting the plugin.
    const raw = this.config ?? {}
    const snapshot = {}
    for (const key of Object.keys(raw)) {
      const value = raw[key]
      if (value !== null && typeof value === 'object' && typeof value.get === 'function' && value.length === undefined) {
        try {
          snapshot[key] = value.get()
        } catch {
          snapshot[key] = undefined
        }
      } else {
        snapshot[key] = value
      }
    }
    // Quick-switch overrides (settings panel / CLI) win over the profile config.
    // The former `frame` mode was removed in 0.9: the wallpaper is always
    // full-bleed, and old `mode: frame` configs are ignored.
    return { ...snapshot, ...this.overrides, mode: 'full' }
  }

  /** Apply quick-switch overrides and persist them in the state file. */
  applyOverrides(patch) {
    const result = sanitizeOverrides(patch)
    if (!result.ok) return { ok: false, errors: result.errors }
    if (result.overrides.pack !== undefined) {
      const { packs } = this.packs()
      if (!packs.has(result.overrides.pack)) {
        return { ok: false, errors: [`unknown pack ${result.overrides.pack}`] }
      }
    }
    const before = this.readConfig()
    if (patch && patch.reset === true) this.overrides = {}
    else this.overrides = { ...this.overrides, ...result.overrides }
    const after = this.readConfig()
    this.packCache = null
    this.updateTier(Date.now())
    this.persist()
    // Restart the sampling timer when the cadence changed so new values apply
    // immediately instead of after the current (possibly long) interval.
    if (Number(before.sampleSeconds ?? 180) !== Number(after.sampleSeconds ?? 180)) {
      if (this.timer !== null) {
        clearTimeout(this.timer)
        this.timer = null
      }
      this.scheduleNext()
    }
    return { ok: true, snapshot: this.snapshot() }
  }

  thresholds() {
    const config = this.readConfig()
    const raw = Array.isArray(config.thresholds) && config.thresholds.length >= 2 ? config.thresholds : DEFAULT_THRESHOLDS
    try {
      const parsed = raw.map(parseAmount)
      parsed[0] = 0
      for (let index = 1; index < parsed.length; index += 1) {
        if (parsed[index] <= parsed[index - 1]) throw new Error('not ascending')
      }
      return parsed
    } catch {
      return DEFAULT_THRESHOLDS.map(parseAmount)
    }
  }

  windowMs() {
    const config = this.readConfig()
    return clamp(numberOr(config.windowMinutes, 60), 5, 180) * 60_000
  }

  updateTier(now) {
    const config = this.readConfig()
    const thresholds = this.thresholds()
    const source = String(config.source ?? 'auto')
    let spendMicro
    let reason
    let resetAt = null
    if (source === 'manual') {
      const manual = readManualSpend(config)
      spendMicro = manual.ok ? manual.spendMicro : null
      reason = manual.ok ? 'ok' : 'error'
    } else {
      const window = windowSpend({ samples: this.state.samples, now, windowMs: this.windowMs() })
      spendMicro = window.spendMicro
      reason = window.reason
      resetAt = window.resetAt
    }
    const resolved = resolveTier({
      spendMicro,
      thresholdsMicro: thresholds,
      currentIndex: clampIndex(this.state.tier.index, thresholds.length),
      changedAt: this.state.tier.changedAt || 0,
      now,
      hysteresis: clamp(numberOr(config.hysteresis, 0.25), 0, 1),
      minDwellMs: clamp(numberOr(config.minDwellSeconds, 600), 60, 3600) * 1000,
    })
    let index = resolved.index
    const locked = this.lockedTierIndex(config, thresholds.length)
    if (locked !== null) index = locked
    this.state.tier = { index, changedAt: resolved.changedAt }
    this.state.pendingTier = resolved.pendingIndex
    this.state.spendMicro = spendMicro
    this.state.windowReason = reason
    this.state.resetAt = resetAt
    this.state.sourceLabel = source
  }

  lockedTierIndex(config, tierCount) {
    const raw = String(config.lockedTier ?? '').trim()
    if (raw.length === 0) return null
    if (/^\d+$/.test(raw)) return clampIndex(Number(raw), tierCount)
    const { packs } = this.packs()
    const pack = resolvePack(packs, config.pack)
    if (pack === null) return null
    const found = pack.manifest.tiers.findIndex((tier) => tier.id === raw)
    return found === -1 ? null : clampIndex(found, tierCount)
  }

  persist() {
    const config = this.readConfig()
    const thresholds = Array.isArray(config.thresholds) && config.thresholds.length >= 2
      ? config.thresholds.map((value) => String(value))
      : DEFAULT_THRESHOLDS.slice()
    this.writer.schedule({
      samples: this.state.samples,
      tier: this.state.tier,
      currency: this.state.currency,
      lastError: this.state.lastError,
      spendMicro: Number.isFinite(this.state.spendMicro) ? this.state.spendMicro : null,
      windowReason: this.state.windowReason,
      source: this.state.source,
      status: this.state.status,
      updatedAt: Date.now(),
      overrides: { ...this.overrides },
      config: {
        enabled: config.enabled !== false,
        source: String(config.source ?? 'auto'),
        currency: String(config.currency ?? 'CNY'),
        direction: config.direction === 'rich' ? 'rich' : 'poor',
        mode: 'full',
        media: String(config.media ?? 'auto'),
        pack: String(config.pack ?? 'default'),
        windowMinutes: Math.round(this.windowMs() / 60_000),
        thresholds,
      },
    })
  }

  // -------------------------------------------------------------------- packs

  packs() {
    const config = this.readConfig()
    const packId = String(config.pack ?? 'default')
    const now = Date.now()
    if (this.packCache !== null && this.packCacheId === packId && now - this.packCacheAt < 60_000) {
      return this.packCache
    }
    this.packCache = loadPacks({ builtinDir: BUILTIN_PACKS_DIR, userDir: userPacksDir() })
    this.packCacheAt = now
    this.packCacheId = packId
    return this.packCache
  }

  packFile(packId, name) {
    const { packs } = this.packs()
    const pack = packs.get(packId)
    if (!pack) return null
    return resolveAsset(pack, name)
  }

  assetUrl(packId, name, mtimeMs) {
    const version = Number.isFinite(mtimeMs) ? `?v=${Math.round(mtimeMs)}` : ''
    return `${ASSET_PREFIX}/${encodeURIComponent(packId)}/${encodeURIComponent(name)}${version}`
  }

  wallpaperFor(tierIndex) {
    const config = this.readConfig()
    const { packs } = this.packs()
    const pack = resolvePack(packs, config.pack)
    if (pack === null) return null
    const count = pack.manifest.tiers.length
    const mapped = mapPackIndex(tierIndex, count, pack.manifest.direction, config.direction)
    const tier = pack.manifest.tiers[mapped]
    if (!tier) return null
    const media = String(config.media ?? 'auto')
    const dynamic = tier.dynamic
    const useDynamic = dynamic !== null && (media === 'dynamic' || media === 'auto')
    const chosenName = useDynamic ? dynamic.src : tier.static
    const posterName = useDynamic ? (dynamic.poster ?? tier.static) : null
    const chosen = resolveAsset(pack, chosenName)
    const poster = posterName === null ? null : resolveAsset(pack, posterName)
    if (chosen === null) return null
    return {
      kind: useDynamic && dynamic.type === 'video' ? 'video' : 'image',
      src: this.assetUrl(pack.id, chosenName, chosen.mtimeMs),
      poster: poster === null ? null : this.assetUrl(pack.id, posterName, poster.mtimeMs),
      packId: pack.id,
      tierIndex: mapped,
      tierId: tier.id,
      transitionMs: clamp(numberOr(config.transitionMs, 600), 0, 5000),
    }
  }

  // ----------------------------------------------------------------- snapshot

  snapshot() {
    const config = this.readConfig()
    const now = Date.now()
    const thresholds = this.thresholds()
    const tierIndex = clampIndex(this.state.tier.index, thresholds.length)
    const { packs, diagnostics } = this.packs()
    const pack = resolvePack(packs, config.pack)
    const wallpaper = this.wallpaperFor(tierIndex)
    const label = wallpaper === null
      ? `T${tierIndex}`
      : this.tierLabel(pack, wallpaper.tierIndex, config)
    const next = nextThreshold(thresholds, tierIndex)
    const enabled = config.enabled !== false
    return {
      schema: 1,
      enabled,
      lockedTier: String(config.lockedTier ?? ''),
      overrides: { ...this.overrides },
      source: this.state.source,
      status: enabled ? this.state.status : 'off',
      currency: this.state.currency ?? String(config.currency ?? 'CNY'),
      spend1h: Number.isFinite(this.state.spendMicro) ? formatAmount(this.state.spendMicro) : null,
      windowMinutes: Math.round(this.windowMs() / 60_000),
      thresholds: thresholds.map((value) => formatAmount(value)),
      sampling: {
        sampleSeconds: Math.round(clamp(numberOr(config.sampleSeconds, 180), 60, 600)),
        hysteresis: clamp(numberOr(config.hysteresis, 0.25), 0, 1),
        minDwellSeconds: Math.round(clamp(numberOr(config.minDwellSeconds, 600), 60, 3600)),
      },
      tier: {
        index: tierIndex,
        id: wallpaper?.tierId ?? `tier-${tierIndex}`,
        label,
        min: formatAmount(thresholds[tierIndex]),
        nextAt: next === null ? null : formatAmount(next),
        nextLabel: next === null || pack === null ? null : this.thresholdLabel(pack, thresholds, tierIndex, config),
        pending: this.state.pendingTier,
      },
      wallpaper,
      rendering: {
        mode: 'full',
        media: config.media === 'static' ? 'static' : config.media === 'dynamic' ? 'dynamic' : 'auto',
        scrim: clamp(numberOr(config.scrim, 0.28), 0, 1),
        dim: clamp(numberOr(config.dim, 0.08), 0, 1),
        blur: clamp(numberOr(config.blur, 0), 0, 24),
        surfaceOpacity: clamp(numberOr(config.surfaceOpacity, 0.7), 0.2, 1),
        transitionMs: clamp(numberOr(config.transitionMs, 600), 0, 5000),
        direction: config.direction === 'rich' ? 'rich' : 'poor',
      },
      pack: pack === null ? null : {
        id: pack.id,
        name: this.localized(pack.manifest.name, config),
        tiers: pack.manifest.tiers.map((tier) => ({
          id: tier.id,
          label: this.localized(tier.label, config),
          min: tier.min,
        })),
      },
      updatedAt: now,
      nextSampleAt: this.nextSampleAt,
      diagnostics: {
        samples: this.state.samples.length,
        windowReason: this.state.windowReason,
        lastError: this.state.lastError,
        lastAttemptAt: this.state.lastAttemptAt,
        lastSuccessAt: this.state.lastSuccessAt,
        pendingTier: this.state.pendingTier,
        packErrors: diagnostics,
        packs: [...packs.keys()],
      },
    }
  }

  packsSnapshot() {
    const config = this.readConfig()
    const { packs, diagnostics } = this.packs()
    const selected = resolvePack(packs, config.pack)
    return {
      schema: 1,
      selected: selected?.id ?? null,
      packs: [...packs.values()].map((pack) => ({
        id: pack.id,
        name: this.localized(pack.manifest.name, config),
        direction: pack.manifest.direction,
        license: pack.manifest.license,
        tiers: pack.manifest.tiers.map((tier) => {
          const staticInfo = resolveAsset(pack, tier.static)
          const dynamicInfo = tier.dynamic === null ? null : resolveAsset(pack, tier.dynamic.src)
          const posterInfo = tier.dynamic?.poster ? resolveAsset(pack, tier.dynamic.poster) : null
          return {
            id: tier.id,
            label: this.localized(tier.label, config),
            min: tier.min,
            static: tier.static,
            staticUrl: staticInfo === null ? null : this.assetUrl(pack.id, tier.static, staticInfo.mtimeMs),
            dynamic: tier.dynamic === null ? null : {
              type: tier.dynamic.type,
              src: tier.dynamic.src,
              url: dynamicInfo === null ? null : this.assetUrl(pack.id, tier.dynamic.src, dynamicInfo.mtimeMs),
              posterUrl: posterInfo === null ? null : this.assetUrl(pack.id, tier.dynamic.poster, posterInfo.mtimeMs),
            },
          }
        }),
      })),
      errors: diagnostics,
    }
  }

  localized(value, config) {
    const locale = typeof config.locale === 'string' ? config.locale : 'zh'
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
      const preferred = value[locale] ?? value.zh ?? value.en
      if (typeof preferred === 'string' && preferred.length > 0) return preferred
    }
    return ''
  }

  tierLabel(pack, mappedIndex, config) {
    const tier = pack?.manifest.tiers[mappedIndex]
    if (!tier) return `T${mappedIndex}`
    return this.localized(tier.label, config) || tier.id
  }

  thresholdLabel(pack, thresholds, tierIndex, config) {
    if (nextThreshold(thresholds, tierIndex) === null || pack === null) return null
    const mapped = mapPackIndex(tierIndex + 1, pack.manifest.tiers.length, pack.manifest.direction, config.direction)
    return this.tierLabel(pack, mapped, config)
  }

  // ------------------------------------------------------------------- routes

  registerRoutes(ctx) {
    return registerHttpRoutes(ctx, this)
  }
}

export function apply(ctx, config) {
  const runtime = new WallpaperRuntime(ctx, config)
  ctx.effect(() => runtime.start(), 'spend-wallpaper: sampler')
  try {
    ctx.provide('wallpaper', runtime)
  } catch {
    // A different composition already provided the service; the plugin still works.
  }
  ctx.inject(['webServer'], (child) => {
    child.effect(() => runtime.registerRoutes(child), 'spend-wallpaper: http routes')
  })
}
