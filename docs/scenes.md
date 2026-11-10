# 场景与上传

0.10 起不再有「素材包 / manifest」概念。每个档位（阈值区间）直接对应一个场景：

- 内置场景：`lib/assets/scenes/` 下的 5 张 WebP + 5 段 WebM，启动时复制到
  `$DSH_HOME/storages/spend-wallpaper/scenes/builtin-<n>.webp|webm`。
- 自定义场景：面板里每档点「上传」，静态图片或动态视频都可以；保存为
  `custom-<n>.<ext>`，同时生效并持久化。
- 名称：每档名称可在面板里直接改；留空回落到内置/自定义默认名，保存为 `sceneNames` 覆盖。
- 清除：面板「清除」或 `POST /plugins/dsh-spend-wallpaper/scenes/<n>/reset`。
- 档位数量：2–8，由 `thresholds` 数组长度决定。
- 阈值：面板里的数字输入框或 `POST /config { "thresholds": [...] }`；
  第一项固定 0，必须严格递增。

## 支持格式

| 类型 | 扩展名 / Content-Type |
|---|---|
| 图片 | png / jpg / jpeg / webp / gif / avif |
| 视频 | webm / mp4 / mov / m4v |

上传接口使用原始 body + `Content-Type`：

```sh
curl -X POST http://127.0.0.1:50125/plugins/dsh-spend-wallpaper/scenes/2 ^
  -H "content-type: image/png" --data-binary @my-scene.png
```

动态场景下，如果某档只有静态图，会自动用静态图代替；如果上传的是视频，
静音/自动播放由浏览器策略决定，视频加载失败会回退到内置/海报。

## 场景 URL

`/state` 的 `scenes[]` 直接给出每档的 `imageUrl` / `videoUrl`，并带
`?v=<mtime>` 做缓存失效；`/scenes/<n>?kind=image|video` 返回当前档的文件。
