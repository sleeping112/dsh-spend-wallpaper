# DSH 插件设计：按「最近 1 小时余额消耗」更换壁纸

> 包名：`dsh-spend-wallpaper`（中文名：余额壁纸）
> 本文件位于仓库 `docs/design.md`；安装、配置、素材包格式见 [README](../README.md) 与 [packs.md](packs.md)。
> 本文基于本机 DSH 0.2.2-rc.1 实际安装（`D:\deepseek\resources\app.asar`）与已安装的 `dsh-cost-meter@1.9.46` 的 API 形态设计。
> **最终决策（2026-11-09）**：只做 DSH 应用内背景；默认 `direction: poor`；默认阈值 `0 / 0.05 / 0.30 / 1.50 / 6.00 ¥/小时`；内置一套程序化生成的素材。M0 已实现并跑通，仓库已按完整 Git 项目组织（测试、CI、素材包校验、文档）。

---

## 0. TL;DR

**Host 半边**每 3 分钟采样一次 DeepSeek 余额（桌面登录钱包优先，其次开放平台 `/user/balance`），用「当前余额 − 60 分钟前余额」得到**滚动 1 小时消耗**，经迟滞/最短驻留映射到 5 个档位；**Client 半边**是 `dsh.client` 浏览器插件，在 `body` 下插入 `z-index:-1` 的全屏壁纸层（静态图或静音循环视频），通过覆盖 `--dsw-*` 背景 token 让应用面板透出壁纸；档位决定素材，切换走 600ms 交叉淡入。

```
┌──────────────────────────── Host (Node, Cordis 插件) ────────────────────────────┐
│  BalanceSampler ──3min──► samples[(t, balance)] ──► SpendWindow(60min) ──► Tier  │
│      │  adapters:                                                                │
│      ├─ account   (ctx.deepseekAccount.getBalance)                               │
│      ├─ api       (GET /user/balance, ctx.credentials / env)                      │
│      └─ manual    (调试/联调)                                                     │
│                                      │                                            │
│  http routes:  GET  /plugins/dsh-spend-wallpaper/state                            │
│                GET  /plugins/dsh-spend-wallpaper/packs                            │
│                GET  /plugins/dsh-spend-wallpaper/assets/<pack>/<file>             │
│                POST /plugins/dsh-spend-wallpaper/refresh                          │
└──────────────────────────────────────┬────────────────────────────────────────────┘
                                       │ 同源 fetch（浏览器会话 Cookie）
┌──────────────────────────────────────▼────────────────────────────────────────────┐
│                         Client (浏览器 bundle, dsh.client)                        │
│  StatePoller(20s) ──► WallpaperLayer (#dswp-root, fixed, z-index:-1)             │
│                          ├─ <img> 静态 / <video> 动态（交叉淡入）                  │
│                          └─ scrim 渐变 + dim                                      │
│  data-dswp-mode: frame（相框）/ full（面板半透明 token）                           │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. 目标与非目标

### 目标

1. **真实反映"最近 1 小时消耗"**：滚动窗口（默认 60 min），不是"今天花了多少"。
2. **静态/动态可选**：`auto` / `static` / `dynamic`；尊重 `prefers-reduced-motion`，窗口不可见时暂停视频。
3. **应用内渲染**：DSH Web GUI 背景（最终决策，不做 Windows 桌面壁纸）。
4. **可视化配置**：档位、素材包、透明度等可在设置页修改并热生效。
5. **不绑架宿主**：不依赖 `dsh-cost-meter`；对宿主 DOM/token 的耦合集中在一个可降级适配层。

### 非目标

- 不做多厂商余额聚合（Kimi/OpenAI 等）；多厂商属于 `dsh-cost-meter` 的领域。
- 不做 Windows 桌面壁纸/动态桌面（需要 Lively 等第三方载体，见附录 B，v2+ 再议）。
- 不上报余额数据、不做遥测。
- 不修改宿主源码；只走公开的插件/资产/设置 seam。

---

## 2. 用户故事

| 场景 | 期望 |
|---|---|
| 1 小时花了 ¥0.02 | 壁纸「无波」 |
| 1 小时花了 ¥3.8 | 壁纸「浪涌」 |
| 切到别的窗口 | 动态壁纸暂停；切回恢复 |
| 系统开了「减少动态效果」 | 只显示静态帧 |
| 不想被换 | 设置页锁定档位 / 关闭总开关 |
| 想自己放图 | 往 `$DSH_HOME/spend-wallpaper/packs/<id>/` 放素材 + manifest |
| 未登录、没有 API Key | 状态「未配置数据源」，保持默认档，不刷屏报错 |

档位变化：旧图淡出、新图淡入（默认 600ms）；`prefers-reduced-motion` 下瞬时切换。

---

## 3. 关键设计决策

| 决策点 | 选择 | 理由 / 备选 |
|---|---|---|
| "壁纸"指什么 | **DSH 应用内背景** | 可用公开插件机制实现；桌面壁纸需 Win32/Lively，v2 再议 |
| 消耗数据从哪来 | **滚动窗口余额差分** | 与"余额消耗"语义一致；不依赖第三方插件 |
| 是否依赖 dsh-cost-meter | **不依赖**。实测其 1.9.46 账本只按天/按会话聚合，没有逐次调用时间戳，无法重建 1 小时窗口 | 账本结构也不是公开契约；只保留 `source: cost-meter` 作为将来等价于 `auto` 的占位 |
| 静态/动态如何选 | 素材包同时声明 `static` 与 `dynamic`，运行期按配置 + 系统偏好选择 | 允许某档只有静态 |
| 应用内渲染方式 | 独立全屏层 + token 半透明覆盖 | `ctx.theme` 只能换颜色不能换图 |
| 档位映射 | 5 档、绝对阈值、可配置；带迟滞 + 最短驻留 | 简单可解释；自适应阈值放 v2 |
| 配置入口 | Cordis `Config` 的 `.volatile()` 字段（自动表单）+ 后续自绘设置页 | 与 DSH 其余插件一致；volatile 字段写入 profile patch |

---

## 4. 数据层

### 4.1 数据源适配器（Host）

统一返回余额快照；金额统一转成 **整数微单位（1e-6）**，避免浮点误差。

**A. `account`（桌面登录账号，首选）**

- `ctx.deepseekAccount.getBalance({ version: '', locale, timezoneOffsetSeconds })`。
- `details === null` 可能是"查询期间换了授权"，用 `account.getState()` 复核 `status`，不要静默切账号。
- `details.status === 'ready'` 时读钱包：`details.value` 是充值钱包列表，`details.bonusWallets` 是赠送钱包列表；每项 `{ currency: 'CNY'|'USD', balance: '十进制字符串' }`。
- 只读、Host-only、不需要额外 API Key；未登录/网络失败返回 `unavailable`，不制造 0 余额。

**B. `api`（开放平台 API Key）**

- `GET https://api.deepseek.com/user/balance`，`Authorization: Bearer <key>`。
- Key 解析顺序：`ctx.credentials.resolve(reference)` → 启动环境变量（默认 `DEEPSEEK_API_KEY`）。
- **只允许 `https://api.deepseek.com`**（Host 校验 hostname，防止 Key 被发往第三方域名）。
- 解析 `balance_infos[]`，按配置币种挑选；金额为十进制字符串。

