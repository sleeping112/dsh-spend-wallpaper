# 素材包作者指南

一个素材包就是 `manifest.json` 加若干媒体文件。插件会在两处扫描：

| 位置 | 用途 |
|---|---|
| `lib/assets/packs/<id>/` | 插件内置包（随包分发） |
| `$DSH_HOME/spend-wallpaper/packs/<id>/` | 用户包；**同名会覆盖内置包** |

`<id>` 只能包含字母、数字、`-`、`_`，且 `manifest.json` 里的 `id` 必须与目录名一致。

## manifest.json

```jsonc
{
  "schema": 1,
  "id": "my-pack",
  "name": { "zh": "我的素材", "en": "My Pack" },
  "description": { "zh": "…", "en": "…" },
  "author": "you",
  "license": "CC0-1.0",
  "direction": "poor",          // poor | rich
  "tiers": [
    {
      "id": "calm",
      "min": "0",
      "label": { "zh": "无波", "en": "Calm" },
      "static": "0-calm.webp",
      "dynamic": { "type": "video", "src": "0-calm.webm", "poster": "0-calm.webp" }
    }
  ]
}
```

字段说明：

- `tiers`：按消耗从低到高排列。`static` 必填，`dynamic` 可选；运行期由
  `media` 配置与 `prefers-reduced-motion` 决定用哪一个。
- `direction`：素材包自身的语义。`poor` 表示"消耗越高画面越糟"，
  `rich` 相反；插件配置的 `direction` 与它不一致时，会反转档位到素材的映射。
- `dynamic.type`：`video`（mp4/webm）或 `image`（动图）。
- 缺素材的档位会向前回退；`manifest.json` 校验失败只会跳过该包，不会影响插件。

## 媒体约束

| 类型 | 允许后缀 | 建议 |
|---|---|---|
| 静态 | `.webp` `.jpg` `.png` `.avif` `.gif` `.apng` | 2560×1440，200–500 KB |
| 动态 | `.webm`（VP9）`.mp4`（H.264） | ≤ 1080p、≤ 30s、≤ 12 MB |

- 单个文件上限 16 MiB；动态壁纸建议 6–15 秒无缝循环。
- **不接受 SVG**：SVG 可携带脚本，用户素材包只允许位图/视频。
- 文件名必须是纯文件名（不能带 `/`、`\`、`..`），服务端会再做一次路径限制。
- 素材通过 `/plugins/dsh-spend-wallpaper/assets/<pack>/<file>` 提供，带 ETag 与
  `max-age=3600`；修改文件后 URL 的 `?v=` 会随 mtime 变化，客户端自动换新。

## 校验与测试

```sh
node scripts/pack-check.mjs E:/path/to/my-pack
node scripts/pack-check.mjs --json E:/path/to/my-pack
```

`pack-check` 会校验 manifest、每个被引用文件是否存在、扩展名白名单、文件大小与
基本魔数（WebP/EBML），并输出错误清单；CI 也用它检查内置包。

把素材放进 `$DSH_HOME/spend-wallpaper/packs/my-pack/` 后，在配置中选择
`pack: my-pack` 即可；无需重启（插件每 60 秒重新扫描一次素材包目录）。

## 生成内置素材

内置包由脚本程序化生成，不以第三方素材为基础：

```sh
python scripts/gen-assets.py                 # 静态 WebP + 动态 WebM（需要 ffmpeg）
python scripts/gen-assets.py --skip-video    # 只生成静态图
```

调色板、波形、鲸鱼与闪电参数都在脚本顶部的 `PALETTES` 与 `render()` 中，可直接改。
