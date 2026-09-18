# 织雾满穗（ZhiMist）

一个纯静态的 Roblox 音乐 ID 宝库站点 + Cloudflare Pages Functions 后端（D1 数据库）。
静态页面由浏览器直接打开，所有动态能力（歌曲增删、隔离区、反馈、鸣谢、热门统计、访问渠道统计、后台登录）
都由 `functions/api/` 下的函数提供。

> 技术栈：原生 HTML / CSS / JS + Cloudflare Pages Functions（Workers 运行时）+ Cloudflare D1（SQLite）。
> 无构建步骤、无 npm 依赖；`functions/` 里的代码只使用 Web 标准 API（`fetch`、`crypto.subtle`、`Response`）。

> 🌐 线上地址：**https://zhiwumansui.pages.dev**
> 🔑 后台入口：首页 **「织雾满穗」标题 2 秒内连点 3 次** → 输密码

---

## 零、懒得看文档？三句话讲完

1. **代码推到 GitHub**（GitHub 只负责存代码）。
2. **Cloudflare 后台 → Workers & Pages → 连接这个 GitHub 仓库**，构建命令留空、输出目录填 `.`。
3. **建一个 D1 数据库**（绑定名必须叫 `DB`），跑一次 `schema.sql` 建表，
   再在 Settings 里加两个 Secret：`AUTH_HASH`（管理员密码的哈希）和 `AUTH_TOKEN`（一长串随机字符）。
   改完**重新部署一次**。

做完这三步，网站就能用了。详细的每一步（包括怎么算出 `AUTH_HASH`、`AUTH_TOKEN`）看下面第三节。

---

## 一、目录结构

```
.
├── index.html                 主页（只放一张卡片，其余入口在导航栏）
├── feedback.html              反馈提交页
├── roblox_music.html          Roblox ID 宝库页（搜索 / 随机 / 复制 / 收藏 / 隔离区）
├── admin.html                 后台管理页（需登录，4 个标签：反馈 / 更新 / 卡片 / 数据统计）
├── 404.html                   找不到页面时显示的页面（Cloudflare Pages 会自动使用它）
├── css/                       样式
│   ├── style.css              全站共用样式（颜色、按钮、弹窗、主题、精简模式）
│   └── update-modal.css       版本更新弹窗专用（只在要弹公告时才加载）
├── js/
│   ├── auth.js                登录弹窗、登录态检查、后台入口（连点标题 3 次）
│   ├── admin.js               后台各模块逻辑（反馈 / 鸣谢 / 隔离区 / 歌曲 / 导出）
│   └── ...                    其它页面脚本
├── data/
│   └── roblox_music.json      站点内置的歌曲数据（静态、只读）
├── tools/
│   ├── update-notice.html     更新公告配置工具（**仅后台可用**，内部 iframe）
│   └── json-merge.html        JSON 合并工具（**仅后台可用**，内部 iframe）
├── images/                    图片资源
├── functions/
│   └── api/                   Cloudflare Pages Functions（后端 API）
│       ├── _utils.js          共享工具：响应封装、Cookie、会话签名、限速、同源校验
│       ├── auth/              login.js（登录）/ check.js（登录态）/ logout.js（退出）
│       ├── songs/             list.js / add.js / delete.js / clear.js / export.js
│       ├── quarantine/        list.js / import.js / delete.js
│       ├── feedback.js        公开提交反馈
│       ├── feedback/          list.js / delete.js / status.js / import-quarantine.js
│       ├── hot/               list.js（公开榜单）/ report.js（上报）
│       ├── visit/             stats.js（渠道统计）/ report.js（上报）
│       ├── thanks.js          鸣谢名单（GET 公开，POST 需登录）
│       ├── updates.js         版本公告（GET 公开，写需登录）
│       └── risk.js            风险弹窗版本
├── schema.sql                 D1 建表语句（部署前执行一次）
├── _headers                   Cloudflare Pages 静态资源响应头（安全头）
├── wrangler.toml              Pages 项目 / D1 绑定（DB）/ 密钥说明
├── .gitignore                 忽略 .dev.vars（本地密钥）等
└── README.md                  本文件
```

---