**C. `manual`（调试/联调）**

- `manualSpend` 直接作为"当前 1 小时消耗"，不需要采样窗口；用于把 5 个档位在几分钟内过一遍。

`source: 'auto'` 顺序：`account → api → manual`。每次尝试失败都记一条可读诊断（`account-service-absent` / `api-key-missing` 等），设置页可看到"为什么没用上账号余额"。

### 4.2 采样、滚动窗口与边界情况

```ts
// 采样：默认每 180s，±10% 抖动；失败指数退避（60s → 30min 封顶）
// 样本 { t, totalMicro, currency }，持久化后可跨重启继续窗口
const snap = await pickSource().read(ctx)
appendSample(samples, { t: snap.at, totalMicro: snap.totalMicro, currency: snap.currency })
trimSamples(samples, now - max(3h, 3 * windowMs))

// 滚动窗口消耗
function windowSpend(samples, now, windowMs) {
  const older = lastAtOrBefore(samples, now - windowMs)   // 早于/等于 now-window 的最后一个样本
  const newer = lastAtOrBefore(samples, now)
  if (!older || !newer || newer.t - older.t < windowMs * 0.75) return warming
  const delta = older.totalMicro - newer.totalMicro
  if (delta < 0) return { spend: 0, reason: 'reset' }     // 充值 / 赠送回收 / 换账号
  return { spend: delta, reason: 'ok' }
}
```

必须显式处理的边界：

1. **预热**：无历史样本时 `spend1h = null`，状态 `warming`，壁纸保持上一档；持久化样本可让重启不重新预热。
2. **充值**：差额为负 → 归零并记 reset，不当作负消耗。
3. **赠送余额到期/回收**：`wallet` 不变、`bonus` 下降在余额差分里同样表现为"下降"；简化为"负差额归零"，不单独区分（文档标注"约"）。
4. **多设备共用账号**：余额下降包含其它设备消费；产品上接受（"账号最近 1 小时消耗"）。
5. **计费延迟**：官方余额与本地账本有分钟级时差；窗口 + 采样天然平滑。
6. **接口失败**：保留最后成功值，状态 `stale`；连续失败指数退避；不因网络错误换壁纸。
7. **币种切换**：只比较同一币种的样本；切换后重新预热。
8. **时钟回拨**：样本 `t` 单调递增写入；旧时间样本直接丢弃。

