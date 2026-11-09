# 终端里使用（terminal surface）

Web GUI 里插件在浏览器中绘制真实的图片/视频背景。终端没有这个图层，所以插件额外提供一个 **终端 CLI**：

- `status`：读取 Host 写下的快照，打印余额、档位、数据源与诊断；
- `render`：把当前档位的「深海情绪」用 ANSI 字符画渲染到终端（支持全屏动画）。

这不是"终端背景图"（终端模拟器不支持应用改写背景），而是把同一套档位情绪渲染成字符画；`status --json` 也方便接进提示符或状态栏。

---

## 1. 准备

终端 CLI 只是**读取** Host 写下的状态文件：

```
$DSH_HOME/storages/spend-wallpaper/state.json
```

所以先确保：

1. 插件已经安装并在某个 profile 里启用；
2. DSH 正在运行（Host 半边每 3 分钟采样一次，状态文件随之更新）。

如果 DSH 没开，CLI 仍然能 `render --tier N` 预览，只是 `status` 会显示最后一次快照（或「还没有状态数据」）。

> 不需要在 DSH 里做任何额外设置；Web GUI 和终端可以同时用。

---

## 2. 运行方式

### 方式 A：直接从仓库运行（最简单）

```sh
node E:\workspace\dsh-spend-wallpaper\bin\dsh-spend-wallpaper.mjs status
node E:\workspace\dsh-spend-wallpaper\bin\dsh-spend-wallpaper.mjs render
```

> 如果 `PATH` 里没有 `node`，可以用 DSH 自带的运行时：
> `%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
> （把上面的 `node` 换成这个完整路径即可）。

### 方式 B：PowerShell 里加个别名

在 `$PROFILE` 里加：

```powershell
function dswp { node "E:\workspace\dsh-spend-wallpaper\bin\dsh-spend-wallpaper.mjs" @args }
```

之后：

```powershell
dswp status
dswp render
```

### 方式 C：`npm link`（全局命令）

在仓库目录执行：

```sh
npm link
dsh-spend-wallpaper status
```

之后在任何终端都能直接调用 `dsh-spend-wallpaper`。

---

## 3. 查看状态

```sh
dsh-spend-wallpaper status
```

```
╭─ 余额壁纸 ───────────────────────────────────────────╮
│ 最近 1 小时  0.42 CNY                                │
│ 当前档位    第 2 档「起浪」                          │
│ 下一档      1.5 浪涌                                 │
│ 数据源      账号余额 · 37 个样本                      │
│ 更新于      12 秒前                                  │
╰──────────────────────────────────────────────────────╯
```

机器可读输出（给提示符、状态栏或脚本用）：

```sh
dsh-spend-wallpaper status --json
```

```json
{
  "ok": true,
  "spend": "0.42",
  "tierIndex": 2,
  "tierLabel": "起浪",
  "nextAt": "1.5",
  "source": "account",
  "samples": 37,
  "updatedAt": 1794236424910,
  "lastError": null
}
```

---

## 4. 在终端里放"壁纸"

```sh
dsh-spend-wallpaper render
```

- 默认读取当前档位，全屏动画（波浪 + 星光 + 底部状态行），按 `q` 退出；
- 只在 TTY 下自动动画；重定向到文件或管道时只输出一帧；
- 需要真彩色：Windows Terminal、VS Code 终端、iTerm2、WezTerm 等现代终端都支持；老控制台可加 `--color 256`。

常用参数：

```sh
# 指定档位预览（不会改动真实状态）
dsh-spend-wallpaper render --tier 4

# 只输出一帧（截图/写进文档）
dsh-spend-wallpaper render --tier 2 --once

# 无颜色（纯 ASCII，适合日志/低配终端）
dsh-spend-wallpaper render --tier 0 --once --color none

# 自定义尺寸与帧率
dsh-spend-wallpaper render --width 100 --height 30 --fps 6

# 不要底部状态行
dsh-spend-wallpaper render --no-status
```

档位也可以用 id 指定：`--tier calm|ripple|swell|storm|tsunami`。

---

## 5. 放进 shell 提示符（可选）

PowerShell 示例：每次提示符前显示一行简版余额（注意会启动一个 Node 进程，略慢；更推荐定时刷新写缓存）：

```powershell
function prompt {
  $line = & node "E:\workspace\dsh-spend-wallpaper\bin\dsh-spend-wallpaper.mjs" status --json 2>$null |
    ConvertFrom-Json
  $suffix = if ($line.ok) { " [¥$($line.spend)/h · $($line.tierLabel)]" } else { "" }
  "PS $($executionContext.SessionState.Path.CurrentLocation)$suffix> "
}
```

如果觉得慢，可以把 `status --json` 的输出写到临时文件、由计划任务/定时器刷新（或直接用壁纸本身）。

---

## 6. 和 DSH 终端面板的关系

- DSH Web GUI 里的侧栏终端/终端工具是应用内的字符界面，插件不会也不能改写它的背景；`render` 命令可以在**那个终端里运行**，效果就是一个全屏 ANSI 壁纸。
- `frame` 模式下，Web GUI 的终端面板之外仍能看到壁纸；`full` 模式下面板自身背景会盖住壁纸。
- 如果你想要"终端模拟器自己的背景图"，那是 Windows Terminal / iTerm 等的设置项，不属于 DSH 插件范围。

---

## 7. 已知限制

- 终端渲染是**简化版**：渐变 + 波浪 + 星光 + 闪电/金币提示，不含 Web 素材的鲸鱼剪影等细节；
- 颜色与档位内置于 `lib/terminal.js`，暂不从用户素材包取色；
- 动画是每帧重绘整屏（约 `宽×高` 个半块字符），极低带宽/极慢终端上可能卡顿，可调低 `--fps` 或 `--width`；
- 状态需要 DSH 运行才有实时数据；`render --tier` 预览不依赖 DSH。