## 二、本地预览

需要 Node.js（仅用于运行 wrangler 开发服务器，站点本身不需要 Node）。

```bash
# 首次：安装 wrangler（不必写进 package.json）
npm install -g wrangler
# 或者直接用 npx（每次临时下载）
npx wrangler --version
```

**1）准备本地密钥**：在仓库根目录新建 `.dev.vars`（已被 `.gitignore` 忽略）：

```
AUTH_HASH="把这里换成你的 sha512 小写十六进制"
AUTH_TOKEN="把这里换成长随机串"
```

**2）启动本地服务器**（必须在仓库根目录执行，`functions/` 才会被识别）：

```bash
npx wrangler pages dev . --d1 DB=<数据库名或本地 id>
```

**3）本地数据库**：本地预览使用 `.wrangler/state` 下的本地 D1，首次执行一次建表：

```bash
npx wrangler d1 execute <数据库名> --local --file=./schema.sql
```

**4）打开** wrangler 输出的地址（通常是 <http://localhost:8788>）。

> ⚠️ 登录 Cookie 带 `Secure` 属性，部分浏览器在纯 `http://localhost` 下不会保存它，
> 导致「登录成功但仍是未登录」。要测后台功能，建议直接部署到 Cloudflare Pages
> （自带 https）用预览域名测试，而不是依赖本地 http。

不想起本地服务时，也可以直接双击 `index.html` 打开：此时没有任何 API，
页面会自动降级为「只读本地数据」模式（见下文 GitHub Pages 一节），
能看数据、能搜索复制，但反馈 / 统计 / 后台都不可用。

---

## 三、Cloudflare Pages 部署（推荐）

### 1. 创建 D1 数据库

```bash
npx wrangler d1 create zhimist-db
```

命令会输出 `database_id`，把它填进 `wrangler.toml` 的
`[[d1_databases]] database_id`（文件里目前是占位符 `REPLACE_WITH_YOUR_D1_DATABASE_ID`）。

**绑定名必须是 `DB`**：`functions/` 下的代码统一通过 `env.DB` 访问数据库，改名会让所有接口 500。

### 2. 执行 schema.sql 建表

二选一：

```bash
# 方式 A：命令行（在仓库根目录，--remote 表示操作线上库）
npx wrangler d1 execute zhimist-db --remote --file=./schema.sql
```

```
# 方式 B：控制台
Workers & Pages → D1 → 选择数据库 → Console → 粘贴 schema.sql 的全部内容 → Execute
```

`schema.sql` 会创建：`feedback`、`quarantine_admin`、`songs_extra`、`thanks`、
`page_updates`、`hot_songs`、`visit_sources` 以及 3 个索引，语句都是
`CREATE TABLE IF NOT EXISTS`，重复执行安全。

### 3. 生成 AUTH_HASH（管理员密码的哈希）

`AUTH_HASH` = 管理员密码的 **SHA-512，小写十六进制**（128 个字符），只存哈希、不存明文：

```bash
# Node.js
node -e "console.log(require('crypto').createHash('sha512').update('你的管理员密码').digest('hex'))"

# 或者 OpenSSL
printf '%s' '你的管理员密码' | openssl sha512
```

把输出**原样**（小写十六进制）填到 `AUTH_HASH`。登录时后端对输入的密码做同样的
SHA-512 再做**定长比较**，所以大小写不一致会直接登录失败。

### 4. 生成 AUTH_TOKEN（会话签名密钥）

`AUTH_TOKEN` 用来给登录会话签名（`HMAC-SHA256(exp, AUTH_TOKEN)`），必须是长随机串，
不要用有意义的单词、不要复用密码：

```bash
# Node.js：48 字节随机 → 96 位十六进制
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 或者 OpenSSL
openssl rand -hex 48
```

轮换 `AUTH_TOKEN` 会让所有已登录会话立刻失效（所有管理员需要重新登录），这是预期行为。

### 5. 在 Pages 项目里配置变量与绑定

Cloudflare 控制台 → Workers & Pages → 你的 Pages 项目：

