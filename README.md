# dsh-spend-wallpaper · 余额壁纸

按「最近 1 小时消耗的 DeepSeek 余额」切换 DSH Web GUI 背景壁纸的插件。内置两套程序化生成素材：默认的 **DeepSeek 干饭（Q 版鲸娘吃饭）** 与 **深海情绪**（5 档 × 静态 WebP + 动态 WebM 循环视频），也支持自定义素材包。

- 快速上手：[docs/quickstart.md](docs/quickstart.md)
- 终端使用：[docs/terminal.md](docs/terminal.md)
- 设计文档：[docs/design.md](docs/design.md)
- 素材包作者指南：[docs/packs.md](docs/packs.md)
- 变更记录：[CHANGELOG.md](CHANGELOG.md)
- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md) · 安全说明：[SECURITY.md](SECURITY.md)

## 特性

- **自定义素材包**：`$DSH_HOME/spend-wallpaper/packs/<id>/manifest.json`，用户包可覆盖同名内置包。
- **滚动 1 小时消耗**：`余额(now) − 余额(now − 60min)`，不是"今天花了多少"。
- **三路数据源**：`dsh-cost-meter` 本地用量估算（默认优先，适配订阅/零钱包账号）→ 桌面登录账号钱包（`ctx.deepseekAccount`）→ 开放平台 `/user/balance`（API Key）；`manual` 用于联调。
- **静态 / 动态可选**：`auto` / `static` / `dynamic`；尊重 `prefers-reduced-motion`，窗口不可见时暂停视频。
- **五档 + 迟滞 + 最短驻留**：默认阈值 `0 / 0.05 / 0.30 / 1.50 / 6.00 ¥/小时`，不会在边界抖动。
- **两种显示模式**：`full`（默认，壁纸铺满整个窗口、界面半透明）与 `frame`（相框，仅在四周露出壁纸，最保守）。
- **方向可选**：`poor`（默认，越花越惨）/ `rich`（越花越豪华）。
- **五档动画场景**：默认「DeepSeek 干饭」——花得越少吃越香：满汉全席 → 拉面 → 咖喱饭 → 白饭梅干 → 空碗流泪；另有「深海情绪」极光/鲸群/紫潮/风暴/海啸。每档一棵静态 WebP + 一段循环 WebM。
- **状态持久化**：样本与档位存在 `$DSH_HOME/storages/spend-wallpaper/state.json`，重启不重新预热。
- **终端可用**：`dsh-spend-wallpaper status` 看余额/档位，`render` 把当前档位渲染成 ANSI 字符画动画（详见 [docs/terminal.md](docs/terminal.md)）。

## 安装

插件通过 profile 的 patch 层插入一行 host 插件，浏览器半边由 `dsh.client` 声明自动提供。桌面 App 的图形步骤见 [快速上手](docs/quickstart.md)，命令行方式是：

```sh
# Web profile（可替换为 desktop 等 profile 名）
dsh plugin --profile web add link:E:/workspace/dsh-spend-wallpaper
```

Desktop profile 用插件管理器（设置 → 插件）安装同一个 `link:` 路径，或使用 Desktop 内置命令运行时执行同样的 `dsh plugin --profile desktop add link:...`。

安装后重启 profile（或等 HMR 重载）即可生效。

## 配置

所有字段都是 Cordis `Config` 的 volatile 字段。M0 阶段通过 profile 的 `cordis.patch.yml` 配置（改完重启 profile，或启用 HMR 时等待重载）；也可以使用 [examples/profile-patch.yml](examples/profile-patch.yml) 作为 overlay 传给启动器：

```sh
dsh --profile web --patch E:/workspace/dsh-spend-wallpaper/examples/profile-patch.yml
```