### 4.3 状态模型与对外接口

Host 服务 `ctx.provide('wallpaper', runtime)`（可选，方便其它插件消费）提供 `snapshot()` / `refresh()` / `packFile()`。

`GET /state` 返回（实际实现字段）：

```ts
{
  schema: 1, enabled: boolean,
  source: 'account' | 'api' | 'manual' | null,
  status: 'ok' | 'warming' | 'stale' | 'unavailable' | 'error' | 'off',
  currency: string,
  spend1h: string | null,          // 十进制字符串；null = 未知
  windowMinutes: number,
  tier: { index, id, label, min, nextAt, nextLabel, pending },
  wallpaper: { kind: 'image'|'video', src, poster, packId, tierIndex, tierId, transitionMs } | null,
  rendering: { mode, media, scrim, dim, blur, surfaceOpacity, inset, radius,
               transitionMs, direction },
  pack: { id, name, tiers: [{ id, label, min }] } | null,
  updatedAt, nextSampleAt,
  diagnostics: { samples, windowReason, lastError, lastAttemptAt, lastSuccessAt,
                 pendingTier, packErrors, packs }
}
```

HTTP 契约：

| 方法/路径 | 用途 | 说明 |
|---|---|---|
| `GET /plugins/dsh-spend-wallpaper/state` | 当前快照 | `no-store`；20s 轮询足够 |
| `GET /plugins/dsh-spend-wallpaper/packs` | 已发现素材包 | 设置页素材选择器 |
| `GET /plugins/dsh-spend-wallpaper/assets/<pack>/<file>` | 素材 | 前缀路由；`max-age=3600` + ETag；禁目录穿越；扩展名白名单 |
| `POST /plugins/dsh-spend-wallpaper/refresh` | 立即采样 | 10s 限流；设置页刷新按钮 |

实现细节：`ctx.webServer.register({ kind: 'exact'|'prefix', path, resource|handler })`；`resource(request)` 返回 Fetch `Response`，只服务 GET/HEAD；`POST /refresh` 用 node `handler(req, res)`。宿主 webserver 不提供认证，因此每个路由自带同源栅栏（拒绝 `sec-fetch-site: cross-site`、Origin 与 Host 不一致的请求）。

---

## 5. 档位引擎

### 5.1 默认档位表（CNY，按小时）

| 档 | 阈值（≥） | 名称 | 情绪 | 内置素材 |
|---|---|---|---|---|
| 0 | 0 | 无波 | 心如止水 | 深蓝静海 + 鲸鱼剪影 |
| 1 | 0.05 | 微澜 | 尚可 | 青蓝涟漪 |
| 2 | 0.30 | 起浪 | 有点感觉 | 紫蓝浪涌 + 金币 |
| 3 | 1.50 | 浪涌 | 肉疼 | 橙红风暴 + 闪电 |
| 4 | 6.00 | 海啸 | 破防 | 暗红海啸 + 闪电 |

USD 账号默认：`0 / 0.01 / 0.05 / 0.2 / 0.8`（可改）。

### 5.2 迟滞、驻留与过渡

```ts
target = 满足 spend >= thresholds[i] 的最大 i
if (target === current) return current
boundary = 上跨取 thresholds[target]，下跨取 thresholds[current]
overshoot = 上跨 spend - boundary；下跨 boundary - spend
if (overshoot < boundary * hysteresis) return current        // 迟滞带内（默认 25%）
if (now - changedAt < minDwellMs) return { pending: target } // 未到最短驻留（默认 10min）
return { index: target, changedAt: now }
```

- 挂起候选在后续采样重试，避免"刚好卡边界"抖动。
- 切换时 Client 交叉淡入；`prefers-reduced-motion` 下 0ms。
- 设置页"预览档位"纯客户端渲染，不写 Host 状态。

### 5.3 方向

- `poor`（默认）：消耗越高 → 越"惨"。
- `rich`：消耗越高 → 越豪华（反转档位到素材的映射，阈值与状态不变）。

---

## 6. 素材与渲染

### 6.1 素材包规范

目录：内置 `lib/assets/packs/default/`；用户 `$DSH_HOME/spend-wallpaper/packs/<id>/`（同名覆盖内置）。

