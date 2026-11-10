# 快速上手（5 分钟）

本教程面向已经装好 DSH Desktop / Web 的用户。插件装好后，DSH 窗口背景会随「最近 1 小时消耗的 DeepSeek 余额」变化。

> 当前版本是 M0：**还没有设置页**，配置通过 profile 的 `cordis.patch.yml` 完成（本文会给出可直接复制的片段）。M1 会加图形设置页。

- 安装目录：`E:\workspace\dsh-spend-wallpaper`
- 配置目录：`C:\Users\32602\.dsh\profiles\desktop\`（下文用 `$DSH_HOME/profiles/desktop` 表示）
- 状态文件：`$DSH_HOME/storages/spend-wallpaper/state.json`

---

## 1. 安装（桌面 App，推荐）

1. 打开 DSH 侧栏的 **插件** 页；
2. 点右上角 **添加插件** → 菜单里选 **安装第三方插件**；
3. 在包名输入框里填本地绝对路径：

   ```
   E:\workspace\dsh-spend-wallpaper
   ```

4. 点 **安装**，等它完成；
5. 安装完成界面点 **立即启用**（如果没点，就在「已安装插件」里把 `dsh-spend-wallpaper` 打开）。

如果窗口背景没有立刻变化：先按 `Ctrl+R` 刷新页面；仍然没有就完全退出并重启 DSH（部分 profile 没开 HMR 时需要重启）。

> 装好后不用改任何配置，**默认就会显示「DeepSeek 干饭」第 0 档「满汉全席」壁纸**（壁纸铺满整个窗口，界面面板半透明）。

---

## 2. 第一次确认它工作

- 壁纸铺满整个应用窗口，中间是半透明的 DSH 界面；
- 打开 `$DSH_HOME/storages/spend-wallpaper/state.json`，应该能看到 `samples` 数组在缓慢增加，或至少有一行 `lastError` 说明数据源状态；
- 默认 `source: auto` 的选择顺序：**`dsh-cost-meter` 本地用量估算**（装了 `dsh-cost-meter` 时优先，订阅/零钱包也能用）→ 桌面登录账号钱包 → `DEEPSEEK_API_KEY`。

> 看数据是否真的取到：等 3–5 分钟看 `state.json` 里的 `samples` 是否变多，`source` 是哪个。如果 `samples` 一直为空且 `lastError` 非空，说明三个数据源都没成功，见第 7 节。

---

## 3. 1 分钟把各档位都看一遍（不花真钱）

打开 `C:\Users\32602\.dsh\profiles\desktop\cordis.patch.yml`，在文件末尾追加：

```yaml
- id: spend-wallpaper
  config:
    source: manual
    manualSpend: "0.40"
    sampleSeconds: 60
    minDwellSeconds: 60
    hysteresis: 0
```

保存后等几秒（HMR 会自动重载）；壁纸应切成第 2 档 **「起浪」**（紫蓝色海浪）。

然后依次把 `manualSpend` 改成下面的值，每次等最多约 1 分钟（或重启应用立刻生效）：

| `manualSpend` | 档位 | 名称 |
|---|---|---|
| `"0"` | 0 | 无波 |
| `"0.10"` | 1 | 微澜 |
| `"0.40"` | 2 | 起浪 |
| `"2"` | 3 | 浪涌 |
| `"8"` | 4 | 海啸 |

看完把 `source: manual` 改成 `source: auto`（或删掉上面这段），回到真实余额模式。

---

## 4. 日常使用

- **快捷切换壁纸**：点右下角 🐋 图标打开面板：每档可上传自己的图片或视频（「上传」「清除」），档位数量可 2–8 增减，5 个阈值可按需修改；还能预览任意档、锁定当前档、刷新数据、恢复默认，以及调外观滑杆、切换动画、采样间隔、统计窗口和防抖。改动立即生效并记住，不用改 YAML。
- **自动切换**：默认就是自动。默认阈值 `0 / 0.05 / 0.30 / 1.50 / 6.00 ¥/小时`（可在面板改），每 3 分钟采样一次，档位变化有「迟滞 + 最短驻留 10 分钟」防抖。
- **切静态/动态**：`media: auto`（默认，有视频用视频、开了减少动效用静态）/ `static` / `dynamic`。
- **铺满显示**：壁纸始终铺满窗口，界面半透明；觉得字不够清楚就调 `surfaceOpacity` / `scrim`。
- **方向**：`direction: poor`（默认，花得越多越惨）或 `rich`（花得越多越豪华）。
- **不想被换**：`enabled: false` 关掉，或 `lockedTier: "calm"` 锁在某一档。
- **全屏/终端面板**：壁纸在应用背景层，终端、菜单等面板不会被替换。

常用完整配置示例：

```yaml
- id: spend-wallpaper
  config:
    source: auto
    direction: poor
    media: auto
    thresholds: ["0", "0.05", "0.30", "1.50", "6.00"]
    scrim: 0.10        # 壁纸上的暗化（0–1），太大就调小
    dim: 0.03