```yaml
- id: spend-wallpaper
  config:
    source: manual          # 先用 manual 联调
    manualSpend: "0.40"     # 假装最近 1 小时花了 ¥0.40
    mode: full              # full（默认，铺满）/ frame（相框）
    media: auto             # auto / static / dynamic
    thresholds: ["0", "0.05", "0.30", "1.50", "6.00"]
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `source` | `auto` | `auto` / `cost-meter` / `account` / `api` / `manual`；`auto` 顺序为 cost-meter → account → api |
| `currency` | `CNY` | 显示与阈值币种 |
| `apiBase` | `https://api.deepseek.com` | 仅允许官方域名 |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 经 `ctx.credentials` 或环境变量解析 |
| `windowMinutes` | `60` | 滚动窗口（5–180） |
| `sampleSeconds` | `180` | 采样间隔（60–600） |
| `direction` | `poor` | `poor` / `rich` |
| `mode` | `full` | `full`（铺满）/ `frame`（相框） |
| `media` | `auto` | `auto` / `static` / `dynamic` |
| `pack` | `deepseek-eats` | 素材包 id：`deepseek-eats`（默认，Q 版干饭）/ `default`（深海情绪） |
| `scrim` / `dim` / `blur` | `.10` / `.03` / `0` | 可读性、氛围与壁纸模糊 |
| `surfaceOpacity` | `.50` | `full` 模式面板不透明度（越低壁纸越明显） |
| `inset` / `radius` | `16` / `16` | `frame` 模式相框 |
| `transitionMs` | `600` | 交叉淡入时长 |
| `hysteresis` | `.25` | 越过阈值 25% 才换档 |
| `minDwellSeconds` | `600` | 最短驻留时间 |
| `thresholds` | `["0","0.05","0.30","1.50","6.00"]` | 五档阈值（字符串，严格递增） |
| `manualSpend` | `"0"` | `source=manual` 时的固定消耗 |
| `lockedTier` | `""` | 锁定档位 id 或序号，空 = 自动 |

## 素材包

```
lib/assets/packs/default/           # 内置（用户包同名覆盖）
$DSH_HOME/spend-wallpaper/packs/<id>/
├─ manifest.json
├─ 0-calm.webp / 0-calm.webm        # 每档 static 必需，dynamic 可选
└─ ...
```

只接受位图（webp/jpg/png/avif/gif/apng）与视频（mp4/webm），不接受用户提供 SVG。完整规范与校验方式见 [docs/packs.md](docs/packs.md)。

重新生成内置素材（需要 Python + Pillow + numpy + ffmpeg）：

```sh
python scripts/gen-assets.py
python scripts/gen-assets.py --skip-video   # 只出静态图
```

## 项目结构

```
bin/                 终端 CLI 入口（dsh-spend-wallpaper status / render）
lib/                 发布内容：host 模块 + client bundle + 终端渲染器 + 内置素材
test/                node --test 测试（host / client / assets / terminal）
scripts/             gen-assets.py、pack-check.mjs、build-client.mjs
docs/                quickstart.md、terminal.md、design.md、packs.md
examples/            manual 模式 profile overlay
.github/workflows/   CI（Node 20 / 22）
```

本项目没有编译步骤：`lib/` 是手写 ESM 源码，`lib/client.js` 是单个自包含的 DSH client bundle。

## 终端使用

DSH 在终端里跑（或你只想在 shell 里看消耗）时，用同一个包里的 CLI：

```sh
# 直接运行（无需全局安装）
node E:\workspace\dsh-spend-wallpaper\bin\dsh-spend-wallpaper.mjs status
node E:\workspace\dsh-spend-wallpaper\bin\dsh-spend-wallpaper.mjs render

# 或 npm link 之后全局使用
dsh-spend-wallpaper status --json
dsh-spend-wallpaper render --tier 4 --once
```

完整说明（动画、颜色模式、提示符集成、限制）见 [docs/terminal.md](docs/terminal.md)。

## 开发与测试

```sh
npm test                      # node --test：host + client + assets + terminal
node scripts/build-client.mjs # 校验 client bundle 包装形态
node scripts/pack-check.mjs   # 校验内置素材包（也可传任意素材包目录）
npm run demo                  # 终端渲染一帧示例
```

HTTP 接口（同源、只读为主）：