```jsonc
{
  "schema": 1,
  "id": "default",
  "name": { "zh": "深海情绪", "en": "Deep Sea Mood" },
  "author": "dsh-spend-wallpaper",
  "license": "CC0-1.0 (generated artwork)",
  "direction": "poor",
  "tiers": [
    {
      "id": "calm", "min": "0",
      "label": { "zh": "无波", "en": "Calm" },
      "static": "0-calm.webp",
      "dynamic": { "type": "video", "src": "0-calm.webm", "poster": "0-calm.webp" }
    }
    // ... 共 5 档
  ]
}
```

约束：

- 位图：`.webp/.jpg/.png/.avif/.gif/.apng`；视频：`.mp4/.webm`；**用户包不接受 SVG**（脚本面）。
- 静态建议 2560×1440；视频 ≤ 1080p、≤ 30s、≤ 12MB（内置为 1280×720、6s、约 100KB）。
- 缺档回退；`static` 必填、`dynamic` 可选；manifest 校验失败只跳过该包并记诊断。

### 6.2 静态与动态

| 类型 | 实现 | 注意 |
|---|---|---|
| 静态图 | `<img>` + `object-fit: cover` | 最省电 |
| 视频 | `<video autoplay muted loop playsinline poster>` | 必须 `muted`；隐藏时 pause；`preload="metadata"` |
| 动图 | `<img>` .gif/.webp | 兼容兜底，CPU 偏高 |
| 生成式（v2） | Canvas 波浪/鲸鱼，限帧 30fps | 数据驱动、无素材 |

选择规则：`dynamic 可用 && !prefers-reduced-motion && 可见 ? 视频 : 静态帧（poster）`。视频切换用两个 `<video>` 交叉淡入，过渡后移除旧节点。

### 6.3 应用内渲染：层叠与"透出"

实测 Web 壳结构：`<body><div id="root"></div></body>`，`html,body,#root{height:100%;margin:0}`；主题在 `body` 上定义 `--dsw-alias-bg-base`（浅 `neutral-bluish-00` / 深 `-950`），AppFrame `background: var(--dsw-alias-bg-base)` 铺满。因此"真壁纸"必须让至少一个背景层透明。

Client 层：

```html
<body>
  <div id="dswp-root" aria-hidden="true">
    <div class="dswp-media"></div>   <!-- 交叉淡入的两层 img/video -->
    <div class="dswp-scrim"></div>   <!-- 暗化/渐变 -->
  </div>
  <div id="root">…DSH 应用…</div>
</body>
```

```css
#dswp-root { position: fixed; inset: 0; z-index: -1; pointer-events: none; contain: strict; }
#dswp-root .dswp-frame { position: absolute; inset: 0; object-fit: cover; opacity: 0; transition: opacity 600ms; }
#dswp-root .dswp-frame[data-dswp-active] { opacity: 1; }

/* frame：相框，不动颜色 token */
html[data-dswp-mode="frame"] body { background: transparent !important; box-sizing: border-box; padding: var(--dswp-inset); }
html[data-dswp-mode="frame"] #root > div:first-child { border-radius: var(--dswp-radius); overflow: hidden; }

/* full：面板半透明，token 由 JS 按当前浅/深主题计算 */
html[data-dswp-mode="full"] body {
  --dsw-alias-bg-base: var(--dswp-surface) !important;
  --dsw-specific-sidebar-fill: var(--dswp-sidebar) !important;
}
```

`full` 模式下 `--dswp-surface` / `--dswp-sidebar` 由 client 用 `rgba(深/浅色, surfaceOpacity)` 计算并写到 `<html>`；浅/深判断读 `body[data-ds-dark-theme]`，主题切换由 `MutationObserver` 重新计算。scrim 用同样方式按 `scrim + dim` 计算。

必须遵守：

- 层 `aria-hidden`、`pointer-events:none`，不参与 Tab 顺序。
- `prefers-reduced-transparency` / `prefers-contrast` 提高 scrim 或降级。
- 卸载（停用/HMR）移除元素、样式、`data-dswp*` 属性、内联变量；只用 `ctx.effect` disposer。
- 层放在 `body` 直下（`shell.overlay` 在 AppFrame 之上，做不到背景）。

### 6.4 兼容性探测与降级

启动时检查：`#root` 存在；能读到 `--dsw-alias-bg-base`；探测失败自动用 `frame`（只做 body padding + 圆角），设置页提示。宿主升级最坏情况是"看不到壁纸"，不会破坏界面。

---

## 7. 插件工程（已实现）

### 7.1 目录结构

