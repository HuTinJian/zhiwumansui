# 织雾满穗 · 品牌标志素材（2026-11-03）

这里存放站点的品牌标志源文件。**站点目前只接入了 favicon**，其它文件先作为设计资产保存，未改页面结构。

## 文件

| 文件 | 用途 |
| --- | --- |
| `favicon.svg` | 简化方印，16–64px 用；已同时替换 `images/favicon.svg`（浏览器图标 + 导航栏左侧小标） |
| `logo-mark.svg` | 完整主标（含外框金线、雾线、织纹），用于大尺寸、印刷、海报 |
| `logo-lockup-light.svg` | 浅色横版字标（方印 + 织雾满穗 + ZHIMIST + 用知识照亮世界） |
| `logo-lockup-dark.svg` | 深色横版字标 |
| `motto-seal.svg` | 「为人民服务」小印，用于页脚、海报角落，不塞进主标 |
| `logo-mono.svg` | 单色墨线版，用于刻字、单色印刷、传真等 |
| `brand-board.html` | 完整品牌板（自包含，浏览器直接打开）：概念、横版、尺寸、构造、颜色、应用、规则 |

## 颜色

宣纸 `#F5F0E6` ｜ 墨 `#221C16` ｜ 朱砂 `#A62E22` ｜ 金 `#B08A3E` ｜ 竹青 `#4F7A5A`

## 含义

朱砂方印里一穗低头：穗越饱满，头垂得越低——把收成留给人民。金线从穗下穿过，像雾，也像把人和歌连起来的路。外圈细金线是装裱线，把方印收住。

## 使用规则

- 完整标志四周留白 ≥ 金线宽度 × 4；
- 带金线的完整标志不小于 24px，16px 用 `favicon.svg`；
- 不旋转、不拉伸、不换色、不加霓虹/阴影。

## 回退办法

- 只想恢复旧 favicon：`cp .verify/logo-drafts/old-favicon.svg images/favicon.svg`
- 想撤掉本目录：`rm -rf images/brand`，并把 `images/favicon.svg` 恢复为旧文件。
- 本次接入只改了 `images/favicon.svg` 并新增本目录，没有改任何 HTML/CSS/JS。