| 位置 | 需要配置 |
| --- | --- |
| Settings → Variables and Secrets | `AUTH_HASH`（类型 **Secret**）、`AUTH_TOKEN`（类型 **Secret**） |
| Settings → Functions → D1 database bindings | 变量名 **`DB`** → 选择第 1 步创建的数据库 |
| Settings → Builds & deployments | 构建命令留空、输出目录填 `.`（纯静态，无构建步骤） |

保存后**重新部署**一次，让绑定生效。

> 部署自检：`DB` / `AUTH_HASH` / `AUTH_TOKEN` 三个任意缺一个，
> 登录接口会明确返回 `{"ok":false,"error":"server misconfigured"}`（HTTP 500），
> 并在函数日志里打印缺少了哪一项——不会再出现「明明没配密钥却提示登录成功」的情况。

### 6. 部署

```bash
# 方式 A：Git 集成（推荐，也是本项目的用法）
#   代码放在 GitHub → Cloudflare 后台 Pages → Connect to Git → 以后每次 push 自动部署

# 方式 B：命令行直接上传（不走 GitHub）
npx wrangler pages deploy .
```

> 代码放在 GitHub、部署在 Cloudflare，这个组合是完全正确的：
> GitHub 只负责「存代码 + 版本记录」，真正对外提供服务、跑后端接口的是 Cloudflare。

### 7. 部署后自检清单

- `GET /api/songs/list` → `{"ok":true,"data":[...]}`
- `GET /api/thanks` → 顶层是**数组**（`[{"category":...,"people":[...]}]`）
- 后台入口：在主页**连点标题 3 次** → 输入管理员密码 → 进入 `admin.html`
- 登录成功后浏览器里应有一个 `zm_auth=<过期时间>.<签名>` 的 Cookie（HttpOnly / Secure / SameSite=Strict，有效期 7 天）

---

## 四、GitHub 和 Cloudflare 分别负责什么？

很多新手会把这两个搞混，这里说清楚：

| | GitHub | Cloudflare Pages |
| --- | --- | --- |
| 干什么 | 存代码、记录每次改动、方便回滚 | 真正把网站跑起来，给访客访问 |
| 能不能跑后端 | **不能** | **能**（`functions/` 就是给它的） |
| 能不能连数据库 | 不能 | 能（D1） |

所以本项目的正确用法是：**代码推到 GitHub，Cloudflare 从 GitHub 拉取并部署**。
改完代码 push 上去，Cloudflare 会自动重新部署，不需要手动上传。

### 如果哪天顺手开了 GitHub Pages 会怎样？

GitHub Pages 只能托管静态文件（HTML / CSS / JS / JSON / 图片），它**不认识 `functions/`**，所以：

- `/api/...` 全部返回 404；
- 站点会自动降级成**「只读本地数据」模式**：直接读内置的 `data/roblox_music.json`，
  搜索、分类筛选、复制 ID、随机挑一首、收藏、深色模式都还能用；
- 用不了的只有：提交反馈、隔离区上传、热门榜、来源统计、鸣谢动态加载、后台全部管理功能。

想让它在那儿也正常显示，只要在仓库根目录放一个**空文件**叫 `.nojekyll` 就行
（GitHub Pages 默认会用一个叫 Jekyll 的工具处理文件，空文件就是告诉它「别管」）。
本项目没有放这个文件，因为我们不走 GitHub Pages；真要用的时候再加也不迟。

---

## 五、安全说明

- **管理员密码**：浏览器只发送明文密码一次（HTTPS 保护），后端立刻做 SHA-512 并做定长比较，
  数据库和仓库里只存在 `AUTH_HASH`（哈希），不存明文。请用足够长的密码。
- **会话**：登录成功后签发 `zm_auth=<exp>.<HMAC-SHA256(exp, AUTH_TOKEN)>`，
  服务端校验「签名正确 + 未过期」；Cookie 为 `HttpOnly`（JS 读不到，防 XSS 窃取）、
  `Secure`（只在 HTTPS 传输）、`SameSite=Strict`（防跨站携带）、`Path=/`，有效期 7 天。
  退出登录会下发同属性的过期 Cookie。