```
dsh-spend-wallpaper/
├─ package.json                # dsh.bundle.patch + dsh.client（无运行时依赖）
├─ cordis.patch.yml            # insert [{ id: spend-wallpaper, name: dsh-spend-wallpaper }]
├─ bin/
│  └─ dsh-spend-wallpaper.mjs  # 终端 CLI 入口（status / render）
├─ lib/                        # 发布内容（宿主直接加载，无编译步骤）
│  ├─ index.js                 # Host：Config + apply + WallpaperRuntime + 采样/档位/快照
│  ├─ money.js                 # 十进制字符串 ↔ 整数微单位
│  ├─ tiers.js                 # 阈值/迟滞/驻留/方向
│  ├─ window.js                # 滚动窗口 + 样本增删
│  ├─ sources.js               # account / api / manual 适配器
│  ├─ packs.js                 # manifest 校验、素材解析、路径安全
│  ├─ store.js                 # $DSH_HOME 状态持久化（原子写 + 防抖）
│  ├─ http.js                  # /state /packs /assets /refresh
│  ├─ client.js                # Client Module Loader bundle（自包含，无 import）
│  ├─ terminal.js              # ANSI 字符画/状态卡渲染（纯函数）
│  ├─ terminal-cli.js          # status/render 命令实现
│  └─ assets/packs/default/    # 5 × WebP + 5 × WebM + manifest.json
├─ test/                       # node --test 测试（host / client / assets / terminal）
├─ scripts/
│  ├─ gen-assets.py            # 程序化生成素材（Pillow + ffmpeg）
│  ├─ pack-check.mjs           # 素材包校验 CLI
│  └─ build-client.mjs         # client bundle 包装校验
├─ docs/                       # quickstart.md + terminal.md + design.md（本文）+ packs.md
├─ examples/profile-patch.yml  # manual 模式的 profile overlay 示例
├─ .github/workflows/ci.yml    # Node 20/22 CI
├─ README.md  CONTRIBUTING.md  SECURITY.md  CHANGELOG.md
└─ LICENSE（代码 MIT）+ LICENSE-ASSETS（内置素材 CC0）
```

### 7.2 `package.json` 关键字段

```jsonc
{
  "type": "module",
  "main": "lib/index.js",
  "bin": { "dsh-spend-wallpaper": "./bin/dsh-spend-wallpaper.mjs" },
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./terminal": "./lib/terminal-cli.js"
  },
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true },
    "compatibility": { "dsh": ">=0.2.0-rc.1 <0.3.0-0" }
  },
  "peerDependencies": { "@deepseek-ai/cordis": "~4.1.0", "@deepseek-ai/schemastery": "~3.19.0" }
}
```

> `immediately: true` 让壁纸层在页面启动时即物化（官方 `ui-theme` 也这样声明），而不是等某个 slot 首次渲染才懒加载。

### 7.3 Host 插件骨架（实际代码结构）

```ts
import z from '@deepseek-ai/schemastery'

export const name = 'spend-wallpaper'
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  source: z.union(['auto', 'account', 'api', 'cost-meter', 'manual']).default('auto').volatile(),
  // … thresholds / mode / media / scrim / hysteresis 等全部 volatile
})

export function apply(ctx, config) {
  const runtime = new WallpaperRuntime(ctx, config)
  ctx.effect(() => runtime.start(), 'spend-wallpaper: sampler')
  ctx.provide('wallpaper', runtime)
  ctx.inject(['webServer'], (child) => {
    child.effect(() => runtime.registerRoutes(child), 'spend-wallpaper: http routes')
  })
}
```

**关键坑（已在真实宿主上修复）**：volatile Config 字段在运行时是 **getter ref**（`config.thresholds.get()`），不能直接当值读；`ctx.config` 访问还需要 `inject`，所以插件只读 `apply` 传入的 config，并逐字段解包 ref。

### 7.4 Client 插件骨架

`lib/client.js` 是自包含 bundle（无 import），由宿主 `dsh-client-modules` 通过 `/plugins` 提供：

```js
window.__ModuleLoader__.load({
  id: 'dsh-spend-wallpaper',
  factory: (require) => ({
    name: 'spend-wallpaper-client',
    inject: [],
    apply(ctx) {
      ctx.effect(() => installLayer(ctx), 'spend-wallpaper: wallpaper layer')
    },
  }),
})
```

`installLayer`：注入 `<style>` → 创建 `#dswp-root`（media + scrim）→ `poll()` 拉 `/state` → 应用 `data-dswp-mode` 与 CSS 变量、交叉淡入素材 → `visibilitychange` 暂停视频 → disposer 全量清理。

### 7.5 构建与调试