| 方法与路径 | 说明 |
|---|---|
| `GET /plugins/dsh-spend-wallpaper/state` | 当前快照（`no-store`） |
| `GET /plugins/dsh-spend-wallpaper/packs` | 已发现素材包 |
| `GET /plugins/dsh-spend-wallpaper/assets/<pack>/<file>` | 素材（ETag + `max-age=3600`） |
| `POST /plugins/dsh-spend-wallpaper/refresh` | 立即采样（10 秒限流） |

`source=manual` + `POST /refresh` 可以在不真实烧钱的情况下把所有档位过一遍。

## 已验证（2026-11-09，DSH 0.2.2-rc.1）

- 组合装载：临时 profile 中 `dsh --profile <p> --dump-config` 出现 `spend-wallpaper` 行；`--dump-config-schema` 成功导入 `Config` 并投影出 volatile 字段（说明 `@deepseek-ai/schemastery` 可由宿主 runtime resolution 解析）。
- 真实宿主：`dsh --profile <p> --port 0 --no-open` 启动后
  - `GET /plugins/dsh-spend-wallpaper/state` 返回完整快照（未配置数据源时 `status: unavailable`，不会报错刷屏）；
  - `GET /plugins/dsh-spend-wallpaper/packs` 列出内置 `default` 与 `deepseek-eats` 两套 5 档素材；
  - `GET .../assets/default/0-calm.webp` → `200 image/webp`，`.webm` → `200 video/webm`，带 ETag / `max-age=3600`；目录穿越 → `404`，`Sec-Fetch-Site: cross-site` → `403`；
  - `POST .../refresh` → 返回刷新后的快照；
  - `source=manual, manualSpend=0.40` → `tier=2「起浪」`、`next=1.50「浪涌」`，素材 URL 指向 `2-swell.webm`。
- 自动化测试：`npm test` 覆盖 host 逻辑、client bundle 生命周期（stub DOM）、内置素材完整性与终端渲染/CLI。
- 终端 surface：`npm run demo` 与 `render --tier N --once` 在本机 PowerShell 实测可输出 ANSI 真彩色/单色字符画；`status` 能读取 Host 写入的快照。
- 实机运行（2026-11-10，桌面 App）：插件以 `link:E:/workspace/dsh-spend-wallpaper` 装入 desktop profile 后 Host 激活，`source=auto` 选中 `cost-meter`（账号钱包为 0 时仍能工作），`/state` 返回档位与素材 URL；`status` 显示「本地用量估算」。
- 素材：5 × 2560×1440 WebP（约 220–310 KB）+ 5 × 1280×720 VP9 WebM（6s，约 90–111 KB），全部由 `scripts/gen-assets.py` 程序化生成。

**未验证**：真实浏览器里的视觉效果（frame/full 两种模式、视频自动播放、reduced-motion、Desktop 载体的 file:// fetch 桥）。这些属于 M1 的浏览器回归测试。

## 已知限制

- `frame` 模式依赖 Web 壳的 `<body><div id="root">…` 结构；`full` 模式依赖 `--dsw-alias-bg-base` / `--dsw-specific-sidebar-fill` 两个主题 token。宿主大版本升级后若结构变化，插件会自动退化为 `frame` 的安全子集（设置页会提示）。
- 余额接口有分钟级计费延迟；窗口值标注为"约"。充值/赠送回收按 0 消耗处理。
- 同一账号在其它设备上的消耗会计入余额差（这是"账号消耗"而非"本机消耗"）。
- `cost-meter` 数据源依赖已安装的 `dsh-cost-meter`（读取其 `getState()` 的今日成本计数器并差分），金额是**本地估算**，与官方账单存在分钟级差异；未安装时自动回退到账号余额/API Key。
- 暂不做 Windows 桌面壁纸（设计文档中的 v2 适配器）。
- 终端里的 `render` 是字符画简化版（渐变+波浪+星光），不是终端模拟器的真实背景图；详见 [docs/terminal.md](docs/terminal.md)。

## License

插件代码 [MIT](LICENSE)；内置素材由 `scripts/gen-assets.py` 程序化生成，[CC0-1.0](LICENSE-ASSETS)。
