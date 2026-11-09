/**
 * Local persistence for balance samples and the last resolved tier.
 * Stored under `$DSH_HOME/storages/spend-wallpaper/state.json` with an atomic
 * temp-file rename, so a crash never leaves a half-written JSON file.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

export function stateFilePath() {
  return path.join(resolveDshHome(), 'storages', 'spend-wallpaper', 'state.json')
}

export function userPacksDir() {
  return path.join(resolveDshHome(), 'spend-wallpaper', 'packs')
}

/** Load persisted state, returning null when absent/corrupt/incompatible. */
export function loadState(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || parsed.schema !== 1) return null
    const samples = Array.isArray(parsed.samples)
      ? parsed.samples
        .filter((sample) => sample && Number.isFinite(sample.t) && Number.isFinite(sample.totalMicro) && typeof sample.currency === 'string')
        .map((sample) => ({
          t: sample.t,
          totalMicro: sample.totalMicro,
          currency: sample.currency,
          kind: sample.kind === 'spend' ? 'spend' : 'balance',
        }))
        .sort((a, b) => a.t - b.t)
      : []
    const tierIndex = Number.isFinite(parsed.tier?.index) ? Math.trunc(parsed.tier.index) : 0
    const changedAt = Number.isFinite(parsed.tier?.changedAt) ? parsed.tier.changedAt : 0
    return {
      samples,
      tier: { index: Math.max(0, tierIndex), changedAt },
      currency: typeof parsed.currency === 'string' ? parsed.currency : null,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
      // Snapshot fields consumed by the terminal CLI (older files omit them).
      spendMicro: Number.isFinite(parsed.spendMicro) ? parsed.spendMicro : null,
      windowReason: typeof parsed.windowReason === 'string' ? parsed.windowReason : null,
      source: typeof parsed.source === 'string' ? parsed.source : null,
      status: typeof parsed.status === 'string' ? parsed.status : null,
      updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
      config: parsed.config !== null && typeof parsed.config === 'object' && !Array.isArray(parsed.config) ? parsed.config : null,
    }
  } catch {
    return null
  }
}

/** Atomically write the state file. */
export function saveState(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  const payload = JSON.stringify({
    schema: 1,
    samples: data.samples ?? [],
    tier: data.tier ?? { index: 0, changedAt: 0 },
    currency: data.currency ?? null,
    lastError: data.lastError ?? null,
    spendMicro: Number.isFinite(data.spendMicro) ? data.spendMicro : null,
    windowReason: data.windowReason ?? null,
    source: data.source ?? null,
    status: data.status ?? null,
    updatedAt: Number.isFinite(data.updatedAt) ? data.updatedAt : Date.now(),
    config: data.config ?? null,
    savedAt: Date.now(),
  })
  fs.writeFileSync(temporary, payload, 'utf8')
  fs.renameSync(temporary, file)
}

/** Debounced, best-effort writer; failures are swallowed (state is only a cache). */
export class DebouncedStateWriter {
  constructor(file, delayMs = 2000) {
    this.file = file
    this.delayMs = delayMs
    this.timer = null
    this.pending = null
  }

  schedule(data) {
    this.pending = data
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.delayMs)
    this.timer.unref?.()
  }

  flush() {
    if (this.pending === null) return
    const data = this.pending
    this.pending = null
    try {
      saveState(this.file, data)
    } catch {
      // A read-only or full disk must not break wallpaper switching.
    }
  }

  dispose() {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.flush()
  }
}