- Client 无需打包器（自包含）；`node scripts/build-client.mjs` 校验包装形态。
- Host 直接 ESM；`@deepseek-ai/*` 由宿主 runtime resolution 解析（已实测可解析 `@deepseek-ai/schemastery`）。
- 测试与校验：
  ```sh
  npm test                      # node --test：host / client / assets
  node scripts/pack-check.mjs   # 校验内置素材包
  ```
- 安装：
  ```sh
  dsh plugin --profile <profile> add link:E:/workspace/dsh-spend-wallpaper
  ```
- 验证（本机已跑通）：
  ```sh
  dsh --profile wp-test --dump-config          # 组合树里出现 spend-wallpaper
  dsh --profile wp-test --dump-config-schema   # Config 被成功导入并投影（含 volatile 标记）
  dsh --profile wp-test --port 0 --no-open     # 起临时实例
  curl http://127.0.0.1:<port>/plugins/dsh-spend-wallpaper/state
  ```

### 7.6 终端 surface（M0.1）

终端没有 DOM，`dsh.client` 那套渲染用不上。为了让"在终端跑 DSH"或"只想在 shell 里看消耗"的场景可用，增加一个**纯读取**的 CLI：

```
bin/dsh-spend-wallpaper.mjs
   └─ lib/terminal-cli.js   # 参数解析、状态读取、动画循环
        └─ lib/terminal.js  # 纯函数：ANSI 字符画 / 状态卡 / 宽字符处理
```

命令：

| 命令 | 作用 |
|---|---|
| `status [--json]` | 读取 `state.json`，打印余额/档位/下一档/数据源/诊断；`--json` 供脚本/提示符消费 |
| `render [--tier N] [--once] [--fps N] [--color truecolor\|256\|none] [--width/--height]` | 把档位渲染成 ANSI 半块字符画；TTY 下默认全屏动画（`q` 退出），非 TTY 或 `--once` 只输出一帧 |

关键设计：

- **状态来源单一**：Host 在 `persist()` 中额外写入 `spendMicro`、`windowReason`、`source`、`status`、`updatedAt` 和一份配置快照（阈值/方向/素材包等），CLI 只读这一个文件，不依赖 DSH API、也不需要 YAML 解析器。
- **渲染与 Web 解耦**：`lib/terminal.js` 不 import 任何 `@deepseek-ai/*`，用与内置素材一致的 5 套调色板（渐变 + 波浪 + 星光 + 闪电）生成字符画；`--color none` 时按帧内亮度归一化输出 ASCII，便于日志。
- **不谎报**：`--tier` 只影响预览，状态行会显示指定档位；终端渲染是简化情绪，不是终端模拟器的背景图。
- **限制**：颜色/波浪来自内置调色板，暂不从用户素材包取色；极慢终端建议降 `--fps`/`--width`。

---

## 8. 配置项

| 分组 | 配置项 | 默认 | 说明 |
|---|---|---|---|
| 总开关 | `enabled` | true | 关闭后移除壁纸层并恢复覆盖 |
| 数据 | `source` | auto | auto / account / api / manual（`cost-meter` 保留，等同 auto） |
| 数据 | `currency`, `usdCny` | CNY, 7.2 | 显示币种与折算率 |
| 数据 | `apiBase`, `apiKeyEnv` | 官方, `DEEPSEEK_API_KEY` | 仅官方域名 |
| 数据 | `windowMinutes` | 60 | 滚动窗口 5–180 |
| 数据 | `sampleSeconds` | 180 | 采样间隔 60–600 |
| 档位 | `thresholds` | `["0","0.05","0.30","1.50","6.00"]` | 5 档阈值（字符串，严格递增） |
| 档位 | `direction` | poor | poor / rich |
| 档位 | `hysteresis` | 0.25 | 迟滞比例 |
| 档位 | `minDwellSeconds` | 600 | 最短驻留 |
| 素材 | `pack`, `media` | default, auto | 素材包 / static / dynamic / auto |
| 渲染 | `mode` | frame | frame / full |
| 渲染 | `scrim`, `dim`, `blur` | .28 / .08 / 0 | 可读性与氛围 |
| 渲染 | `surfaceOpacity` | .7 | full 模式面板不透明度 |
| 渲染 | `inset`, `radius` | 16 / 16 | frame 模式相框 |
| 其它 | `lockedTier`, `manualSpend` | "" / "0" | 锁定档位 / manual 源 |

设置页：M0 用 DSH 自动生成的 Config 表单（只展示 volatile 字段）；M1 再注册 `settings.section` + `plugins.bundle.config` 自绘页面（状态卡、迷你趋势、素材缩略图、预览/锁定）。