- **限速**：登录、登录态检查、公开反馈提交、热门上报、访问渠道上报都按
  `CF-Connecting-IP` 做了内存限速（登录 10 分钟 5 次；反馈 10 分钟 5 条；
  渠道上报 10 分钟 20 次；热门上报 10 分钟 60 次）。
  这是「单实例内存限速」，只用于挡住脚本暴力尝试，不是分布式全局限流。
- **同源校验（CSRF）**：所有写接口（POST）都会校验 `Origin`：缺失或与请求主机一致才放行，
  跨站表单 / 跨站 fetch 会被 403 拒绝。
- **响应头**：`functions/` 返回的 JSON 统一带 `Cache-Control: no-store` 与
  `X-Content-Type-Options: nosniff`；静态文件的响应头由根目录 `_headers` 配置
  （全站 `nosniff` + `Referrer-Policy: strict-origin-when-cross-origin`，
  `/admin.html` 额外加 `X-Frame-Options: DENY` 与 `frame-ancestors 'none'`，防止后台被 iframe 嵌套点击劫持）。
- **错误信息**：接口出错时只返回通用文案（如 `server error`），详细错误通过
  `console.error` 打到 Cloudflare 函数日志，避免把数据库结构、SQL 等信息泄露给访客。
- **密钥管理**：`AUTH_HASH` / `AUTH_TOKEN` 一律用 Cloudflare 的加密变量（Secret）配置；
  本地放 `.dev.vars`（已在 `.gitignore` 中忽略）；**永远不要**提交到 Git、不要写进
  `wrangler.toml`、也不要贴到前端代码里。
- **数据边界**：`data/roblox_music.json` 是公开静态文件，任何人都能看到里面的 ID；
  后台的「隔离区」只影响本站展示与合并结果，不等于从游戏里删除任何东西。
- **D1 数据**：没有导出/备份接口给访客；建议定期在 Cloudflare 控制台用 D1 的
  Export 功能备份数据库，或执行 `npx wrangler d1 export zhimist-db --remote --output backup.sql`。
- **后台专用工具**：`tools/` 下的两个工具页自己带登录校验，未登录直接打开只会看到一句提示，
  拿不到工具界面（后台的 iframe 里也一样）。这是第二道锁，第一道是后台页本身。

---

## 六、想改点什么？先看这张表

不用懂代码也能大致找到地方，改完推到 GitHub，Cloudflare 会自动重新部署。

| 想改的东西 | 去哪儿改 | 怎么改 |
| --- | --- | --- |
| **预览版弹窗的文案** | `js/common.js` | 搜 `PREVIEW_NOTICE_VERSION` 上面那段 `modal.innerHTML` |
| **让预览版弹窗重新弹一次**（比如改了文案想让大家再看一遍） | `js/common.js` | 把 `PREVIEW_NOTICE_VERSION = '1'` 改成 `'2'`。数字一变，所有访客下次打开都会再看到一次 |
| **不想让某个页面弹预览版弹窗** | 对应页面的第一行 | 在 `<html>` 标签里加 `data-notice="off"`（后台页已经这么设了） |
| **首页的卡片** | `index.html` | 搜 `<div class="content-grid"`，卡片就写在里面，复制一整段 `<a class="card">…</a>` 就是新增一张 |
| **导航栏的链接** | 每个页面里的 `<nav class="navbar">` | 目前统一是「首页 + 反馈」。加一个 `<li><a href="...">…</a></li>` 就是加一个入口 |
| **主色 / 配色** | `css/style.css` 最上面的 `:root` | `--primary` 是主色，`--gold` 是金色点缀；深色模式在同文件的 `[data-theme="dark"]` |
| **手机上关掉的特效** | `css/style.css` | 搜 `html.lite`；`js/common.js` 里的 `isLiteMode()` 决定什么时候进入精简模式 |
| **宝库里的歌** | 后台「卡片管理」 | 增删都会写进 D1；也可以直接改 `data/roblox_music.json`（改完要重新部署） |
| **更新公告** | 后台「更新管理」 | 填好内容点保存，访客下次打开对应页面就会看到弹窗 |
| **看热门榜 / 访问渠道统计** | 后台「📊 数据统计」 | 数据本来就在 D1 里，这个标签页把它们显示出来；点「🔄 刷新」重新拉一次 |
| **网站标题 / 分享时的描述** | 各 HTML 的 `<head>` | 搜 `<meta name="description"` 和 `<meta property="og:` |