```

---

## 5. 在终端里看（不用打开 GUI）

同一个包附带一个终端 CLI，读取插件的状态文件：

```sh
# 在仓库目录直接运行
node bin\dsh-spend-wallpaper.mjs status          # 状态卡：余额/档位/数据源
node bin\dsh-spend-wallpaper.mjs render          # 全屏 ANSI 动画，按 q 退出
node bin\dsh-spend-wallpaper.mjs render --tier 4 --once   # 指定档位预览一帧
```

也可以用 `npm link` 之后全局调用 `dsh-spend-wallpaper status`。完整说明见 [terminal.md](terminal.md)。

> 注意：终端渲染的是字符画，不是终端模拟器背景；实时数据需要 DSH 正在运行。

---

## 6. 换成自己的壁纸（可选）

- 点右下角 🐋 打开面板 → 「每档场景」→ 对应档位点「上传」，选一张图片或一段视频即可；「清除」回到内置场景。
- 档位数量用「− / +」调（2–8），每个阈值输入框可直接改数值（第一档固定从 0 开始）。
- 上传文件保存在 `$DSH_HOME/storages/spend-wallpaper/scenes/`，删除对应 `custom-<档>.{png,jpg,webp,webm,mp4}` 也能回到内置。
- 也支持脚本：`POST /plugins/dsh-spend-wallpaper/scenes/<档位>`（raw body + Content-Type）。

详细说明见 [scenes.md](scenes.md)。

---

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| 装完没有壁纸 | 插件是否已启用（插件页）；`Ctrl+R` 刷新；重启 DSH；确认用的是 Web GUI，不是终端界面 |
| 一直是第 0 档、不随消耗变化 | 看 `state.json`：`samples` 是否增长、`source` 是哪个；账号钱包为 0 或订阅制时 `auto` 会用 `cost-meter`（需先安装它）。都没有就配 `DEEPSEEK_API_KEY` |
| 想用钱包而不是本地估算 | 配置 `source: account`；钱包余额必须大于 0，否则无法用差分 |
| 变化太慢 | 默认 3 分钟采样 + 10 分钟驻留；临时联调可把 `sampleSeconds`/`minDwellSeconds` 调小（最小 60） |
| 画面太亮/看不清字 | 调大 `scrim`、`dim`，或把 `surfaceOpacity` 调大（默认 0.50），或加一点 `blur` |
| 动态视频不动 | 系统开了「减少动态效果」时按设计降级为静态；可把 `media` 改成 `dynamic` 验证，或换 `static` |
| 想彻底移除 | 插件页找到 `dsh-spend-wallpaper` → **卸载**，然后重启 DSH |

---

## 8. 开发者快速检查（可选）

端口以 DSH 实际打开的 URL 为准（例如 `http://127.0.0.1:65239`）：

```sh
curl http://127.0.0.1:65239/plugins/dsh-spend-wallpaper/state
curl http://127.0.0.1:65239/plugins/dsh-spend-wallpaper/state
curl -X POST http://127.0.0.1:65239/plugins/dsh-spend-wallpaper/refresh
```

`/state` 里的 `spend1h`、`tier`、`diagnostics.lastError` 能直接看出数据源和档位状态。