---

## 9. 安全、隐私与性能

**隐私**：余额只在本机内存与 `$DSH_HOME/storages/spend-wallpaper/state.json`；不上报、不写日志正文；API Key 只经 `ctx.credentials`/环境变量，绝不进入 Client 状态或 URL。

**安全**：素材路由 `decodeURIComponent` → 拒绝 `..`/绝对路径 → `realpath` 必须落在包根内；扩展名白名单；用户包禁 SVG；所有路由同源栅栏；`/state` no-store，`/assets` ETag + `max-age=3600`。

**性能**：静态 2560×1440 WebP（约 300KB）；视频 720p/6s/约 100KB；隐藏时暂停；采样每 3 min 一次 HTTP，失败退避；无 60fps 常驻动画。

---

## 10. 测试计划与已执行

| 内容 | 状态 |
|---|---|
| Host 纯逻辑单测：money / tier / window / packs / API 基址 | ✅ `npm test`（`test/host.test.mjs`） |
| 终端渲染与 CLI：几何/颜色/状态读取/预览 | ✅ `npm test`（`test/terminal.test.mjs`） |
| Client bundle 加载 + apply + dispose 烟雾测试 | ✅ `npm test`（`test/client.test.mjs`） |
| 内置素材存在性/尺寸/魔数检查 | ✅ `npm test`（`test/assets.test.mjs`） |
| 组合树装载 + Config schema 投影 | ✅ `dsh --profile <p> --dump-config(-schema)` |
| 真实宿主跑通 `/state`、`/packs`、`/assets`、`/refresh` | ✅ 临时 profile 实例 |
| 浏览器端视觉/交互（frame/full、视频、reduced-motion、卸载清理） | ⏳ M1 |
| 视觉回归：5 档 × 浅/深主题 × frame/full | ⏳ M1 |
| 兼容矩阵：0.2.2-rc.1 / 下一 minor；Web + Desktop | ⏳ M1 |

---

## 11. 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| **M0 技术验证** | Host 采样/窗口/档位/HTTP + Client 壁纸层 + 内置静态素材 + manual source | ✅ 完成 |
| **M0.1 终端 surface** | `status` / `render` CLI、状态文件扩展、ANSI 渲染测试 | ✅ 完成 |
| **M1 可用** | 自绘设置页（状态卡/预览/锁定）+ 动态视频启用确认 + full 模式调参 + i18n + 视觉回归 | ⏳ |
| **M2 完整** | 用户素材包热加载、素材诊断面板、性能调优、发布插件市场 | ⏳ |

---

## 12. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| DOM/token 与宿主版本耦合 | 升级后壁纸不可见/样式错乱 | 探测 + 自动降级 `frame`；版本范围声明；视觉回归 |
| 余额语义（充值/赠送回收/多设备） | 误判档位 | 负差额归零、`stale` 冻结、文案标注"约" |
| 接口限流/未登录 | 无数据 | 指数退避、源回退、`warming`/`unavailable` 状态 |
| 动态视频耗电 | 体验差 | 隐藏暂停、reduced-motion、文件上限、`auto` 且默认静态优先 |
| 自动播放策略 | 视频不播 | `muted` + `playsinline`；失败回退 poster |
| 用户素材安全 | 路径穿越/脚本 | 目录约束 + 扩展名白名单 + 禁 SVG |

---

## 13. 备选方案（已评估）

1. **只用主题换色**：`ctx.theme` 换不了图片。
2. **纯 Client 插件**：读不到余额/凭据。
3. **纯 Host + Electron IPC 改窗口背景**：超出插件权限，Web 模式不可用。
4. **生成式壁纸优先**：体积小、天然动态；作为 v2 动态兜底（已保留 `gen-assets.py` 的波浪算法可复用）。

---

## 附录 A：为什么应用内动态壁纸可行

- 动态 = 循环视频 / 动图 / Canvas，Chromium（Electron 与浏览器）都支持；
- 自动播放只要求 `muted`；
- 通过 `/plugins/.../assets/...` 提供文件，Web 与 Desktop 两种载体都能取到（Desktop 经 IPC fetch 桥）。

## 附录 B：Windows 桌面壁纸（v2 适配器，已决定暂不做）

- 静态：`SystemParametersInfoW(SPI_SETDESKWALLPAPER, ...)`（koffi）；多显示器需 COM `IDesktopWallpaper`。
- 动态：Windows 无原生支持；可近似"幻灯片"，或对接 Lively Wallpaper（第三方依赖）。
- 结论：仅作为将来可选的独立子插件，不影响应用内方案。

## 附录 C：实测依据（本机 DSH 0.2.2-rc.1）