> 小提示：改完如果发现页面没变，先按 `Ctrl + F5` 强制刷新一次，
> 浏览器有时候会把旧的 CSS / JS 缓存住。

---

## 七、性能与多设备适配（这次做了什么）

为了让手机和老电脑也顺滑，项目里做了这些取舍：

### 一、去掉「一直在跑」的开销

- **不用大面积高斯模糊**：背景的极光效果全部改成纯径向渐变，视觉几乎一样，
  但省掉了一层全屏 `filter: blur()` —— 这是手机上最常见卡顿来源。
  连 `404.html`、更新公告工具里那几处也都换掉了。
- **不再让元素「一直重绘」**：
  - 首页大标题原来挂着一个无限循环的渐变动画，每帧都要重画整行大字 → 已去掉（悬停时仍有渐变位移）。
  - 宝库页「告诉我们你从哪来」按钮原来的"阴影呼吸"每帧都要重算阴影 → 改成用缩放做呼吸（由显卡处理，不重绘）。
  - 404 页的 404 大字原来的背景漂移动画 → 去掉；背景层改成只做位移不做缩放。
- **不再乱用 `will-change`**：这个属性会让元素独占一块显存。
  原来每个按钮、每个歌曲分组都写了，1500 条数据下就是上千块显存。现在只留给少数几个固定元素。

### 二、少下载、少解析

- **更新弹窗的样式抽成独立文件**：`css/update-modal.css`（约 1.6 万字符）
  只在「真的要弹版本公告」时才按需加载。
  平时访问任何页面都不会下载它 —— `js/common.js` 因此从约 6 万字符瘦到约 3.9 万字符。
  （加载时会先等样式到位再弹窗，不会出现"先没样式后跳一下"的闪烁。）
- **后台的工具改成「用到才加载」**：`admin.html` 里两个工具 iframe 原来写死了 `src`，
  一打开后台就把 6 万字符的页面全加载了；现在切到哪个面板才加载哪个。
- **首页的「站点更新」延迟加载**：它本来在首屏下面，现在滚到附近才发那三次请求，
  首屏少三次网络请求。
- **静态资源缓存**：`_headers` 里给 `/css/*`、`/js/*`、`/images/*` 配了
  `max-age=300, stale-while-revalidate=86400` —— 回头客 5 分钟内打开是零请求，
  5 分钟后也会「先用旧版立刻显示，同时后台悄悄取新版」。
  HTML 本身不缓存，保证你改完立刻能看到。

### 三、让浏览器少干活

- **列表用事件委托**：宝库页 1500 条数据不再是「每个按钮一个监听器」，
  整张列表只绑一次，点谁都能响应。
- **长列表延迟渲染**：`content-visibility: auto` 让浏览器跳过屏幕外那些歌曲的绘制。
- **转义函数不再碰 DOM**：`escapeHtml` 原来每调用一次就创建一个隐藏 DOM 节点，
  渲染上千条数据时会被调用上万次；改成纯字符串替换，快一个数量级。
- **中文排序改用共用的 Collator**：原来每次比较都要内部准备一遍中文排序规则，
  1400 多组排序要比较上万次；现在建一个共用的反复使用。
- **写 localStorage 改成合并写入**：原来每点一次复制/试听/收藏就同步写一次磁盘，
  现在合并成 1.5 秒写一次，离开页面时再补写一次（数据不会丢）。

### 四、手机上的专门处理

- **自动进入「精简模式」**：屏幕 ≤768px、系统开了「减少动态效果」、
  或者设备核心数 / 内存偏低、开了省流量模式时，自动关掉颗粒纹理、鼠标光晕、
  入场动画和常驻动画，并把导航栏、吸顶搜索栏、弹窗遮罩的毛玻璃换成纯色
  （毛玻璃每次滚动都要重新计算，很费性能）。`404.html` 也有自己的一份同样判断。
