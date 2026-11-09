/**
 * Balance sources for the host half.
 *
 * Two authoritative sources are supported out of the box:
 *  - `account`: the signed-in DeepSeek account wallet exposed by
 *    `ctx.deepseekAccount.getBalance()` (desktop login, no API key needed).
 *  - `api`: `GET https://api.deepseek.com/user/balance` using an API key
 *    resolved through `ctx.credentials` or the launch environment.
 *
 * `manual` is a debugging source that feeds the spend number directly.
 * Everything returns micro-units so callers never see floats.
 */

import { parseAmount } from './money.js'

const OFFICIAL_API_HOST = 'api.deepseek.com'
const OFFICIAL_API_BASE = 'https://api.deepseek.com'
const REQUEST_TIMEOUT_MS = 15_000
const SUPPORTED_CURRENCIES = new Set(['CNY', 'USD'])

/** Normalize a wallet list (`{ currency, balance }`) into per-currency micro totals. */
function walletTotals(list) {
  const totals = new Map()
  if (!Array.isArray(list)) return totals
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue
    const currency = String(entry.currency ?? '').toUpperCase()
    const raw = String(entry.balance ?? '')
    if (!SUPPORTED_CURRENCIES.has(currency) || raw.trim().length === 0) continue
    let amount
    try {
      amount = parseAmount(raw)
    } catch {
      continue
    }
    totals.set(currency, (totals.get(currency) ?? 0) + amount)
  }
  return totals
}

/** Pick the preferred currency (or the one with the largest balance). */
function pickCurrency(totals, preferred) {
  const wanted = String(preferred ?? '').toUpperCase()
  if (totals.has(wanted)) return wanted
  let best = null
  let bestAmount = -Infinity
  for (const [currency, amount] of totals) {
    if (amount > bestAmount) {
      best = currency
      bestAmount = amount
    }
  }
  return best
}

function combine(groups, preferred) {
  const merged = new Map()
  for (const group of groups) {
    for (const [currency, amount] of group) merged.set(currency, (merged.get(currency) ?? 0) + amount)
  }
  const currency = pickCurrency(merged, preferred)
  if (currency === null) return null
  return { currency, totalMicro: merged.get(currency) ?? 0 }
}

function failure(reason, message, extra = {}) {
  return { ok: false, reason, message, ...extra }
}

function safeMessage(error) {
  if (error instanceof Error) {
    const text = error.message.replace(/\b(sk-[A-Za-z0-9_-]+)\b/g, '<redacted>')
    return text.slice(0, 240)
  }
  return String(error).slice(0, 240)
}

/** Normalize a configured API base URL; only the official host is allowed. */
export function normalizeApiBase(value) {
  const text = typeof value === 'string' && value.trim().length > 0 ? value.trim() : OFFICIAL_API_BASE
  let url
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== OFFICIAL_API_HOST) return null
  return url.origin
}

/** Resolve the API key from the credential store, then the launch environment. */
export async function resolveApiKey(ctx, config) {
  const reference = typeof config.apiKeyEnv === 'string' && config.apiKeyEnv.length > 0
    ? config.apiKeyEnv
    : 'DEEPSEEK_API_KEY'
  const credentials = ctx.get?.('credentials')
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve(reference)
      if (hit && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
    } catch {
      // Fall through to the environment.
    }
  }
  const fromEnv = process.env[reference]
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : null
}

/**
 * Read the signed-in account wallet.
 * @returns {Promise<object>} `{ ok: true, currency, totalMicro, toppedUpMicro, grantedMicro, at }`
 *          or `{ ok: false, reason, message }`
 */