| 事实 | 依据 |
|---|---|
| 插件是 Cordis 插件：`name` / `inject` / `Config`(schemastery) / `apply` | `dsh-tool-todo/lib/index.js`、`dsh-tool-str-replace-editor/lib/index.js` |
| 第三方插件用 `dsh.bundle.patch` + `insert: [{ id, name }]` 进入 profile | `dsh-cost-meter/cordis.patch.yml` |
| 浏览器半侧：`dsh.client.platform: 'web'` + `exports["./client"]` + Module Loader bundle | `dsh-cost-meter/package.json`、`lib/client.js` |
| Web 壳：`<body><div id="root"></div></body>`；`html,body,#root{height:100%;margin:0}` | `dsh-web-frontend/dist/index.html` + `index-*.css` |
| `body` 背景 = `--dsw-alias-bg-base`；侧栏 = `--dsw-specific-sidebar-fill`；浅/深 token `neutral-bluish-00/-950` | `dsh-client-ui-theme/lib/client.js`、`dsh-client-ui-layout/lib/client.js` |
| webserver：`register({ kind, path, resource|handler })`；resource 仅 GET/HEAD；无认证 | `@deepseek-ai/dsh-host-webserver/lib/index.js` + README |
| 账号余额：`ctx.deepseekAccount.getBalance(metadata)`，`value`/`bonusWallets` 钱包列表；`getState().status` | `dsh-deepseek-account` README、cost-meter `index.js` |
| volatile Config 字段是 getter ref（`.get()`）；设置只展示 volatile | `dsh-experimental-speech-to-text/lib/index.js`、`dsh-settings` README |
| cost-meter 账本：`$DSH_HOME/storages/cost-meter/ledger.json` 按天/会话聚合，无逐次时间戳 | 本机实际 ledger.json + `store.js` |
| 临时 profile 可跑通：`dsh --profile wp-test --dump-config-schema` / `--port 0 --no-open` | 本机实测 |

## 附录 D：M1 待验证假设

1. Electron（Desktop 宿主）里 file:// 页面的 `/plugins/...` fetch 是否经 IPC 桥接（Web 模式已验证；Desktop 待验证）。
2. `full` 模式面板半透明在浅/深主题下的可读性；可能需要提高 `surfaceOpacity` 默认值。
3. 视频随 `<video>` 预加载/循环的耗电与首帧时间。
4. 自绘设置页在 `settings.section` 与 `plugins.bundle.config` 两个 slot 的注册与卸载清理。

## 附录 E：M0 验证记录（2026-11-09，DSH 0.2.2-rc.1）

| 验证项 | 命令 / 方式 | 结果 |
|---|---|---|
| 组合装载 | 临时 profile + `dsh --profile wp-test --dump-config` | `- id: spend-wallpaper / name: dsh-spend-wallpaper` 出现 |
| Config 导入与投影 | `dsh --profile wp-test --dump-config-schema` | `config102` 含全部字段与 `x-cordis.volatile`；`@deepseek-ai/schemastery` 解析成功 |
| Host 启动 | `dsh --profile wp-test --port 0 --no-open` | 插件无激活错误；`/state` 可访问 |
| 数据源回退 | 未登录 + 无 Key 的 wp-test profile | `status: unavailable`，`lastError: api-key-missing`，不刷屏 |
| 手动档位 | `--patch` 覆盖 `source: manual, manualSpend: "0.40"` | `tier=2 起浪`，`next=1.50 浪涌`，素材 `2-swell.webm` |
| 素材路由 | GET `0-calm.webp` / `2-swell.webm` | `200`，正确 content-type / ETag / `max-age=3600` |
| 安全栅栏 | `..%2F..%2Fpackage.json`；`Sec-Fetch-Site: cross-site` | `404` / `403` |
| 刷新 | `POST /plugins/dsh-spend-wallpaper/refresh` | 返回最新快照 |
| Host 单测 | `npm test` | host / client / assets / terminal 全部通过 |
| 终端 CLI | `node bin/dsh-spend-wallpaper.mjs status --json` / `render --tier 4 --once` | 读取快照、输出状态卡与 ANSI 字符画 |
| Client 烟雾测试 | `npm test`（`test/client.test.mjs`） | factory → apply → state 渲染（full 模式、video 帧、样式注入）→ dispose 清理全部通过 |
| 素材检查 | Pillow 打开 WebP；`ffprobe` 检查 WebM | 2560×1440 WebP；1280×720 VP9、6.000s |

验证用的临时 profile、patch 与导出文件已清理；数据源真实联动（账号余额 / API Key）需在用户自己的 profile 中验证。