- **手指友好**：移动端按钮、下拉选项、复选框都放到了 40px 以上，符合主流触控建议。
- **刘海屏安全区**：用了 `env(safe-area-inset-*)`，iPhone 上底部按钮不会被横条挡住。

如果哪天想把特效在手机上也要回来，把 `js/common.js` 里 `isLiteMode()` 的判断删掉即可
（`404.html` 头部还有一份同样的判断，一并删掉）。

---

## 八、和《初始文件已经做的内容》对照

项目根目录有一份 `初始文件已经做的内容.txt`（你自己写的项目档案），
下面是把那份档案和现在的代码**逐条核对**的结果。

### ✅ 完全对得上，档案里说有的现在都有

| 档案里写的 | 现状 |
| --- | --- |
| D1 共 7 张表 | `schema.sql` 里 7 张全在，字段一致 |
| 20 个 API 接口 | 实际有 **24 个**（档案少算了 3 个，另外这次新加了 `hot/delete`），全部存在且可用 |
| 三层隔离机制（开发者 / 游客 / 反馈上传） | 完整保留 |
| 宝库页数据合并逻辑（JSON + D1 − 两种隔离区） | 完整保留 |
| 9 个 localStorage 键 | 全在（`pageVersion_*` 是代码里动态拼出来的） |
| escapeHtml 引号转义 | 在，并且又优化成了纯字符串替换（更快） |
| 登录 IP 限速 | 在，并且加到了 `/api/auth/check`（原来那个可以绕过限速） |
| `page_updates` 主键约束 | 在 |
| 后端抽 `_utils.js` 公共模块 | 在，并且扩展了会话签名、限速、同源校验等 |
| `admin.html` 的 `<h2>` 里 `<div>` 换成 `<span>` | 已经是正确写法 |
| 更新弹窗重做（960×340 画布、五段式） | 在，样式已抽到 `css/update-modal.css` 按需加载 |
| 工具页 `data-page="card"` 分组 → 实存 `roblox` | 已处理 |

### 🔧 档案里记着「待处理」，现在已经处理

| 档案里的待办 | 现在的处理 |
| --- | --- |
| `updates.js` 200 字符限制（建议改成 2000） | **已改成 2000**，前端工具页的提示也同步改成 2000 |
| 改了 `common.js` / `style.css` 不生效（建议手动加 `?v=N`） | 不用再手动加版本号了 —— `_headers` 把 CSS/JS 缓存降到 **60 秒**，改完推上去最多 1 分钟生效，按 `Ctrl + F5` 则立刻生效 |

### ➕ 档案里没写、但 D1 里有数据却看不到的 → 这次补上了

**后台新增「📊 数据统计」标签页。**

你之前把数据存进了 D1，接口也写好了，但后台一直没有页面去读它们：

- 🔥 **热门 Top 100**：`/api/hot/list` 早就返回了「复制 / 试听 / 收藏」三个分项，
  现在后台能直接看到排行榜（前三名有金/银/铜徽章）、总互动次数、总热度；
  每行右边有个 **✕ 按钮可以清空这条热度**（比如某个 ID 被人恶意刷了），
  点一下会先弹确认框，确认后才删。
- 📢 **访问渠道来源**：`/api/visit/stats` 早就统计了每个渠道多少人，
  现在后台能看到排行 + 占比进度条。

**只用了一张已有的表**（`hot_songs` / `visit_sources`），不需要新建表。
唯一新增的后端文件是 `functions/api/hot/delete.js`（清空热度用），
它同样带登录校验和同源校验，不需要改数据库结构。

### ⚠️ 需要你确认的一件事：歌曲数量对不上

| | 数量 |
| --- | --- |
| 档案里写的 | 「收录 **2000+** 音乐 ID」 |
| `data/roblox_music.json` 实际 | **1515 条**（1473 个不同曲目、5 个分类） |

差了大约 **500 条**。可能是当初导出时只导出了一部分，或者中间丢过一段。
我没办法凭空把那 500 条变回来 —— **如果你手上还有更完整的原始文件，给我，我帮你合并进去**；
首页卡片现在写的是「1500+」，等数据补齐了我再改成对应数字。

（分类目前是：中文流行 / 英文热门 / Phonk-DJ / 搞笑音效 / 古风国风）

