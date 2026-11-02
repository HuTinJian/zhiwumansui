# 织雾满穗 · 品牌标志素材（2026-11-03）

这里存放站点的品牌标志源文件。**已接入 favicon 与全站页脚横版**；其余文件作为设计资产保存。

## 文件

| 文件 | 用途 |
| --- | --- |
| `favicon.svg` | 简化方印，16–64px 用；已同时替换 `images/favicon.svg`（浏览器图标 + 导航栏左侧小标） |
| `logo-mark.svg` | 完整主标（含外框金线、雾线、织纹），用于大尺寸、印刷、海报 |
| `logo-lockup-light.svg` / `logo-lockup-dark.svg` | 页脚主展示：760×170 富信息横版（方印 + 织雾满穗 + ZHIMIST + 站内说明 + 为人民服务印章 + 网址/年份） |
| `logo-lockup-compact-light.svg` / `logo-lockup-compact-dark.svg` | ≤640px 手机页脚用：360×96 紧凑版 |
| `motto-seal.svg` | 「为人民服务」小印，用于页脚、海报角落，不塞进主标 |
| `logo-mono.svg` | 单色墨线版，用于刻字、单色印刷、传真等 |
| `qq-group-avatar.svg` / `.png` | QQ 群头像（512×512，无字版；聊天列表小尺寸也认得出，群名由 QQ 自己显示） |
| `qq-group-avatar-text.svg` / `.png` | 带「织雾满穗 / ZHIMIST」的 512 头像，适合海报、大图、群公告 |
| `brand-board.html` | 完整品牌板（自包含，浏览器直接打开）：概念、横版、尺寸、构造、颜色、应用、规则 |

## 颜色

宣纸 `#F5F0E6` ｜ 墨 `#221C16` ｜ 朱砂 `#A62E22` ｜ 金 `#B08A3E` ｜ 竹青 `#4F7A5A`

## 含义

朱砂方印里一穗低头：穗越饱满，头垂得越低——把收成留给人民。金线从穗下穿过，像雾，也像把人和歌连起来的路。外圈细金线是装裱线，把方印收住。

## 使用规则

- 完整标志四周留白 ≥ 金线宽度 × 4；
- 带金线的完整标志不小于 24px，16px 用 `favicon.svg`；
- 页脚：桌面用富信息横版，≤640px 自动换紧凑版；
- 不旋转、不拉伸、不换色、不加霓虹/阴影；
- QQ 群头像优先用无字版 PNG，QQ 会做圆形裁切，内容都在安全区内。

## 回退办法

- 只想恢复旧 favicon：`cp .verify/logo-drafts/old-favicon.svg images/favicon.svg`
- 想撤掉本目录：`rm -rf images/brand`，并把 `images/favicon.svg` 恢复为旧文件。
- 页脚横版：删掉各页 `<footer>` 里的 `.footer-brand` 块 + `css/style.css` 里的 `.footer-brand` 规则即可。
- 旧页脚小条：删掉 `css/style.css` 里 `.footer::after { display:none !important; }` 这一条即可恢复。