export async function readAccountBalance(ctx, config) {
  const account = ctx.get?.('deepseekAccount')
  if (!account || typeof account.getBalance !== 'function') {
    return failure('account-service-absent', '当前 profile 没有账号服务（未登录或非桌面端）', { available: false })
  }
  let details
  try {
    details = await account.getBalance({
      version: '',
      locale: typeof config.locale === 'string' && config.locale.length > 0 ? config.locale : 'zh',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    })
  } catch (error) {
    return failure('account-request-failed', safeMessage(error), { available: true })
  }
  if (details === null) {
    let signedOut = false
    try {
      if (typeof account.getState === 'function') {
        const state = await account.getState()
        signedOut = state?.status === 'signed-out'
      }
    } catch {
      // Ignore state errors; report a generic unavailable result.
    }
    return failure(signedOut ? 'account-signed-out' : 'account-unavailable', signedOut ? '账号已退出登录' : '账号余额暂不可用', { available: true })
  }
  if (details.status !== 'ready') {
    return failure(`account-${String(details.status ?? 'unknown')}`, '账号余额尚未就绪（可能正在查询或需要重新登录）', { available: true })
  }
  const normal = walletTotals(details.value)
  const granted = walletTotals(details.bonusWallets)
  const combined = combine([normal, granted], config.currency)
  if (combined === null) {
    return failure('account-no-wallets', '账号响应中没有可识别的钱包', { available: true })
  }
  const toppedUpMicro = normal.get(combined.currency) ?? 0
  const grantedMicro = granted.get(combined.currency) ?? 0
  return {
    ok: true,
    source: 'account',
    currency: combined.currency,
    totalMicro: combined.totalMicro,
    toppedUpMicro,
    grantedMicro,
    at: Date.now(),
  }
}

/**
 * Read the official open-platform balance endpoint.
 * @returns {Promise<object>} same shape as {@link readAccountBalance}
 */
export async function readApiBalance(ctx, config) {
  const base = normalizeApiBase(config.apiBase)
  if (base === null) {
    return failure('api-base-rejected', '余额接口只允许 https://api.deepseek.com，已拒绝其它地址以保护 API Key', { available: false })
  }
  const key = await resolveApiKey(ctx, config)
  if (key === null) {
    return failure('api-key-missing', '没有可用的开放平台 API Key（设置 → 模型 或环境变量 DEEPSEEK_API_KEY）', { available: false })
  }
  let response
  try {
    response = await fetch(`${base}/user/balance`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return failure('api-request-failed', safeMessage(error), { available: true })
  }
  if (!response.ok) {
    await response.body?.cancel?.().catch?.(() => {})
    return failure(`api-http-${response.status}`, `余额接口 HTTP ${response.status}`, { available: true })
  }
  let data
  try {
    data = await response.json()
  } catch (error) {
    return failure('api-invalid-json', safeMessage(error), { available: true })
  }
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : []
  if (infos.length === 0) return failure('api-no-balance-info', '余额接口未返回 balance_infos', { available: true })
  const preferred = String(config.currency ?? '').toUpperCase()
  const picked = infos.find((info) => String(info?.currency ?? '').toUpperCase() === preferred) ?? infos[0]
  let totalMicro = 0
  let toppedUpMicro = 0
  let grantedMicro = 0
  try {
    totalMicro = parseAmount(String(picked.total_balance ?? '0'))
    toppedUpMicro = parseAmount(String(picked.topped_up_balance ?? '0'))
    grantedMicro = parseAmount(String(picked.granted_balance ?? '0'))
  } catch (error) {
    return failure('api-invalid-amount', safeMessage(error), { available: true })
  }
  return {
    ok: true,
    source: 'api',
    currency: String(picked.currency ?? preferred ?? '').toUpperCase(),
    totalMicro,
    toppedUpMicro,
    grantedMicro,
    at: Date.now(),
  }
}

/** Manual source: the configured spend is the spend, no sampling required. */
export function readManualSpend(config) {
  try {
    return { ok: true, spendMicro: parseAmount(config.manualSpend ?? '0') }
  } catch (error) {
    return { ok: false, spendMicro: 0, message: safeMessage(error) }
  }
}

/**
 * Ordered sources to try for one sample.
 * `auto` prefers the account wallet (the actual balance), then the API key route.
 */
export function sourcePlan(config) {
  const source = String(config.source ?? 'auto')
  if (source === 'manual') return ['manual']
  if (source === 'account') return ['account']
  if (source === 'api') return ['api']
  if (source === 'cost-meter') return ['account', 'api']
  return ['account', 'api']
}
