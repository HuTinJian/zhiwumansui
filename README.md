# 织雾满穗（ZhiMist）

一个纯静态的 Roblox 音乐 ID 宝库站点 + Cloudflare Pages Functions 后端（D1 数据库）。
静态页面由浏览器直接打开，所有动态能力（歌曲增删、无效音乐ID上报与下架、鸣谢、热门统计、
访问渠道统计、后台登录）都由 `functions/api/` 下的函数提供。

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
├── index.html                 主页（卡片入口 + 站点介绍）
├── roblox_music.html          卡片1 · Roblox ID 宝库（搜索 / 分页 / 随机 / 复制 / 收藏 / 无效处理上报）
├── thanks.html                ❤️ 鸣谢名单（页内三个切换：👑 赞助者 / 🎮 Roblox ID 宝库 / 🙏 玩家感谢）
├── admin.html                 后台管理页（需登录，标签栏 3 个标签：卡片 / 鸣谢 / 数据统计）
├── 404.html                   找不到页面时显示的页面（Cloudflare Pages 会自动使用它）
├── css/                       样式
│   ├── style.css              全站共用样式（颜色、按钮、弹窗、主题、精简模式）
│   └── update-modal.css       版本更新弹窗专用（只在要弹公告时才加载）
├── js/
│   ├── auth.js                登录弹窗、登录态检查、后台入口（连点标题 3 次）
│   ├── admin.js               后台各模块逻辑（无效音乐ID管理 / 鸣谢（含赞助者） / 歌曲）
│   ├── common.js              全站共用：弹窗、提示、主题、浏览器身份、更新公告
│   ├── turnstile.js           Cloudflare Turnstile 一次性通行证（没填 Site Key 就完全静默）
│   └── ...                    其它页面脚本
├── data/
│   ├── roblox_music.json      站点内置的歌曲数据（静态、只读）
│   ├── sponsors.json          👑 赞助者底档（静态、只读；后台加的那些存在 D1 里）
│   ├── thanks.json            🎮 Roblox ID 宝库（鸣谢名单）的本地档案（静态、只读；结构同 GET /api/thanks）
│   ├── updates.json           站点更新公告（由 AI 直接写这个文件，页面读它）
│   └── admin_quarantine.json  已下架（原开发者隔离区）的静态快照（由后台「🚫 无效音乐ID管理 → 📤 导出」得到）
├── tools/
│   ├── rollback.bat           版本回退小工具（本地双击运行，和网站本身无关）
│   └── rollback.ps1           上面那个小工具的实现
├── images/                    图片资源
├── functions/
│   └── api/                   Cloudflare Pages Functions（后端 API）
│       ├── _middleware.js     /api/* 专用：突发限速 + 请求体上限 + 安全响应头（2026-10-05 新增）
│       ├── _utils.js          共享工具：响应封装、Cookie、会话签名、限速、同源校验、Turnstile 校验
│       ├── auth/              login.js（登录）/ check.js（登录态）/ logout.js（退出）
│       ├── songs/             list.js / add.js / delete.js / clear.js / export.js
│       ├── quarantine/        list.js / import.js / delete.js（已下架名单，界面上叫「已下架」）
│       ├── invalid/           report.js（访客上报）/ withdraw.js（撤销自己的上报）/ list.js（后台看）/ handle.js（下架·忽略·恢复）
│       ├── hot/               list.js（公开榜单）/ report.js（上报）
│       ├── visit/             stats.js（渠道统计）/ report.js（上报）
│       ├── thanks.js          鸣谢名单（GET 公开，POST 需登录）
│       ├── updates.js         版本公告（GET 公开，写需登录；**页面已改读 data/updates.json，这里只当备胎**）
│       └── risk.js            风险弹窗版本
├── schema.sql                 D1 建表语句（**全新部署**跑这个）
├── migrations.sql             D1 增量迁移（**老库补字段**跑这个，见第五节）
├── d1-drop-blog.sql           老库清理用：删掉早期遗留的五张表（全新部署不需要）
├── _headers                   Cloudflare Pages 静态资源响应头（安全头 + 缓存策略）
├── robots.txt                 「请勿抓取」声明（挡规矩的 AI 采集爬虫，2026-10-05 新增）
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
能看数据、能搜索复制，但无效上报 / 统计 / 后台都不可用。

---

## 三、Cloudflare Pages 部署（推荐）

### 1. 创建 D1 数据库

```bash
npx wrangler d1 create zhimist-db
```

**绑定名必须是 `DB`**：`functions/` 下的代码统一通过 `env.DB` 访问数据库，改名会让所有接口 500。

数据库建好之后，**在 Cloudflare 后台把这个数据库绑到 Pages 项目上**：

```
Workers & Pages → 你的 Pages 项目 → Settings → Functions
  → D1 database bindings → 变量名填 DB → 选择你的数据库 → 保存
```

> ⚠️ **本项目故意不放 `wrangler.toml`，请不要自己新建一个。**
>
> Cloudflare 有个新功能会自动读取仓库里的 `wrangler.toml`。一旦这个文件存在，
> 它就会**改用文件里的 D1 绑定**，而不是后台设置里的那一个。
> 如果文件里的 `database_id` 是占位符或者填错了，部署会直接失败并报：
>
> ```
> Error 8000022: Invalid database UUID (...)
> ```
>
> 所以绑定只在后台配一次就够了，别写进文件里。

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

`schema.sql` 会创建：`invalid_reports`、`quarantine_admin`、`songs_extra`、`thanks`、
`page_updates`、`hot_songs`、`visit_sources`、`feedback`（已下线，仅留档）以及若干索引，
语句都是 `CREATE TABLE IF NOT EXISTS`，重复执行安全。

> 2026-10-05：`invalid_reports` 是这轮新增的「无效音乐 ID 上报」表；`quarantine_admin`
> 继续当「已下架名单」用（界面文案叫「已下架」，表名没改）。`feedback` 表**不再写入**，
> 只是老数据留档，不删。

### 2.5 老库要补跑一次 migrations.sql ⚠️

**如果你的数据库是之前建的**，光重跑 `schema.sql` 是不够的 ——
`CREATE TABLE IF NOT EXISTS` 见到表已存在就直接跳过，**不会给已有的表补新字段**。

所以老库要再跑一次 `migrations.sql`（里面每一段都可以重复执行）。

> **⚠️ 这里最容易踩的坑**：Cloudflare 网页上的 D1 Console 是一个 **SQL 查询框**，
> 只认 SQL 语句。**千万不要把 `npx wrangler ...` 那种命令行粘进去** ——
> 那样只会得到一句 `near "npx": syntax error`。

**方式 A：网页版（推荐，什么都不用装）**

```
Cloudflare 面板 → Workers & Pages → D1 → 选中你的库 → Console
```

然后把 `migrations.sql` 里的内容粘进去执行：

1. **第 1 组**：3 条 `ALTER TABLE feedback ADD COLUMN ...`（历史遗留，跑过就跳过）——
   某条报 `duplicate column name: xxx` 是正常的，跳过它继续下一条；
   最后那条 `CREATE INDEX`（`idx_feedback_client`）可以单独执行。
2. **第 2 组**（2026-10-05 新增，本轮必须跑）：`invalid_reports` 建表 + 两个索引
   （`idx_invalid_unique` / `idx_invalid_status`），整段可以重复执行。
   不跑这一段的话，前台点「🚫 无效处理」会 500（接口找不到表）。

> 老库里那五张表按 **`d1-drop-blog.sql`** 里的语句 DROP 掉即可。

**方式 B：命令行版（要装 Node.js，而且要在你自己电脑的终端里跑）**

```bash
# 注意：这是在【你自己电脑的终端】里执行，不是在 Cloudflare 网页里
npx wrangler d1 execute zhimist-db --remote --file=./migrations.sql
```

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

### 改坏了怎么退回去？

两条路，建议都记住：一条救急，一条治本。

**① 救急（最快，几秒钟）：Cloudflare 面板一键回滚**

Cloudflare 会保存**每一次**部署，所以线上出问题时：

> Cloudflare 面板 → **Workers & Pages** → 选中本项目 → **Deployments** →
> 在 **All deployments** 列表里找到上一个正常的版本 → 点它右侧的三个点 →
> **Rollback to this deployment** → 确认。

线上立刻就切回那个版本，不用等重新构建，也不用碰代码。
（注意：只有**生产部署**能作为回滚目标，预览部署不行。）

**② 治本（让仓库里的代码也退回去）：双击 `tools/rollback.bat`**

面板回滚只是把线上切回旧版，仓库里的代码还是坏的 —— 下次一 push，
坏版本又会被部署上去。所以彻底修复要走 Git，直接**双击 `tools/rollback.bat`**，
按菜单提示操作：

| 菜单 | 什么时候用 |
| --- | --- |
| 【1】查看历史 | 看看最近都改了什么、有哪些安全点 |
| 【2】撤销最近一次提交 | **最常见**：刚推的那版坏了，一键退回去 |
| 【3】撤销指定的某一次提交 | 坏的只是中间某一次改动 |
| 【4】整体回到某个安全点 | 想整体退回到某个已知良好的状态 |
| 【5】打一个安全点 | **大改动之前先打一个**，以后随时能回来 |
| 【6】把本地改动提交并推送 | 以后直接用 Git 管理，不必再走网页上传 |
| 【7】从 GitHub 拉取最新 | 换电脑或在网页上改过之后，先把最新代码同步下来 |

它背后用的是 `git revert`：**生成一个「反向提交」，把那次改动原样撤销掉**，
然后推送到 GitHub，Cloudflare 自动重新部署回正常版本。
`git revert` **不会改写历史**，所以它永远安全、不会丢东西 ——
这也是它比 `git reset --hard` 更适合新手的原因。

> 第一次推送时可能会弹出 GitHub 登录窗口，登录一次之后就不用再登了。
> 想更省事的话，也可以装 **GitHub Desktop**，用图形界面做同样的事。

> ⚠️ 这台电脑上 git 走的是 SteamTools / Watt Toolkit 的加速通道，
> 它的根证书已经合并进 `%LOCALAPPDATA%\git-ca-bundle.crt`，
> 并写在**本仓库**的 `http.sslCAInfo` 里（没有动全局配置）。
> 如果哪天 git 报证书错误（例如换了加速器、重装了 Git），把这个文件重新生成一遍即可：
> 把 Git 自带的 `mingw64\etc\ssl\certs\ca-bundle.crt` 和当前加速器的根证书
> （Windows 证书库里搜 `SteamTools`）拼在一起，写成无 BOM 的 UTF-8 就行。

### 如果哪天顺手开了 GitHub Pages 会怎样？

GitHub Pages 只能托管静态文件（HTML / CSS / JS / JSON / 图片），它**不认识 `functions/`**，所以：

- `/api/...` 全部返回 404；
- 站点会自动降级成**「只读本地数据」模式**：直接读内置的 `data/roblox_music.json`，
  搜索、分类筛选、复制 ID、随机挑一首、收藏、深色模式都还能用；
- 用不了的只有：无效上报、热门榜、来源统计、鸣谢动态加载、后台全部管理功能。

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
- **限速**：登录、登录态检查、**无效上报 / 撤销**、热门上报、访问渠道上报都按
  `CF-Connecting-IP`（无效上报按「浏览器身份」优先）做了内存限速（登录 10 分钟 5 次；
  无效上报 10 分钟 60 条；渠道上报 10 分钟 20 次；热门上报 10 分钟 60 次）。
  另有 `functions/api/_middleware.js` 的**全 API 突发限速**（单 IP 10 分钟 600 次）
  与 256 KB 请求体上限。这些都是「单实例内存限速」，只用于挡住脚本暴力尝试，不是分布式全局限流。
- **同源校验（CSRF）**：所有写接口（POST）都会校验 `Origin`：缺失或与请求主机一致才放行，
  跨站表单 / 跨站 fetch 会被 403 拒绝。
- **响应头**：`functions/` 返回的 JSON 统一带 `Cache-Control: no-store` 与
  `X-Content-Type-Options: nosniff`；静态文件的响应头由根目录 `_headers` 配置
  （全站 `nosniff` + `Referrer-Policy: strict-origin-when-cross-origin`，
  `/admin.html` 额外加 `X-Frame-Options: DENY` 与 `frame-ancestors 'none'`，防止后台被 iframe 嵌套点击劫持）。
- **错误信息**：接口出错时只返回通用文案（如 `server error`），详细错误通过
  `console.error` 打到 Cloudflare 函数日志，避免把数据库结构、SQL 等信息泄露给访客。
- **密钥管理**：`AUTH_HASH` / `AUTH_TOKEN` 一律用 Cloudflare 的加密变量（Secret）配置；
  本地放 `.dev.vars`（已在 `.gitignore` 中忽略）；**永远不要**提交到 Git、
  也不要贴到前端代码里。本项目没有 `wrangler.toml`，所以也不存在「写进配置文件」这条路。
- **数据边界**：`data/roblox_music.json` 是公开静态文件，任何人都能看到里面的 ID；
  后台「🚫 无效音乐ID管理」里的**下架**只影响本站展示与合并结果，不等于从游戏里删除任何东西。
- **D1 数据**：没有导出/备份接口给访客；建议定期在 Cloudflare 控制台用 D1 的
  Export 功能备份数据库，或执行 `npx wrangler d1 export zhimist-db --remote --output backup.sql`。
  （2026-09-29 起这四个工具已经不在网站上了，改为桌面本地版：见附一第 11 节 ⑤。
  剩下的 `tools/rollback.*` 是本地回退小工具，跟线上无关。）

### 免费防护（2026-10-05 新增）

> 起因：站主问「怎么给网站开防护」。先讲清一个前提 —— Cloudflare 面板上那套
> **WAF 防火墙规则 / Bot Fight Mode / 限流规则 / 安全级别 / 我受到攻击模式**，
> 全都挂在**自己名下的域名（zone）**上；本站跑在 `zhiwumansui.pages.dev`，
> 那是 Cloudflare 自己的域名，站主账号里没有它，所以这些开关**现在开不了**
> （不是没找到地方）。不买域名能做的，是下面这些「代码层」加固：
> 全部零成本，且**默认不影响任何访客**。

**这次加了什么**

| 加了什么 | 文件 | 作用 |
| --- | --- | --- |
| 全 API 突发限速 + 请求体上限 + 安全响应头 | `functions/api/_middleware.js`（新） | 单 IP 10 分钟 600 次；body ≤ 256 KB；统一补 nosniff / X-Frame-Options |
| Turnstile 人机验证（三档模式） | `functions/api/_utils.js` + 登录 / 无效上报 / 撤销 / 渠道上报 | 脚本连通行证都拿不到，就刷不动这几个接口 |
| 前端一次性通行证 | `js/turnstile.js`（新） | 没填 Site Key 时完全静默：不插脚本、请求里也不带任何新字段 |
| HSTS / 防点击劫持 / 权限收紧 | `_headers` | 强制 HTTPS、禁止被任何网站 iframe 嵌套、关掉摄像头/麦克风/定位/支付 |
| 挡 AI 训练爬虫 | `robots.txt`（新） | GPTBot / CCBot / ClaudeBot / Bytespider 等一律 Disallow（君子协定） |

**没加**：热门上报 `/api/hot/report` 是「复制 / 试听」时自动发的，塞不进人机验证，
所以它只有原来的内存限速；要拦它得靠域名之后的 WAF / 限流规则。

**怎么启用 Turnstile（三步，缺任何一步都等于「不启用」）**

1. Cloudflare 面板 → **Turnstile** → Add widget：Hostnames 填 `zhiwumansui.pages.dev`
   （本地调试再加 `localhost`），Widget Mode 选 **Non-interactive** 或 **Invisible**，
   拿到 Site Key（公开）和 Secret Key（保密）。
2. 把 **Site Key** 填进 `js/turnstile.js` 顶部的 `SITE_KEY`（公开值，可以进仓库）。
3. Pages 项目 → **Settings → Variables and Secrets** 加两个变量：
   `TURNSTILE_SECRET` = Secret Key（选加密，**绝不进仓库**）、`TURNSTILE_MODE = soft`。
   观察几天（函数日志里搜 `[turnstile]`）确认没有正常访客被误伤，再改成 `strict`。

**怎么回退**：把 `TURNSTILE_MODE` 删掉或改回 `soft`（或删掉 `TURNSTILE_SECRET`），
下一次请求立刻恢复原样，**不用重新部署代码**；`js/turnstile.js` 的 `SITE_KEY` 留空则前端也完全静默。

**大陆网络注意**：Turnstile 脚本来自 `challenges.cloudflare.com`，部分地区加载慢或失败
（Cloudflare 状态页出现过「China visitors cannot complete Cloudflare challenges」）。
加载失败时前端会静默降级：`soft` 模式一切照常，`strict` 模式会被服务端拒绝 ——
所以务必**先 soft 观察**再切 strict。

**应急：站点被打时唯一能立刻用的开关**（不需要域名）
Cloudflare 面板 → Workers & Pages → 本项目 → **Settings → Enable access policy**，
然后到 Zero Trust → Access → Applications，把那条策略的**通配符 `*` 删掉** →
全站变成必须邮箱验证码登录。副作用是所有访客都被挡在门外，只适合应急；
恢复时把那个 Access 应用删掉即可。

**还差一步（要花钱）**：自有域名接入 Cloudflare 后，免费版还能开
安全级别 / Bot Fight Mode / Free Managed Ruleset（免费托管规则集）/ 5 条自定义 WAF 规则 /
1 条限流规则（10 秒窗口、按 IP）/ Under Attack 模式 / AI 抓取策略 / Access 路径级保护。

---

## 六、想改点什么？先看这张表

不用懂代码也能大致找到地方，改完推到 GitHub，Cloudflare 会自动重新部署。

| 想改的东西 | 去哪儿改 | 怎么改 |
| --- | --- | --- |
| **预览版弹窗的文案** | `js/common.js` | 搜 `PREVIEW_NOTICE_VERSION` 上面那段 `modal.innerHTML` |
| **让预览版弹窗重新弹一次**（比如改了文案想让大家再看一遍） | `js/common.js` | 把 `PREVIEW_NOTICE_VERSION = '1'` 改成 `'2'`。数字一变，所有访客下次打开都会再看到一次 |
| **不想让某个页面弹预览版弹窗** | 对应页面的第一行 | 在 `<html>` 标签里加 `data-notice="off"`（后台页已经这么设了） |
| **首页的卡片** | `index.html` | 搜 `<div class="content-grid"`，卡片就写在里面，复制一整段 `<a class="card">…</a>` 就是新增一张 |
| **导航栏的链接** | 每个页面里的 `<nav class="navbar">` | 首页 / 鸣谢 两个入口都在里面，加一个 `<li><a href="...">…</a></li>` 就是加一个入口（**反馈页 2026-10-05 已整页删除，别再往回加**）。**⚠️ 2026-10-04 起页脚里不再有任何导航链接**（首页 / 意见反馈 / ID 宝库 / ❤️ 鸣谢 全删了，站主要求「所有页脚下面的如首页等内容都删掉」）—— 页脚只剩版权行（2026-10-04 晚起连分享入口也下线了），要跳页面只能走顶部导航栏。**例外：`roblox_music.html`（宝库页）整个导航栏也删掉了**，那一页只有左下角常驻的「🏠 返回首页」（`.back-home-fab`）；它的深色模式开关改挂在页头的 `[data-theme-slot]` 上 |
| **主色 / 配色** | `css/style.css` 最上面的 `:root` | `--primary` 是主色，`--gold` 是金色点缀；深色模式在同文件的 `[data-theme="dark"]` |
| **手机上关掉的特效** | `css/style.css` | 搜 `html.lite`；`js/common.js` 里的 `isLiteMode()` 决定什么时候进入精简模式 |
| **宝库里的歌** | 后台「卡片管理」 | 增删都会写进 D1；也可以直接改 `data/roblox_music.json`（改完要重新部署） |
| **每页显示多少组** | `roblox_music.html` | 搜 `const PAGE_SIZE`，默认 100 组一页；改完分页器会自己重算页数 |
| **举报几条自动隐藏** | ~~已取消~~ | 举报不再自动隐藏内容，改由站长人工判断；后台按举报数排序便于排查 |
| **宝库页那条 ID 上的「🚫 无效处理」** | `roblox_music.html` | 每条 ID 的按钮顺序是 `☆ 收藏 / 🔗 试听 / 📋 复制 / 🚫 无效处理`（最后一颗刻意小一号，样式在页面 `<style>` 的 `.id-actions .btn-invalid`）。点一下 → `POST /api/invalid/report`（带上 `getClientId()` 的匿名身份）→ 那一行变灰、按钮变「↩️ 撤销」，本地记在 `localStorage.roblox_invalid_reported`。**上报不会隐藏条目**（站主定的：就地标记、可撤销）；点「↩️ 撤销」→ `POST /api/invalid/withdraw`。**2026-10-05 站主又要求「无效批量处理」整个删掉**：工具栏那颗按钮、批量条、行里的勾选框、批量模式与相关 JS/CSS 全部删除 —— 现在上报只有这一种方式。（接口本身仍然支持一次 ≤200 条，前端保留分批逻辑，以后要恢复批量入口不用改后端。） |
| **「📋 我上报的」上报表（访客自己的隔离区）** | `roblox_music.html` 工具栏「管理」组那颗按钮 + `functions/api/invalid/mine.js` | 站主 2026-10-05：「增加一个上报表（游客），点击无效按钮之后上报的歌曲，在这里面可以看到所有他上报的歌曲，然后可以选择恢复，再加个全部恢复按钮（其实本质上还是游客隔离区）」。点开是一个表格：**歌名 / ID / 上报时间 / 状态 / 操作**，底部「↩️ 全部恢复」。数据来自 **`GET /api/invalid/mine?reporter=xxx`**（只读）：按 `getClientId()` 的匿名身份过滤，返回自己那几条与状态（`pending` 后台待处理 / `ignored` 已忽略 / `removed` 已下架）。**恢复**就调已有的 `POST /api/invalid/withdraw`（单条 / 批量都走它），成功后会同时擦掉本地标记并让宝库页那一行变回「🚫 无效处理」。另外把 `localStorage` 里「服务端已经没有」的残留标成「📌 仅本地记录」，只提供「🧹 清除」（不静默丢，也不假装还在后台）。**⚠️ 安全口径**：没有合法 `reporter` 一律 400 —— 绝不允许「不传身份就返回全部」，否则会把别人（尤其 `reporter=''` 那批）的上报列出来。 |
| **点 ID 打开 Roblox 官方页面时的那句提示** | `roblox_music.html` 的 `openRobloxAsset()` | 站主 2026-10-05：「把『🚀 已在新标签页打开 Roblox 官方页面（访问可能需要加速器）』删除了」→ 那句 `showNotice(...)` 已删（新标签页本来就开了，不用再弹一句）。**被浏览器拦截时的兜底提示（「⚠️ 新标签页被浏览器拦截，正在当前页打开…」+ 800ms 后当前页跳转）照旧保留**，别一起删掉。 |
| **全站必读公告：不再自动弹，但公告保留** | `js/common.js` 5.5 节的 `showSiteNotice()` / `openSiteNotice()` + `index.html` 的 `.site-announce` 公告条 | 站主 2026-10-05：「把公告弹窗删除了，但是公告保留」→ `initUI` 里那句自动弹的延后调用**已删**；公告本体一个字没少，改成**点首页那条 📢 公告才打开**（`window.openSiteNotice()` → `showSiteNotice(true)`）。⚠️ 两处配套改动别漏：① 不再自动弹之后，那个「避免两个弹窗撞车」的 `noticeGate` 必须在 `initUI` 里**当场放行**，否则「版本更新公告」要白等 20 秒兜底超时；② 想恢复自动弹，就把那句延后调用加回去（`showSiteNotice` 本身原样保留，带 `force` 参数）。`SITE_NOTICE_VERSION` 现在是 `'7'`，只在恢复自动弹时才有意义，留着记录内容变更史。 |
| **宝库页的搜索框 / 分类以前会吸顶跟着滚** | `roblox_music.html` 的 `.search-row` 样式 | 站主 2026-10-05：「我在 Roblox ID 宝库中，往下划的时候，搜索框和下面的分类也跟着下来了 修复」。原因：桌面端（`@media (min-width: 769px)`）那条规则写的是 `position: sticky; top: 64px; z-index: 60`，搜索框 + 分类栏（`.filter-tabs`）一起贴在页头下面跟着滚。**改法**：去掉 `position/top/z-index` 三个吸顶属性，**保留**那张卡片的观感（不透明底 + 圆角 + 细边框 + 内边距）；顺带删掉已经没人引用的 `.search-row.stuck`（吸顶时的投影，全仓搜 `stuck` 只有它一处）。手机端本来就不吸顶，未受影响。⚠️ 副作用（站主知情）：搜索框现在只在页面顶部能摸到，滚到下面想换关键词得先滚回去 —— 要的话可以再加一颗「⬆ 回到顶部」的小按钮（现在左下角只有「🏠 返回首页」那颗 fab）。 |
| **📺 求关注（哔哩哔哩主页）** | `index.html` 的 `.bili-follow` 一条细横幅 | 站主 2026-10-05：「我哔哩哔哩的个人主页：https://space.bilibili.com/1270782400，我希望大家能给我点关注，因为关注到 Lv2 的时候可以解锁『合集』功能」。第一版做成了 800px 宽、两行说明的卡片，站主随后要求「**求关注的那一块弄小一点，还有公告里面不要有跟关注有关的**」→ 现在是 **hero 正下方一条细横幅**（约 53px 高：📺 + 标题 + 一句说明 + B 站粉小按钮），窄屏换更短的一句（`.bili-follow-short`，600px 以下切换）控制在 73px；主页地址不再明文铺开，改挂 `title` 与按钮的 `aria-label`（悬停可见、读屏可读）。**公告里那段求关注已整段删除**（`js/common.js` 与 `css/style.css` 的 `.site-notice-bili` 一起清掉，只在注释里留档，别再往公告里加）。**站主硬约束：「所有页脚下面都没有任何东西，保持现状」** —— 入口只在 `<main>` 里，四个页面的页脚一个字都没动（`lead-bili-check.mjs` 会逐页断言「页脚下面没有任何可见内容」）。（**2026-10-09 例外**：站主要求在页脚**内部**加「法律定位 / 隐私说明 / 联系站长」三行，见下面『联系站长 / 法律声明 / 隐私说明』那一行；页脚**下面**依然什么都没有，断言不破。）改链接只需改 `index.html` 里那两处 `space.bilibili.com/1270782400`。 |
| **联系站长 / 法律声明 / 隐私说明（页脚那三行）** | 四个页面 `<footer class="footer">` 里的 `.footer-legal`（样式在 `css/style.css` 的「10. 页脚」一节） | 站主 2026-10-09：「**你看情况帮我改，能改的都改了，以安全为主**」，并给出 QQ `2560803486` / 邮箱 `2560803486@qq.com`。加这三行不是为了好看，是补两个**法律漏洞**：① **收通知的入口** —— 《信息网络传播权保护条例》第 23 条给「提供搜索/链接服务」的免责前提是「接到权利人通知后断开链接」，**没有联系方式＝收不到通知＝免责前提直接落空**（《民法典》第 1195 条「及时采取必要措施」同理）；② **把法律定位写在明面上** —— 「本站仅提供跳转 Roblox 官方页面的链接，**不存储、不传播任何音频文件**」，这句必须与 `roblox_music.html` 风险弹窗最后那句**口径一致**（两处打架比不说更糟）。第三行是隐私说明：只在浏览器本地存随机 ID、不收集姓名手机号、服务端不保存 IP（对应《个人信息保护法》第 17 条的告知义务，数据口径见 `js/common.js` 的 `getClientId()` 与 `functions/api/_utils.js` 的 `clientIp()`）。**⚠️ 三条硬约束**：只加在 `<footer>` **内部**，页脚**下面**依然什么都没有（`lead-bili-check.mjs` 的断言不破）；**纯静态、不加 JS**（接口挂了这三行也照常显示）；`QQ：2560803486` 是**纯文本不是链接**（不引第三方跳转）。<br>**同一轮还把「风险弹窗」整个重写了**（`roblox_music.html` 的 `#riskModal` 与 `#riskConfirmModal`，站主 2026-10-09：「风险弹窗的整个弹窗你也可以选择重做……只为了我们更加安全」）。三条原则：① **删掉一切自我指控** —— 原「网易云/QQ音乐」那段的「未经许可将……嵌入第三方工具（**如本工具**），构成对著作权人信息网络传播权的侵犯」等于自认；「Roblox 曾因未经授权使用音乐被 **NMPA** 起诉」那段等于把「本站很清楚这些音频可能没授权」写在明面上，替对方准备「明知/应知」的证据 —— 两段连同著作权法罚则摘录、司法案例一起删除。② **把合规义务写明是用户的**（用他人音乐要自己取得许可、自己守 Roblox 规则、本站不保证第三方内容合法）。③ **补上避风港承诺与投诉入口** —— 「收到通知后会立即断开相关链接」+ 邮箱，这句才是弹窗现在最值钱的一句话（《条例》第 23 条）。同时把原「访问 Roblox 官方页面**可能需要网络加速器**」改成中性说法（理由：《计算机信息网络国际联网管理暂行规定》第 6 条禁止使用非法定信道 + 第 14 条罚则）。**⚠️ 结构没动**：`id="riskBody"`、`riskCancelBtn / riskConfirmBtn / riskConfirmCancel / riskConfirmOk`、`.risk-body / .section-title` 全部保留（`previewId()` 的倒计时与 `dom.riskBody.scrollTop = 0` 照常工作），`openRobloxAsset()` 的兜底跳转一个字没改。**只改文案，行为一个字没变**（试听仍然跳 Roblox 官网）。**2026-10-09 稍后站主要求「风险弹窗的倒计时改成 5 秒」**：现在秒数是一个常量 `const RISK_COUNTDOWN_SECONDS = 5;`，外加 HTML 里那颗按钮的初始文案 `确认跳转 (5s)` —— **就这两处，改时一起改**（`.verify/footer-legal-check.mjs` 会断言两处一致、且不再出现 `(10s)`）。<br>**⚠️ 配套的版本号机制（2026-10-09 同日加）**：`roblox_music.html` 新增 `RISK_CONTENT_VERSION`（当前 `'v2'`），`riskVersion()` 改成返回「服务端版本 + `\|` + 内容版本」—— 老用户点过「不再提示」后，localStorage 存的是旧值（`v1.0.0` / `local-1`），跟新值 `v1.0.0\|v2` 对不上，所以**这次改版所有人都会重新看一次新弹窗**。**以后只要改了弹窗里的法律文案，就把 `RISK_CONTENT_VERSION` +1（v3、v4…）**；服务端那条线（后台 `POST /api/risk` 重置，读 D1 的 `page_updates`）行为不变，两条线任意一条变了都会让「不再提示」失效。 |
| **⚖️ 法律与风险提示整页（`law.html`）** | 新文件 `law.html`（2026-10-09 新建；样式写在该页 `<style>` 里，只用 `css/style.css` 的变量，明暗主题自动跟随） | 站主 2026-10-09：「**法律条文也要写上去，尽可能详细，或者你可以找一个地方放这个法律条文（全部相关的详细的法律条文，目的是提醒用户）**」→ **单开一页**承载全部条文原文，弹窗只留摘要 + 一个入口（弹窗是「跳转前的一次性确认」，塞几千字没人看、手机一屏也放不下）。页面七节：① 本站定位（只索引/只跳转/不存不传/收到通知立即断链）；② 《著作权法》第 2、10(12)、24、44、49、52、53、54 条；③ 《信息网络传播权保护条例》第 2、4、18、19、20、21、22、23、26 条；④ 《民法典》第 1194～1197 条；⑤ 《刑法》第 217 条 + 法释〔2025〕5号第 12、13、28 条；⑥ 网安法 47 / 互联网信息服务管理办法 4、15、16、19 / 国际联网规定 6、14 / 个保法 4、13、17（节选）；⑦ 权利人下架通道（邮箱 + 通知书三要素 + 断链承诺）。**⚠️ 2026-10-09 站主又点名删了两块**：原第 7 节「给使用者的建议（怎么用才安全）」整节删除（站主原话「法律里面的内容是给用户或者权利人看的，不是给我的」「像『7 · 给使用者的建议（怎么用才安全）』这种的」），原第 8 节顺位改成第 7 节、锚点 id 由 `s8` 改成 `s7`；此前还删了顶部那块「30 秒速览」。**别再往这一页加「建议 / 速览 / 摘要」这类指导性内容——本页只放条文原文 + 权利人通道。** **页内引用统一用「目录 0X」**（站主 2026-10-09 原话：「将所有的第几节改成目录几」）：三张入口卡与第 1 节那句「对权利人的一句话」里原来写的是「第 2 节 / 第 7 节 / 第 2～6 节」，现在一律改成「目录 02 / 目录 07 / 目录 02～06」，和左侧目录的编号（01～07）对齐；同时修掉两个错：① 第 1 节那句原来写「详见第 8 节」（第 8 节早就顺位成第 7 节了，是漏改）；② 「📚 我要看全部条文」那张卡原来 href 指到 `#s3`（点下去落在第 3 节），站主指出后改成 `#s2` —— 从条文的第一节开始。**⚠️ 写作底线（改内容时必须守住）**：这一页只写「提醒使用者」+「本站自己的公开承诺」，**不许出现自我指控**（例如「把音乐嵌入第三方工具（如本工具）构成侵权」这类句子永远不要再写）；条文**照抄官方文本**、加粗只标重点，摘录处标明「节选」，页尾写明「不构成法律意见、以官方文本为准」。**2026-10-09 二次改版（更方便 + 更高级）**：站主随后要求「法律那个页面的定位等内容可以改一改，更加方便和高级」→ 顶部改成 hero（渐变底 + 更新日期 / 条文数 / 不存音频 徽章）+「30 秒速览」三行结论 + 三张身份入口卡（🙋 使用者 / 📮 权利人 / 📚 看法条）；桌面端改成左右分栏、左侧**粘性目录**（滚动一直跟着），窄屏自动收成两列再变一列；法条原文块加**条号胶囊**、每节标题加渐变竖条；结尾加「↑ 回到顶部」。**只动样式与版面，条文逐字未改** —— `.verify/law-diff-check.py` 会比对旧版：27 个法条块逐字一致、s2～s7 整节逐字一致，只有 s1（定位）按站主要求重写（口径不变：只索引/只跳转/不存不传/收到通知立即断链）。<br>**入口有三处（2026-10-09 站主当天两轮调整后的最终形态）**：① **导航栏** —— 首页 / 鸣谢 / 法律 三个带导航栏的页面都挂「⚖️ 法律」；② **风险弹窗顶部**的金色横幅 `.risk-law-link`（在 `.risk-body` 外面，长文滚动时一直可见）；③ 四个页面页脚 `.footer-legal` 里的文字链接。**⚠️ 两条当天被站主否掉的写法，别再犯**：(a) 宝库页工具栏那颗金色 `a.btn.btn-law`（站主原话「把 Roblox ID 宝库里面的『法律』按钮删除了」，`.btn-law` 样式一并删除）；(b) **所有法律入口都不许新开标签**（站主原话「我要点击跳转是在页面里面跳转，而不是换了一个新标签」）—— 弹窗横幅已去掉 `target="_blank" rel`，改回普通站内链接。同一天站主还删掉了页面上那块「30 秒速览」（三行 🧭/⚠️/📮 结论），`.law-quick*` 样式一并清掉。**同时把 `RISK_CONTENT_VERSION` 从 v1 提到 v4**（规则见上一行：改了弹窗文案就要 +1；v2 = 弹窗挂上法条页入口，v3 = 二次确认弹窗也按同一套元素重做，v4 = 两个弹窗顶部加金色法条横幅 `.risk-law-link`）。<br>**2026-10-09 稍后补：法条入口提到弹窗最上面**（站主原话：「法律那个页面的跳转，在相关弹窗请放在最上面突出」）—— 两个弹窗在 `h2 → .sub-warning → .redirect-notice` 之后、**`.risk-body` 外面**插了一条金色横幅（`<a class="risk-law-link" href="law.html" target="_blank" rel="noopener">`，含标题 + 一行小字说明 + 箭头）。放在滚动区**外面**是刻意的：`#riskModal .risk-body` 有 `max-height:48vh; overflow-y:auto`，长文往上翻时横幅会一直停在顶部；`target="_blank"` 保证点开法条页时弹窗与 10 秒倒计时都不被打断。正文里原来那句「完整法律条文……见 ⚖️ 法律与风险提示」已删（避免同一件事说两遍）。导航里这一页的标签是「⚖️ 法律」（站主 2026-10-09 原话：「『法律提示』文字改成『法律』」；页面自身的标题仍是「⚖️ 法律与风险提示」，两者刻意不同：导航要短、页面要说明白）。验收脚本：`.verify/footer-legal-check.mjs` —— 会断言 51 项，含「目录 8 个锚点都能跳到位」「23 个核心条号齐全」「法条原文块 ≥ 20」「无自我指控措辞」「两个弹窗元素一致（.sub-warning / .redirect-notice / 四个小节 / 法条页入口）」。 |
| **推送通道（git push 走哪条路）** | 仓库的 git 远端配置（不在文件里） | 2026-10-05：本机到 `github.com:443` 的 HTTPS 经常被墙（表现为 `Failed to connect to github.com:443`），而 `ssh.github.com:443` 一直通 —— 于是按站主「方案 B」把推送通道换成 **SSH over 443**：<br>`origin = ssh://git@ssh.github.com:443/HuTinJian/zhiwumansui.git`（现在用它推，**不需要加速器**）<br>`https = https://github.com/HuTinJian/zhiwumansui.git`（留作备用）<br>**为什么是 443 而不是 22**：本机 `github.com:22` 实测被拒（`ECONNREFUSED`），GitHub 官方给的就是 443 这条 SSH 通道。<br>**要切回 HTTPS**（例如换了台电脑、公钥没带过去）：`git remote set-url origin https://github.com/HuTinJian/zhiwumansui.git`；再切回来：`git remote set-url origin ssh://git@ssh.github.com:443/HuTinJian/zhiwumansui.git`。<br>前提：本机 `~/.ssh/id_ed25519.pub`（指纹 `SHA256:a2F2cdX0bzVYdWOj/DkeigO5UeQQ0C/fvjcG63QOeSU`）已加到 GitHub 账号 → Settings → SSH and GPG keys。2026-10-05 已实测：推一个临时分支再删掉，读写都通。 |
| **后台每个 ID 旁边都有「📋 复制 / 🔗 试听」** | `js/admin.js` 的 `adminIdActions()` / `adminCopyId()` / `adminListenId()` + `admin.html` 的 `.id-acts` / `.id-act` 样式 | 站主 2026-10-05：「后台所有跟 ID 有关的，都要有复制和试听功能，这样更快的审核和判断」，并连补两句「也包括 D1」「包括 D1 的歌曲管理」。覆盖面：**🚫 无效音乐ID管理 三段（待处理 / 已忽略 / 已下架）+ 🎶 D1 歌曲管理每一行**。复制走 `common.js` 的 `copyText()`（自带非安全上下文降级）；试听 = 新标签打开 Roblox 官方资产页 `create.roblox.com/store/asset/<id>`（跟前台那颗「🔗 试听」同一个去处），被拦截时兜底在当前页打开。绑定方式是**事件委托挂在 document 上**（这些列表翻页会整块重绘，绑在按钮上会重复绑定/失效）。以后后台再有新列表显示 ID，只要在渲染处插一个 `${adminIdActions(id)}` 就自动带上这对按钮。 |
| **后台面板的说明文字要短** | `admin.html` 的 `.panel-desc` | 站主 2026-10-05：「描述太多了，弄成超级简洁的版本」（点名了「🚫 无效音乐ID管理」与「🙏 玩家感谢」两段）。现在每个面板的说明都是**一到两句、25~58 字**：歌曲管理「加到这里就存进 D1，宝库页自动加载；攒多了用合并工具并进主数据。」／无效ID「访客上报进『待处理』：确认无效就下架，不算就忽略。『📤 导出』= 已下架名单；没人报的用『➕ 手动下架 ID』。」／赞助者「在这里加 / 改 / 删，直接生效；删除就是真删。」／鸣谢两栏各一句。细节（字段格式、为什么这么设计）挪进代码注释与本 README，界面上不再铺开。⚠️ 唯一保留长文的是「➕ 添加歌曲」弹窗里那个**默认折叠**的「📖 支持哪些写法」（514 字，是给站主查的参考，不占版面）。 |
| **时间口径：全部按北京时间显示（别再直接显示库里那串）** | `functions/api/_time.js` + `js/common.js` 的 `formatBeijingTime()` | 站主 2026-10-05：「时间都要准确，在 ID 上报那一块，上报时间完全不准确」。**根因（线上实测过）**：D1 里的 `created_at` 是用 `datetime('now','localtime')` 写的，但 Cloudflare 的 SQLite 跑在 **UTC** 上 —— 实测北京时间 10:50 上报一条，库里写的是 `02:50`，慢整整 8 小时；前台以前直接把它当北京时间显示，所以看着全错（凌晨 0-8 点报的连日期都差一天）。**修法两层，缺一不可**：① 接口层用 `toUtcIso()` 把库里那串转成**带时区**的 ISO（`…Z`）—— 已用在 `invalid/mine.js`、`invalid/list.js`、`quarantine/list.js`；② 展示层用 `formatBeijingTime()` **固定按 UTC+8** 显示（中国没有夏令时，固定 +8 就是准的，也不依赖访客所在时区），前台「📋 我上报的」与后台「无效音乐ID管理」共用这一个函数。⚠️ **不要去改库里的写法**（比如改成写 +8 小时）—— 那会让新旧数据两种口径混在一起，更难修。 |
| **滚动公告上的日期 / 公告弹窗顶部那枚日期** | `js/common.js` 的 `SITE_NOTICE_DATE` + `fillSiteNoticeDate()`；`index.html` 的 `.site-announce-date` | 站主 2026-10-05：「滚动公告加个时间，但是最终的效果你定」。落地方案：在「📢 公告」章后面钉一枚**固定不滚**的日期小章（走马灯外面，一直看得见；1366px 与 375px 都实测完整可见；手机上只缩小不隐藏），鼠标悬停显示「这条公告最后更新于 xxxx-xx-xx」。**日期只有一个来源**：`SITE_NOTICE_DATE` —— `fillSiteNoticeDate()` 会把它回填到所有 `[data-announce-date]` 占位处，公告弹窗顶部那枚 `.preview-notice-ver` 用的也是它，所以两边永远不会打架；改公告内容时改这一行 + `SITE_NOTICE_VERSION`。 |
| **所有无效 ID 的列表都按时间排序（最近 → 最早）** | `functions/api/invalid/mine.js`、`functions/api/invalid/list.js`、`functions/api/quarantine/list.js` + 前台表格 | 站主 2026-10-05：「所有无效 ID 的排序是按照时间排序，不论是后台的还是 Roblox ID 宝库里的」。改动：<br>· 访客的「📋 我上报的」→ `ORDER BY created_at DESC, id DESC`，前端还**再显式排一遍**（本地补进来的「仅本地记录」没有时间，固定排最后）；表头写明「上报时间（北京时间）」；<br>· 后台「待处理 / 已忽略」→ 原来是**上报次数多的在前**，现在改成**时间优先**（`ORDER BY last_at DESC, report_count DESC`），次数退为第二关键字；<br>· 后台「已下架」与宝库页用的那份下架名单 → `ORDER BY created_at DESC, id DESC`。<br>⚠️ `limit` 是在 SQL 里生效的，所以「哪些行会被取回来」由 SQL 的 ORDER BY 决定 —— 光改 JS 那一遍重排不够（两处都改了）。 |
| **无效上报进了后台哪儿 / 怎么下架** | 后台 →「🎮 卡片管理」→「🚫 无效音乐ID管理」 | 三段：**待处理上报**（按 ID 聚合的「上报 N 次」）/ **已忽略** / **已下架**。**三段各自有一个搜索框（2026-10-05 站主要求）**：只过滤自己那一栏，匹配 ID / 歌名 / 分类，右边显示「匹配 N 条 / 共 M 条」，ESC 一键清空；页码跟着过滤结果重算。待处理行点「✅ 确认无效并下架」→ `POST /api/invalid/handle {action:'remove'}`：写进 `quarantine_admin` → 前台下次加载就整条过滤掉（这就是「已下架」的全站生效方式）；「🙈 忽略」= `action:'ignore'`；两处「恢复」共用 `action:'restore'`；「🧹 清空已忽略」= `action:'clear-ignored'`。「📤 导出」导出的是**已下架**那份，格式与 `data/admin_quarantine.json` 一致。**⚠️ 后台代码不读接口返回的 `changed`**（它只是受影响行数，重复执行 `remove` 会是 0）。 |
| **后台搜索（歌曲管理 / 无效音乐ID管理）** | `admin.html`（`#songSearch` / `#invalidPendingSearch` 等）+ `js/admin.js` | 2026-10-05 站主要求：**歌曲管理**一个搜索框（`filterSongList()`），**无效音乐ID管理的三段各有一个**（`filterInvalidList()`，键分别是 pending / ignored / removed）。都只作用于当前这一块 + 当前这一页的显示，**不会改 D1 里的数据**；样式共用 `.panel-search`（`admin.html` 自己的 `<style>` 里，避开 style.css 的 `.form-group input` 干扰）。 |
| **更新公告** | `data/updates.json` | 内容直接写在这个文件里：每个页面一个 `version`（改了就弹一次）+ `updates`（弹窗内容）。改完版本号，访客下次打开对应页面就会看到弹窗。**⚠️ 2026-09-30 用户新增硬规矩：弹窗只有用户明确说要搞的时候才能加，不许当成任务收尾的固定动作顺手写（「小调整」这种也一样，先问）；标题与文案必须问用户要、不许自己代写；背景颜色不要问用户，按下面「主题色 = 更新程度」的对照、根据他给的文字自己判断。** 主题色 = 更新程度（老规矩，2026-09-30 从已删除的 `tools/update-notice.html` 里找回）：**粉=日常更新 / 紫=重大更新 / 蓝=体验优化 / 金=活动更新 / 绿=修复更新**。详见附一第 11 节。**2026-10-09**：站主明确说「你自己写一个 Roblox ID 宝库和首页的相关更新弹窗」→ 这一次是**AI 代写**的（与 2026-09-30「标题文案必须问用户要」那条规矩冲突，按新指令执行，站主知情）：`index` → `V2.2.3`（天青 · 体验优化，标题「法律页上线」）、`roblox` → `V2.2.0`（天青 · 体验优化，标题「试听提示改版」）；两条都只写访客能察觉的变化（法律页入口 / 试听弹窗改版 / 页脚联系方式），没提后台与接口。要换成站主自己的原话，只改这两个键的 `title` / `lines`，**版本键与弹窗里那行「→ 新版本」必须一起改**。 |
| **看访问渠道统计** | 后台「📊 数据统计」 | 数据本来就在 D1 里，这个标签页把它们显示出来（汇总卡 + 📢 访问渠道来源）；点「🔄 刷新」重新拉一次。**（2026-10-01）歌曲管理 / 无效音乐ID管理 / 鸣谢名单三个面板上面也各有一块自己的统计卡**（**2026-10-05**：原来那个「开发者隔离区」面板已并入「🚫 无效音乐ID管理」），切到那个面板就是最新数字 |
| **网站标题 / 分享时的描述** | 各 HTML 的 `<head>` | 搜 `<meta name="description"` 和 `<meta property="og:` |
| **「到目前一共花了多少钱」这个数字** | `js/common.js` 最上面的 `SITE_COST` | 这个数字现在**只在首页 hero 那条赞赏码的右边显示**（`.hero-sponsor-cost`，2026-09-30 从 `thanks.html` 挪过来的；鸣谢页那行 `.thanks-cost` 已删掉；赞赏码弹窗、新人弹窗也都不写金额和核对日期）。要改数字，就改 `amount` 这一行，顺便把 `checkedAt` 改成你核对这天的日期；HTML 里还有一份**没脚本时的兜底**数字和日期（占位属性 `data-site-cost` / `data-site-cost-date`，见 `js/common.js` 里 `fillSiteCost` 的选择器），换数字时顺手一起改。**2026-10-05：当天核了几次，依次是 `¥167.76` → `¥168.52` → `¥169.47` → `¥172.41` → `¥175.77`，核对日期都是 `2026-10-05`；2026-10-07 又核了两次：`¥175.77` → `¥180.04` → `¥182.03`，核对日期都是 `2026-10-07`；2026-10-09 站主给了 `¥184.47`，核对日期 `2026-10-09`** |
| **「收到多少赞助」这个数字** | `js/common.js` 里的 `fillSponsorTotal()`（**不用手改**） | 2026-10-04 按用户要求，在「花了多少钱」右边加了第二笔账（`.hero-sponsor-cost-got`，占位属性 `data-sponsor-total`）。它**每次打开首页现算**：`/api/thanks` 里 `category = '👑 赞助者'` 的 `platform` 金额 + 底档 `data/sponsors.json` 的 `amount`，按名字去重、同名以 D1 为准（口径和鸣谢页完全一致）。接口挂掉时保留 `index.html` 里写死的兜底数字 `¥25`，不会显示半份数据算出来的偏小值。**「截至 xxxx-xx-xx」那一行由两笔账共用**（`.hero-sponsor-stats-date`，占位属性仍是 `data-site-cost-date`），不再只挂在花费上 |
| **赞赏码放在哪 / 换成别的码** | `images/sponsor-qrcode.png` + `index.html` + `js/common.js` | 换码直接替换那张图。二维码只露一处：首页「🚀 开始逛逛」按钮下面那条（`<button class="hero-sponsor">`，点开是全站同一套大图弹窗），**右边那一小块就是「本站花了多少钱」**（`.hero-sponsor-cost`）。**新人弹窗里不放图**，只留一句「赞助码在首页」的提示（`js/common.js` 里的 `.preview-notice-sponsor-tip`）—— 顺带省掉首访下载 220KB 二维码的开销。**鸣谢页（`thanks.html`）里那块赞赏码小图按用户要求已删除**，那一页只有名单 |
| **老访客看不到新版新人弹窗** | `js/common.js` | 那个弹窗每个浏览器只弹一次。想让它对所有人再弹一遍，把 `PREVIEW_NOTICE_VERSION` 的版本号 **+1**（现在是 `'4'`，改成 `'5'` 即可） |
| **鸣谢名单（❤️ 独立页面）** | `thanks.html` + 后台「❤️ 鸣谢名单」 | 页面里**三个切换：👑 赞助者 / 🎮 Roblox ID 宝库 / 🙏 玩家感谢**（第三个是 2026-10-05 站主要求新增的；入口一直只在顶部导航栏，页脚链接已按站主要求删掉）。深链：`?tab=sponsors`（默认）/ `?tab=roblox` / `?tab=players`。宝库页原来那个鸣谢弹窗直接跳到这个页面，不再单独弹。 |
| **「🙏 玩家感谢」这一栏怎么归类的** | `thanks.html` 的 `isPlayerThanks()` + `js/admin.js` 的 `isPlayerThanksCategory()` | 站主 2026-10-05：「鸣谢名单加一个『玩家感谢』，里面把 Roblox 里面的网站创新家弄到这里来」。**归属规则（两处必须完全一致，改一处要改两处）**：类别名**带 🙏**、或**含「玩家感谢」**、或**含「网站创新家」**的，属于「玩家感谢」栏；其余（除 👑 赞助者 / 🚫 已删除赞助者）留在「🎮 Roblox ID 宝库」。所以 `💡 网站创新家` 不用改数据库就自动搬过去了。当天稍后站主又要求删掉「自定义类别」，所以后台**不再**有「新类别自动补 🙏 前缀」那回事——归属规则现在只负责把已有类别分到对应那一栏。 |
| **鸣谢页的排版：每个类别里的「人」分 3 列向下排** | `css/style.css` 的 `.thanks-groups` / `.thanks-people` / `.thanks-person`（+ `thanks.html` 渲染） | 站主 2026-10-05 前后提了三次，**以最后一次为准**：<br>① 「每个栏目的距离能不能增大一点？」→ 当时还是「类别并排成列」，列间距短暂改成 44px；<br>② 「roblox 感谢那一块，每个人的间距大一点」→ `.thanks-groups .thanks-person { padding: 8px 0 }`（原来 3px）：**同列人跟人之间 6px → 16px**（这条保留）；<br>③ **最终版**：「鸣谢名单的所有内容包括但不限于 Roblox ID 宝库、赞助者等，里面的人都要分为 3 列向下排，如果是像 🎬 ID公益UP主/作者 这样的，就按这个类型为一列向下排，每一列之间的间距要大」→<br>　· 每个类别（或赞助者那一整块）**自己占满一整行**、类别之间上下堆叠（`.thanks-groups { display:block }` + 相邻类别 `margin-top: 38px`）；<br>　· 块内的人用 CSS 多列 **`column-count: 3`**（多列的填充顺序天生就是「先往下、再往右」，正是站主要的「向下排」），**`column-gap: 56px`** 让三列一眼分得开，`break-inside: avoid` 保证一个人不会被拆到两列；<br>　· 窄屏降级：`≤900px` 2 列（gap 32px）、`≤480px` 1 列；<br>　· 赞助者那一栏（`.thanks-single`）同样是 3 列 —— 为此 `renderSponsors()` 补了一层 `.thanks-people` 包住人员行，**并且去掉了原来 640px 的限宽**（限宽会把 3 列挤成一团）。<br>⚠️ 后台的鸣谢列表用的是它自己的 `.list-item`，这一套与后台无关。 |
| **🎮 Roblox ID 宝库（鸣谢名单）里的人和话** | 后台 →「❤️ 鸣谢名单」→「🎮 Roblox ID 宝库」（存 D1）+ 本地档案 `data/thanks.json` | 页面读的是 `GET /api/thanks`（结构 `[{category, people:[{name, platform, message}]}]`，类别如 `🎬 ID公益UP主/作者`、`📋 歌单整理者`）；`data/thanks.json` 是同结构的**本地档案**（存档、对账用，**页面不读它**）；后台那栏能直接改 / 删（存 D1）。**2026-10-05：这一栏只管「不属于玩家感谢」的类别**——`💡 网站创新家` 已搬到「🙏 玩家感谢」子面板，页面上的写法与别的类别**完全一样**（名字 · 平台 · 描述 内联一行）。 |
| **别给某个类别做专属样式** | `thanks.html` | 2026-10-05 有一段插曲：「网站创新家」一开始做成了独立卡片 + 💡 徽标 + 描述引用块（高亮底 + 左侧色条），站主看过之后说「算了吧，网站创新家等内容的格式还是跟之前赞助者那些一样吧」——于是**整套删掉**，连 `thanks.html` 里的局部 `<style>` 块一起清空（历史实现见 `git show d2d4158 -- thanks.html`）。现在页面上**没有任何只服务某一个类别的样式**：所有类别都走 `renderGroupList()` 里那一条路径。以后要加专属样式，记得先问站主，并且做完要能一键退回（写在一个独立的 `<style>` 块里最省事）。 |
| **「网站创新家」的描述为什么不能自动代写** | 后台「➕ 添加鸣谢 / ➕ 添加玩家感谢 / ✏️ 编辑鸣谢」弹窗 | 站主明确这一条**由他手写**：选到类别「💡 网站创新家」时圆圈勾选框「✍️ 描述由我手写（不自动代写）」自动勾上，`js/admin.js` 的 `isManualThanksNote()`（判断走 `isInnovatorCategory()`，带不带 💡 都算）一票否决自动代写；手写内容（含换行与首尾空格）**原样入库**，不做任何加工。**那个勾选框是圆的**（站主 2026-10-05 要求「方格改成圆圈」）——`admin.html` 里 `.manual-note-line input[type="checkbox"]` 用 `appearance:none` + `border-radius:50%` 自绘，**`padding:0` 必须写**（不写会被 style.css 的 `.form-group input { padding:12px 16px }` 撑成 36×28 的椭圆）。⚠️ 页面那边**不再有创新家专属样式**（站主后来要求格式跟别的类别一样），`isInnovator` 那个页面函数已删除；`isInnovatorCategory()` 现在只服务后台这一个判断。 |
| **👑 赞助者里的人和金额** | 后台 →「❤️ 鸣谢名单」→「👑 赞助者」（存 D1）+ 底档 `data/sponsors.json` | 页面上两处合并显示、**同名的以后台那条为准**；类别固定 `'👑 赞助者'`（**这个字符串是数据口径，别改**），**金额写在 `platform` 字段**（例 `¥10.00`）、感谢语写在 `message`。后台那栏每条都能「✏️ 编辑 / 🗑️ 删除」，**删除就是真删**；底档文件里那几位不受后台管，要改要删让 AI 改文件后推送。**首页那块「收到赞助」也是按同一份数据现算的**（见上面那行） |
| **金额一律两位小数** | `js/common.js` 的 `formatMoney()` / `normalizeMoneyText()` | 站主 2026-10-05：「把关于金额的相关内容，弄到小数点后两位」。**口径只有一处**：`normalizeMoneyText()` 认得 `10` / `10.5` / `¥10` / `￥5` / `10元` / `10块` / `1,000` / 全角数字，一律归一成 `¥10.00`；**认不出是纯金额就原样返回**（备注写「一杯奶茶」不会被改成 ¥0.00）。用到它的地方：鸣谢页赞助者金额（`thanks.html` 的 `money()`）、后台列表显示与新增/编辑入库（`js/admin.js` 的 `adminMoney()`，保存前会把归一后的值回填到输入框）、后台导出、首页两笔账（`formatMoney`）。改金额格式只改这两个函数，别在各页面各写一份。 |
| **首页最上面那条滚动公告** | `index.html`（位置 + 文案）+ `js/common.js`（弹窗本体 `showSiteNotice`） | 2026-10-04 起它就在**导航栏正下方**，是一条通栏走马灯：轨道里放两份一模一样的文案，CSS 动画左移 50% 做无缝循环（悬停暂停）。改文案要**两份一起改**（第二份带 `aria-hidden="true"`），否则接缝会露馅 |
| **「分享本站」** | `js/common.js` 的 `buildShareModal()` / `initShareTriggers()` + `css/style.css` | 凡是带 `data-invite` 属性的元素，点一下就会弹出分享弹窗。**入口现在只剩一处：首页 hero 的「🔗 分享本站」**（`.zb-invite`）。⚠️ 2026-10-04 站主最后明确「任何页面的页脚都不要有分享链接」，所以页脚那三个入口全部下线了，**别再加回页脚**；宝库页本来就不要分享。
| **分享按钮的颜色** | `css/style.css` 的 `.zb-invite` | 2026-10-04 站主要求「贴主题 + 护眼」，所以走站点本来就有的**金色系**（和首页滚动公告、赞赏码块同一套变量）：浅色模式淡金底 `#fbf3e8` + 深金棕字 `#8a5a1c`（对比度 ≈5.4:1），深色模式暖褐底 `#2a2229` + 浅金字 `#eec48d`（≈9.5:1）。现在用它的地方：**只有首页 hero 那颗分享按钮**（`.zb-invite`）。它刻意比主按钮 `.btn-primary` 弱一档，不跟「🚀 开始逛逛」抢焦点；换色只改这一处。**页脚那套金色文字样式（`.footer .footer-links .zb-invite-link`）当前没有元素在用**，留着是因为站主随时可能又要页脚入口，写个 `<button class="zb-invite-link" data-invite>` 就能直接用 |
| **~~反馈表单哪些必须填~~（已下线）** | ~~`feedback.html` + `functions/api/feedback.js`~~ | **2026-10-05：反馈功能整页下线** —— `feedback.html` 已删除，`functions/api/feedback.js` 与 `functions/api/feedback/` 整个目录已删除，后台「💬 反馈管理」面板、`js/common.js` 的反馈回执弹窗也一并删除。D1 里的 `feedback` 表**保留不删**（老数据留档，仅供考古）。它原来的用途（提意见、上报无效 ID）现在由「🚫 无效处理」承担（**批量入口 2026-10-05 已按站主要求删除**）；要联系站主走首页公告里的 QQ 群 |
| **鸣谢名单的类别** | 后台 →「❤️ 鸣谢名单」→ 对应子面板的「➕ 添加鸣谢 / ➕ 添加玩家感谢」 | 类别**只能从下拉里现有的项选**：固定几项（`💡 网站创新家` / `🎬 ID公益UP主/作者` / `📋 歌单整理者`）+ D1 里已经出现过的类别（`js/admin.js` 的 `syncThanksCategoryOptions()` 自动补进列表，所以历史数据、以前自建过的类别照样选得到）。**2026-10-05 站主要求「把后台的所有关于自定义类别的都删除了」**：原来下拉最后那一项「✏️ 自定义类别…」和它旁边那个输入框、以及「在玩家感谢栏保存时自动补 `🙏 ` 前缀」的逻辑，全部删掉（历史实现见 `git show 4e559d0 -- admin.html js/admin.js`）。**2026-10-07 站主要求删掉「💬 反馈贡献者」**：下拉里那一项已移除，`thanks.html` 加了一道 `REMOVED_CATEGORY` 过滤（D1 里那几行即使还没清也**不会显示**），数据用 `migrations.sql` 第 3 组的 `DELETE FROM thanks WHERE category = '💬 反馈贡献者';` 清。要加新类别：改 `admin.html` 下拉里的固定项（一行一个 `div.select-option`，记得写 `data-scope="roblox"` 或 `"players"`）。**2026-10-05 起下拉还按子面板过滤**：在「🎮 Roblox ID 宝库」里只列不属于玩家感谢的类别，在「🙏 玩家感谢」里只列属于它的。`thanks.html` 按类别名分块显示 |
| **~~宝库页隔离区的反馈入口~~（已下线）** | ~~`roblox_music.html`（`#quarantineFeedbackBtn`）~~ | **2026-10-05：「⛔ 我的隔离区」弹窗整个删除**（连带那颗「💬 去反馈」），访客隔离区、批量隔离、每行的 ✕ 三条老路全部由「🚫 无效处理」取代（那颗「无效批量处理」按钮 2026-10-05 也按站主要求删了）；本地旧键 `roblox_quarantine_guest` 不再被读取（数据留在访客浏览器里，不主动删） |

> 小提示：改完如果发现页面没变，先按 `Ctrl + F5` 强制刷新一次，
> 浏览器有时候会把旧的 CSS / JS 缓存住。

---

## 七、性能与多设备适配（现状）

为了让手机和老电脑也顺滑，项目里做了这些取舍：

### 一、去掉「一直在跑」的开销

- **不用大面积高斯模糊**：背景全部改成纯径向渐变，视觉几乎一样，
  但省掉了一层全屏 `filter: blur()` —— 这是手机上最常见卡顿来源。
  连 `404.html` 里那几处也一起换掉了。
- **吸顶元素一律不用毛玻璃**：导航栏、宝库页的吸顶搜索栏原来都有 `backdrop-filter`。
  吸顶元素永远可见 —— 意味着**每滚动一帧就要把背后重新模糊一遍**。
  而它们底色本来就有九成不透明，那点模糊几乎看不出来，纯属白花钱。现在改成不透明底色。
- **背景特效大瘦身**（这一轮做的取舍）：
  | 原来 | 现在 | 原因 |
  | --- | --- | --- |
  | 三个接近半屏大小、一直在飘的色斑 | 去掉，只留静态渐变 | 三块大合成层，缓慢移动几乎看不出来 |
  | 全屏颗粒噪点层 | 去掉 | 3% 不透明度基本看不见，却占一整块显存 |
  | 跟随鼠标的光晕（520px 圆） | 去掉 | 用不上，还一直占一层 |
  | —— | **换成 14 个小光点** | 每个只有 2~4px，只做上下轻飘，全由显卡处理 |
- **不再让元素「一直重绘」**：
  - 首页大标题原来挂着一个无限循环的渐变动画，每帧都要重画整行大字 → 已去掉（悬停时仍有渐变位移）。
  - 宝库页「告诉我们你从哪来」按钮原来的循环缩放 → 改成静态按钮。
  - 首页「持续更新中」那个小圆点的呼吸光圈 → 从「动画 box-shadow」改成「缩放一个伪元素」（后者不重绘）。
  - 404 页的 404 大字原来的背景漂移动画 → 去掉；背景层改成只做位移不做缩放。
- **阅读进度条改用 `transform: scaleX()`**：原来每滚一帧都在改 `width`，
  那会触发**重新排版**；改成 transform 后只动图形，交给显卡。
  并且只在整数变化时才写样式，省掉大量看不见的微小更新。
- **不再乱用 `will-change`**：这个属性会让元素独占一块显存。
  原来每个按钮、每个歌曲分组都写了，1500 条数据下就是上千块显存。现在只留给少数几个固定元素。

### 二、少下载、少解析

- **更新弹窗的样式抽成独立文件**：`css/update-modal.css`（约 1.6 万字符）
  只在「真的要弹版本公告」时才按需加载。
  平时访问任何页面都不会下载它 —— `js/common.js` 因此从约 6 万字符瘦到约 3.9 万字符。
  （加载时会先等样式到位再弹窗，不会出现"先没样式后跳一下"的闪烁。）
- **首页的「站点更新」延迟加载**：它本来在首屏下面，现在滚到附近才发那三次请求，
  首屏少三次网络请求。
- **静态资源缓存**：`_headers` 里给 `/css/*`、`/js/*`、`/images/*` 配了
  `max-age=60/300 + stale-while-revalidate=86400` —— 回头客 60 秒内是零请求；
  60 秒之后**用手里那份旧的立刻渲染，同时后台校验有没有新版**。
  ⚠️ 代价说清：SWR 生效的那一次访客看到的仍是旧文件，**再打开一次**才是新版 ——
  所以「改完看不到效果」的窗口是「60 秒 + 一次导航」，不是精确的 60 秒。
- **HTML 也进了 60 秒缓存（2026-10-05）**：性能审计实测 Cloudflare Pages 的 HTML 响应
  **既没有 ETag 也没有 Last-Modified**，所以「浏览器问一句、没变回 304」这条路走不通 ——
  原来「HTML 不设缓存」等于**每次点开页面都整份重下**（宝库页 32KB + 250~460ms 的 TTFB），
  这是重复访问里最大的一笔固定开销。现在 `/` 与 `/*.html` 走
  `max-age=60, stale-while-revalidate=86400`。改 HTML 后最多 60 秒 + 一次导航生效。
- **两个「统计类」公开只读接口进了 60 秒缓存（2026-10-05）**：`/api/hot/list` 与
  `/api/visit/stats` 的响应加了 `Cache-Control: public, max-age=60, stale-while-revalidate=600`。
  ⚠️ 配套关键：**前端必须去掉 `?t=Date.now()`**（URL 一变缓存永远不命中）——宝库页那两处已经去掉了；
  后台（`js/admin.js`）仍然带 `?t=`，所以后台看到的永远是最新数据。
  ⚠️ **`/api/quarantine/list`（已下架名单）与 `/api/songs/list`（后台加的歌）故意保持 `no-store`**：
  这两条是「管理员刚操作完，访客/你自己刷新就该看到」的数据。我一度也给它们加了 60 秒缓存，
  结果被独立验收的端到端用例 E34 当场证伪（后台确认下架后，下一次宝库页加载命中缓存、
  没重新拉接口，那条 ID 还在）—— 这两条接口的目标就是「立刻生效」，不能缓存；
  它们那 600ms 的等待由宝库页的 1.5 秒超时兜底（超时先画主数据，回来了再补一次重绘）。
  `/api/thanks` 也故意不加缓存（它同时被后台用凭据调用）。
- **2026-10-05 又压了两处下载量**：
  · 首页 hero 那颗赞赏码只有 76px，原先却直接拉 `images/sponsor-qrcode.png`（214KB）——
    现在改用专门的小图 `images/sponsor-qrcode-small.png`（160×160，约 4KB），
    大图只留给点开后的弹窗（`loading="lazy"`，弹窗是 `display:none`，不点就不下载）；
    大图本身也顺手瘦身：1171²/214KB → 800²/约 39KB（64 色，显示最大 320px，余量够扫）。
  · 宝库页的主数据（`data/roblox_music.json`，约 400KB）改成**在 `<head>` 里就发出请求**
    （`window.__zmMainData`），下载与 CSS/JS 并行，页面底部的 `loadData()` 直接复用这个
    promise —— 原来要等页面底部脚本执行、再等 `DOMContentLoaded` 才开始下载。
  · 宝库页的三个辅助接口（已下架快照 / `/api/quarantine/list` / `/api/songs/list`）
    加了 1.5 秒上限：**超时先按主数据把列表画出来**，等它们回来再悄悄重绘一次
    （`keepPage`，不会把你甩回第 1 页）；风险版本号、更新公告也不再挡在首屏前面，
    热门榜改成点「🔥 热门推荐」时才拉。

### 三、弹窗优化

弹窗原来是全站最卡的地方，原因找到了并且清掉了：

- **遮罩不再用毛玻璃**：毛玻璃等于把遮罩背后那一整屏**重新模糊一遍**。
  弹窗出现时有缩放动画、打开后还要在里面滚动 —— 每动一下就要重算一次全屏模糊，
  这就是「弹窗特别卡」的根源。现在改成「加深的半透明纯色」，观感几乎一样，但几乎不花性能。
- **更新弹窗瘦身**：它原本还有 100px 半径的巨大阴影（每次重绘都要模糊一大片）、
  10 个一直在闪的漂浮光点（每个单独占一块显存）、以及两处 `filter: blur(40px)`。
  现在阴影降到 48px、光点只留 4 个、模糊改成纯渐变。
- **弹窗打开时暂停背景小粒子**：把显卡让给弹窗，关掉后自动从原处继续。
- **弹窗打开时页面不再往右跳**：用 `scrollbar-gutter: stable` 预先给滚动条留位置。
- **修掉了手机上「弹窗滑不动」**：原来 `body.modal-open` 上写了 `touch-action: none`，
  这个属性会「传染」给所有子元素，导致弹窗里那些能滚动的正文用手指划不动 ——
  摸起来就像卡死。现在去掉了（挡住背景滚动靠 `overflow: hidden` 就够了）。

### 四、其它让浏览器少干活的地方

- **列表用事件委托**：宝库页 1500 条数据不再是「每个按钮一个监听器」，
  整张列表只绑一次，点谁都能响应。
- **长列表延迟渲染**：`content-visibility: auto` 让浏览器跳过屏幕外那些歌曲的绘制。
- **转义函数不再碰 DOM**：`escapeHtml` 原来每调用一次就创建一个隐藏 DOM 节点，
  渲染上千条数据时会被调用上万次；改成纯字符串替换，快一个数量级。
- **中文排序改用共用的 Collator**：原来每次比较都要内部准备一遍中文排序规则，
  1400 多组排序要比较上万次；现在建一个共用的反复使用。
- **写 localStorage 改成合并写入**：原来每点一次复制/试听/收藏就同步写一次磁盘，
  现在合并成 1.5 秒写一次，离开页面时再补写一次（数据不会丢）。

### 五、手机上的专门处理

- **自动进入「精简模式」**：屏幕 ≤768px、系统开了「减少动态效果」、
  或者设备核心数 / 内存偏低、开了省流量模式时，自动关掉小粒子、入场动画和常驻动画。
  注意小粒子是**根本不生成**（不是先生成再隐藏），少走一遍流程。
  `404.html` 也有自己的一份同样判断。
- **手指友好**：移动端按钮、下拉选项、复选框都放到了 40px 以上，符合主流触控建议。
- **刘海屏安全区**：用了 `env(safe-area-inset-*)`，iPhone 上底部按钮不会被横条挡住。

如果哪天想把特效在手机上也要回来，把 `js/common.js` 里 `isLiteMode()` 的判断删掉即可
（`404.html` 头部还有一份同样的判断，一并删掉）。

---

## 附一：各功能的现状与约定

### 1）反馈：不用留邮箱了

- 表单里的**邮箱字段已删除**。改用浏览器身份 + 后台处理 + 回执弹窗：
  1. 访客提交反馈时，前端会带上本机随机生成的一串身份（存在 `localStorage`）。
  2. 你在后台每条反馈下面写一句说明（选填），点 **✅ 受理** 或 **🚫 拒绝**。
  3. 访客**下次打开他当初选择的那个页面**时，会看到一个弹窗告诉他结果，
     里面带着你写的那句话。同一条只提示一次。
- 反馈类型改成了两级：**主页 / 反馈 / 卡片（▸ Roblox ID 宝库）/ 其他**
- 老反馈没有浏览器身份，回执送不到 —— 后台会标一句"旧数据无身份"，处理时也会先问一下你。
- 界面上那串身份只是 32 位随机十六进制，**不含任何个人信息**，也猜不到别人的。

### 2）游客隔离区会自动跟着管理员隔离区走

某条 ID 一旦被导入管理员隔离区，就属于"全站已处理"。其他访客的本地隔离区里如果还留着它，
**下次打开宝库页时会自动删掉**，并提示一句"已被全站处理，已自动移除"。
这样同一条 ID 不会在每个人的隔离区里各留一份、越攒越多。

### 3）鸣谢名单（`thanks.html`）

原来首页那块「赞助者荣誉榜」和宝库页的鸣谢弹窗，现在合并成一个独立页面 **`thanks.html`**
（2026-10-04 起只有**导航栏**能进 —— 页脚那排链接按站主要求全删了），页内用两个切换（和后台一样的切换写法）分开显示：

- **👑 赞助者**：赞助过站点的人。数据有**两处来源**，页面上会合并显示
  （**2026-10-01 起：同名的以后台那条为准**，因为后台现在也能改底档里的人）：
  - `data/sponsors.json` —— **底档**，随仓库发布，字段是 `name` / `amount` / `message`
    （**2026-09-29 起没有 `title` 了**：原来的「荣誉赞助者」称号按用户要求整个删掉）。
    **2026-10-01 起后台也能改它了**：改 = 存一条同名的 D1 记录盖住它；删 = 存一条
    「🚫 已删除赞助者」标记（文件本身不动，想彻底清掉再改一次文件）。
  - D1 的 `thanks` 表里 `category = '👑 赞助者'` 的行 —— 在后台加 / 删 / 改，
    **金额写在 `platform` 字段**（例如 `¥10`），感谢语写在 `message` 字段。
- **🎮 Roblox ID 宝库**：就是原来那份鸣谢名单（ID 公益 UP 主 / 歌单整理者 / 反馈贡献者）。
  宝库页（卡片一）上原来的鸣谢弹窗、以及后来那颗「❤️ 鸣谢名单」按钮，**都已经删掉**了 ——
  卡片一不再有任何鸣谢入口，要来看鸣谢走顶部导航（页脚那排链接 2026-10-04 已删）。

页面的排版说明（2026-09-26 按用户要求调整过）：

- 页头用的是**首页那套区块标题**（`.section-head` + `.hint`，1.3rem），不是原来的居中大标题；
  名单的排版也按首页那套收小；两个档用的是同一套写法（`.thanks-groups` >
  `.thanks-group` > `.cat-title` / `.thanks-person` 一行一个人），不再有卡片盒子。
- 这一页**不放赞赏码**：原来那块「☕ 请我喝一杯」+ 二维码小图已经删掉，
  赞赏入口只保留首页 hero 那条（点开大图弹窗）。

后台入口：`admin.html` → **「❤️ 鸣谢名单」** → 「👑 赞助者」/「🎮 Roblox ID 宝库」。
卡片管理里的「❤️ 鸣谢管理」子标签已经取消，两处不会再重复。

**后台的「👑 赞助者」栏（2026-09-26 按用户要求改成和「🎮 Roblox ID 宝库」一样）：**

- 头部只剩 **「人数 + 🔄 刷新 + ➕ 添加赞助者」**；点「➕ 添加赞助者」弹窗里填
  **名字 / 金额 / 感谢语**（长度上限 40 / 30 / 200 字，和服务端一致）。
- 行里的 **✏️ 编辑**复用同一个弹窗（打开时标题和确认按钮会变成「✏️ 编辑赞助者 / 💾 保存修改」），
  **🗑️ 删除**保持原样。
- 原来那段「底档那一份只能改 `data/sponsors.json` 后重新部署……金额写在 platform 字段」的说明文字、
  以及页面里那排行内输入框（+「取消编辑」），都按用户要求删掉了。
- **数据口径一个字符都没改**：类别固定 `'👑 赞助者'`、**金额写在 `platform` 字段**、感谢语写在 `message`。

顺带说明：那个「到目前一共花了多少钱」（`js/common.js` 里的 `SITE_COST`），
**2026-09-30 起挪到首页 hero 那条赞赏码的右边单独显示**（`.hero-sponsor-cost`，
数字由 `fillSiteCost` 回填）；原来在 `thanks.html`「👑 赞助者」里那一行
（`.thanks-cost`）按用户要求删掉了，鸣谢页不再写金额。
**2026-10-04** 又在它右边加了第二块「收到赞助」（`.hero-sponsor-cost-got`，
由 `fillSponsorTotal()` 按 D1 + 底档现算），于是首页那块现在一眼能看出
「花出去多少 / 收到多少」两笔账。

### 4）反馈管理 →「❤️ 加入鸣谢」的描述是智能写的

不用不管什么反馈都写死一句「反馈了「卡片1」相关问题」了 ——
`js/admin.js` 里的 `buildSmartThanksMessage(item)` 会在本地把这条反馈读一遍再拼句子：

| 判断依据 | 会写成 |
| --- | --- |
| 反馈类型 卡片1 / 主页 / 反馈 | 「在「🎵 Roblox ID 宝库」」/「在首页」/「在反馈页」 |
| 勾了「上传隔离区 ID」且带了数据 | 「提交了 N 个待复核的隔离区 ID」 |
| 正文里有 10 位以上纯数字 | 「补充了 N 个音乐 ID」 |
| 正文关键词（失效 / 新歌 / 分类 / 搜索 / 卡顿 / 手机 / 建议 / 夸奖…） | 「帮着排出了失效的歌」「推荐了新歌」「提了改进想法」… |

每条最多说两件事（先「硬证据」后关键词），认不出来就兜底成「给站点提了反馈」，
整句按服务端上限截断到 200 字。点「❤️ 加入鸣谢」时，**确认框里会先把这句话显示出来**；
想改事后去「❤️ 鸣谢名单」→「🎮 Roblox ID 宝库」里改。纯前端规则，不联网、不动接口。

---

### 5）赞助者名单的两条规矩

1. **没有「荣誉赞助者」这种称号**：每行只写「名字 · 金额 · 感谢语」，`title` 字段整条链路都不再使用
   （底档里就算带着它也会被忽略）。金额写 `amount`（底档）/ `platform`（后台，D1）。
2. **名单下面有一行「排名不分先后 ❤️」**（`.thanks-foot`）：说明列表顺序只是加入的先后，
   不代表金额多少或名次。

---

### 6）加人时描述留空就自动代写

「➕ 添加鸣谢」和「➕ 添加赞助者」两个弹窗都适用：**填完名字 / 类别 / 平台后就把建议句写进描述框**，
提交前就看得见、想改直接改（改过之后就不再覆盖；提交时若仍是空的，再兜一次底）。

- 鸣谢：按类别给句子 —— 🎬 ID公益UP主/作者 → 「公开分享了一批 Roblox 音乐 ID…」、
  📋 歌单整理者 → 「整理了歌单…」、💬 反馈贡献者 → 「给站点提了反馈…」，
  填了平台就带上「在抖音…」；同一个类别下按名字错开 3 种说法，不会千人一面。
- 赞助者：感谢语 → 「谢谢你的支持 ❤️」等 3 种说法（**句子里不重复金额**，因为金额已经在行里单独显示）；
  **编辑**模式不代写（那时留空是管理员自己的选择）。
- 代码在 `js/admin.js`：`pickBy` / `buildSmartThanksNote` / `buildSmartSponsorNote`
  + init 里的 `refreshThanksNote` / `refreshSponsorNote`。纯前端规则，不联网。

---

### 7）后台各面板与「添加歌曲」的智能解析

用户一次提了六件事，一轮做完。改的只有 `admin.html` 和 `js/admin.js`
（**后端、接口、数据库一个字没动**，所以没有任何数据风险）。

**① 四个面板都有「📊 数据统计」了**（以前只有歌曲管理有）

| 面板 | 统计卡 | 状态 |
| --- | --- | --- |
| 🎶 歌曲管理 | 总 ID 数 / 歌曲组数 / **D1 歌曲数量** | 最后一张是这次新加的 |
| ⛔ 开发者隔离区 | 隔离区 ID 数 / 涉及分类 | 两块都是新加的 |
| ❤️ 鸣谢名单 → 👑 赞助者 | 赞助者人数 / 底档人数 / 后台添加 | 三块都是新加的 |
| ❤️ 鸣谢名单 → 🎮 Roblox ID 宝库 | 鸣谢人数 / 收录类别 | 两块都是新加的 |

「开发者隔离区」那张卡原来错放在**歌曲管理**那栏，这次搬回它自己的面板
（歌曲管理那栏的位置换成了「D1 歌曲数量」，就是 D1 里真正存了多少条）。
「涉及分类」= 隔离区里的歌一共牵扯多少种分类，前端现算，不多发请求。

**② 标题后面那个灰色数字徽章全删了**（就是反馈管理里被圈出来的那个「0」）。
反馈 / 歌曲 / 隔离区 / 鸣谢 / 赞助者 五处 `class="count"` 元素，连同 `js/admin.js`
里写它们的代码、以及 `.count` 那条样式，一起清干净 —— 数字现在只在统计卡里出现，
不会同一个数在标题和卡片上各显示一遍。

**③ 「📥 导入」改名「➕ 添加歌曲 / ➕ 添加隔离歌曲」**，跟鸣谢名单里的
「➕ 添加鸣谢」叫法对齐（同样是金色按钮）。**功能一个没变**：点开还是原来那个弹窗
（歌曲那边贴多行文本批量加、隔离区那边贴 JSON），接口还是 `/api/songs/add`、
`/api/quarantine/import`。弹窗标题和确认按钮也同步改成「➕ 添加歌曲 / ✅ 确认添加」。
> 「📤 导出」和「🧹 清空」的位置、功能都没动 —— 导出用来把线上数据存成文件，不能少。

**④ 每个面板标题下面都有一行同格式的灰色说明**（统一用 `class="panel-desc"`），
写清这份数据存在哪、谁在读它、什么时候要改文件。以前只有「歌曲管理」和「数据统计」
有这行字，隔离区和鸣谢名单是光秃秃的。

**⑤ 「➕ 添加歌曲」的解析变聪明了**（用户说「我的歌曲 ID 之间没有空格，
有的歌名还有书名号，还有冒号」）。现在这些写法都能认：

| 能认的写法 | 说明 |
| --- | --- |
| `晴天 1876950732` / `晴天1876950732` | 中间没空格也行 |
| `1876950732 晴天` / `1876950732《晴天》` | ID 在前、带书名号都行 |
| `晴天：1876950732` / `晴天-1876950732` / `晴天、1876950732` | 冒号、顿号、破折号、竖线这些夹在中间的自动清掉 |
| `《晴天》1876950732`、`"晴天" 1876950732`、`🆔 1876950732 晴天` | 书名号、引号、括号、emoji、「ID:」全清 |
| `1、稻香、1441450732` | 行首的序号也清 |
| 歌名一行、ID 另一行 | 会自己配上对 |
| `晴天 【古风国风】1234567890` / `分类：古风国风 晴天 1234567890` | 手动指定分类，优先级最高 |
| 一行多个 ID | 作为「同名多 ID」一起加 |
| 9 位 ID | 以前卡 10 位以上；库里其实有 8~9 位的老 ID，现在 9 位起都收 |

**⑥ 分类也会自己判了**，而且只往站点现有的 **14 个分类**里归 ——
以前会冒出「周杰伦」「Phonk/DJ」这种站点里根本没有的类别，宝库页会因此
多出一颗没人认识的分类标签（分类标签是按数据里的 `category` 生成的）。
判断顺序是：手动指定的分类 → 关键词表 → 纯拟声词短名 → 语言兜底
（日/韩文 → 游戏动漫、有汉字 → 中文流行、纯英文 → 英文热门）。
关键词表是**照着库里 2916 首歌实际怎么分类写的**（中文习惯一套 + 英文曲库一套），
所以英文歌名也能落到平时放的那一栏；手动写的分类名会先过一张别名表
（`Phonk/DJ` → 电子舞曲、`周杰伦` → 中文流行…），不会再造新类别。

**⑦ 弹窗里多了一块识别预览**：贴进去 0.25 秒后自动显示
「🔎 认出 N 首 · 各分类各几首」，下面列出前 8 首的「歌名 → 分类」；
D1 里已经有的会标「（已存在）」并提示会更新名字和分类（服务端是 upsert）。
**点「确认添加」之前就能看出有没有认错。**
「➕ 添加隔离歌曲」也沾了光：除了 JSON，现在直接贴「歌名 + ID」多行文本也行，
跟歌曲那边共用同一套解析。

**这一轮验证过的**（脚本都在 `.verify/` 下，**不提交、不部署**，只是过程凭证）：

- `test-song-parser.mjs`：51 条解析用例全过（上表每一种写法都有一条）。
- `test-classifier-vs-data.mjs`：拿新分类器把库里 2916 首重判一遍，
  跟现有分类一致率 **73.5%**（改之前只有 19%）。剩下不一致的多是
  「Happy Song」这类名字里毫无线索的英文配乐 —— 纯本地关键词能做到的上限就在这儿。
- `verify-admin-refs.mjs`：确认删掉的五个徽章没有悬空引用、id 不重复、语法通过。
- `verify-admin-page.mjs` / `shot-admin-panels.mjs`：起一个**带假接口的本地服务**，
  用真实浏览器把四个面板 + 添加弹窗跑一遍，统计卡有数字、按钮文字对、**页面零报错**。

---

### 8）「添加歌曲」认得哪些写法（解析与分类规则）

站主给了一份 339 行的真实文件（`歌曲ID.txt`，从别处一条条攒的歌名 + ID），
要求「分析里面的歌曲种类，然后测试智能添加能不能应付不同格式」。跑完发现三处
**只在真实数据里才暴露**的毛病，都修了 —— 后端、数据库照旧一个字没动。

**① 发现并修好的三个问题**

| 问题 | 长什么样 | 原来会怎样 | 现在 |
| --- | --- | --- | --- |
| 一行里多组「ID+歌名」串在一起（**站主点名的格式**） | `难绷电音笑99474474122230 飞起来！112064181015623 嘿嘿嘿嗨104492649688505` | 整行文字全塞给第一个 ID，后面几条歌名全错 | 按 ID 把行切开，每段文字归给挨着它的那条；6 组全对，**而且每首自己判自己的分类** |
| 两串长 ID 粘成一个 30 位数字 | `112834898401032138570939058838`（其实是两个 15 位 ID） | 当成一条 30 位的怪 ID | 超过 16 位的数字自动拆开（先按本行其它 ID 的长度试等分） |
| 括号里直接写分类 | `95728570379323 《海浪》（中文摇滚）` | 歌名变成「海浪 中文摇滚」，还冒出「中文摇滚」这个站内没有的分类 | 认出来并归到站内分类（中文摇滚 → **摇滚金属**），歌名只剩「海浪」；对不上的括号（`（原版）`、`（Live）`）照旧留在歌名里 |

另外把关键词匹配收紧了一点：**≤4 个字母的英文词要求词首边界** ——
`BuildingDance` 不会再被 `ding` 命中（现在归电子舞曲），`white` 也不会被 `hit` 命中。
顺手删掉了会误伤的 `fun`（它把 83 首 `FUNK` 抢成了搞笑音效）。

**② 这份文件里都有什么种类**（解析后 250 首，按站内分类）

| 分类 | 首数 | 都是些什么 |
| --- | --- | --- |
| 中文流行 | 144 | 告白气球、花海、起风了、演员、芒种、红昭愿、兰亭序、童话镇、沙漠骆驼、安和桥…（名字里没风格线索的中文歌都落这儿，这是兜底栏） |
| 游戏动漫 | 22 | 奥特曼全家桶（赛文 / 欧布 / 雷欧 / 特利迦 / 赛迦 / 捷德 / 银河 / 奈克赛斯）、迷你世界系列、原神、进击巨人、蔚蓝档案、赛博朋克 |
| 电子舞曲 | 18 | 一堆「…DJ / DJ版」（起风了DJ、心做DJ版、不值得DJ…）、FUNK、MONTAGEM、Slowed 版 |
| 英文热门 | 16 | FindExit、SAIKAI、Rufo、Stay with me、misery、Imposter Syndrome… |
| 剧情情绪 | 15 | 伤感 / 落泪 / 回忆类 + 「进行曲」系列（祖国人进行曲、中长跑进行曲…） |
| 搞笑音效 | 10 | 哈基米系列、爆音、难绷电音笑、嘿嘿嘿嗨、萝莉进行曲炸麦 |
| 摇滚金属 | 9 | 站主自己标了「（中文摇滚）」的那 9 首：《海浪》《浴室》《闪光》《还愿》… |
| 古风国风 | 5 | 牵丝戏、红昭愿、琵琶曲、迷你世界中国风 |
| 舒缓治愈 | 4 | 治愈歌曲、失眠、森林、催眠术 |
| 影视节日 / 音效素材 | 各 2 | 新年、消散的光芒主题曲 / 和平精英死亡音效、三角符文爆炸音效 |
| 古典器乐 / 恐怖紧张 / 未分类 | 各 1 | CloneMovements / 追逐龙卷风豪庭 / J |

**③ 为了这份文件新加的关键词**（都是它里面成片出现的）：
奥特曼 / 特摄 / 迷你世界 / 蔚蓝档案 / 赛博朋克 / fnf / 特利迦 / 赛迦 / 奈克赛斯（→ 游戏动漫）、
哈基米 / 难绷 / 爆音 / 炸麦（→ 搞笑音效）、失眠（→ 舒缓治愈）、进行曲（→ 剧情情绪）、
happy / sunny / joy（→ 搞笑音效，库里那批 Happy Song 就在这栏）。
另外把「节日套话」提到最前面判，免得 `Happy Birthday` 被 `happy` 抢走。

**④ 验证**

- 解析用例从 51 条加到 **67 条**，新增的 16 条全是这份文件里的真实格式，全过。
- 整份 339 行贴进「➕ 添加歌曲」弹窗（真实浏览器 + 假接口本地服务）：
  预览显示「**认出 250 首**」（350 个 ID 出现次数，去重后 250 个），**0 条认不出歌名**，页面零报错。
- 跟库里 2916 首的旧分类对照：**73.3% 一致**（纯本地关键词的上限差不多就在这儿，
  剩下的多是 `Feeling Nature`、`Business Attire A` 这种名字里毫无线索的英文配乐）。

**⑤ 三处「我拿主意」的地方，不满意说一声就改**

1. `进行曲` → 剧情情绪（也可以改成电子舞曲或搞笑音效）；
2. `哈基米 / 爆音 / 炸麦` → 搞笑音效（要归音效素材也行）；
3. `CloneMovements` 因为名字里有 movement 被归到古典器乐（这条确实是误判，
   但同一个词在「Piano Sonata 3rd Movement」里又是对的，所以先留着）。

---

### 9）识别预览、屏幕适配、列表分页

**① 「🔎 认出 N 首」那块预览在正常屏幕上太小了 —— 站主反馈后改了**

| | 原来 | 现在 |
| --- | --- | --- |
| 字号 | 0.82rem | **0.95rem** |
| 高度 | 固定 176px（约 5 行） | **按屏幕算**：46vh、上限 420px，而且「能长就长」把剩余空间占满 |
| 行数 | 前 8 首 | 前 **14** 首 |
| 汇总行 | 会跟着滚走 | **粘在顶上**，翻到下面也知道认出了几首、各归哪类 |
| 格式说明 | 8 行一直摊开着，把预览挤小 | 改成**可折叠**（默认收起一行：「📖 支持哪些写法」） |

实测：1366×768 笔记本上预览 253px、1280×900 上 282px（原来 176px），
字号 15.2px，一次能看 12~14 行。

**② 手机 / 矮屏笔记本适配**（站主问「做了适配吗」——这块之前确实没做）

- **手机（宽度 ≤768px）**：弹窗内边距收紧、输入框降到 150px、预览按 40vh、
  「取消 / 确认添加」两个按钮**竖着排、各占一整行**；隔离区那个弹窗、添加鸣谢 /
  赞助者弹窗的按钮同样处理。
- **矮屏笔记本（高度 ≤820px，比如 1366×768）**：输入框降到 170px，把高度让给识别预览。
- 实测 390×844：弹窗 358×760 完整放得下、按钮各 324 宽、**没有横向滚动条**。

**③ 四个列表改成「100 组/页」（站主要求，样式照宝库页那套搬过来）**

歌曲管理 / 开发者隔离区 / 鸣谢名单（👑 赞助者 + 🎮 Roblox ID 宝库）现在都是每页 100 条：

- 分页器长得跟宝库页一模一样：`« ‹ 1 2 3 › »` + 下面一行
  「第 1 / 3 页 · 每页 100 条 · 共 230 条」（人用「人」，条用「条」）；
  页数多的时候只列当前页附近 + 首/末页，**窄屏自动收起「首页 / 末页」**。
- **总条数不到一页就整个藏起来**（跟宝库页行为一致，不影响现在的短列表）。
- 翻页后会自动把列表滚回可视区顶部，不用自己找。
- 鸣谢那栏是按**人**分页的（类别标题跟着人走，翻页后会再报一次当前类别）；
  赞助者那栏把「底档 + 后台添加」两段合成一个列表翻页，小标题照常分段显示。

**实测（假数据，`.verify/serve-admin-mock.mjs` 造的）**

| 列表 | 数据量 | 分页 | 每页 DOM 条数 |
| --- | --- | --- | --- |
| 🎶 歌曲管理 | 230 条 | 3 页（100 / 100 / **30**） | 100 |
| ⛔ 开发者隔离区 | 130 条 | 2 页 | 100 |
| ❤️ → 👑 赞助者 | 122 人（底档 2 + D1 120） | 2 页 | 100 |
| ❤️ → 🎮 Roblox ID 宝库 | 205 人 | 3 页 | 100 |

翻页、页码高亮、统计卡数字（D1 歌曲数量 230 / 隔离区 130 / 赞助者 122 / 鸣谢 205）
全部正常，页面零报错；上面这些都在**真实浏览器**里点过一遍。

---

### 10）赞助者、鸣谢、热门、统计与图标

**① 赞助者**

- 名单 = **后台（D1）那一份 + 仓库底档 `data/sponsors.json`**，按名字去重、**同名以后台为准**，
  不会重复显示；D1 里空着时用底档兜底，页面不至于开天窗。
- 后台「❤️ 鸣谢名单 → 👑 赞助者」里就一份名单（它管得到的那些），每条都是「✏️ 编辑 / 🗑️ 删除」，
  **删除就是真删**（D1 里删掉，后台列表和鸣谢页同时消失），没有隐藏、没有「恢复」、没有多余的统计卡。
- 底档文件里那几位**不受后台管**（网页改不了仓库文件）：照常显示，要改要删跟 AI 说一声，改文件后推送。
- 统计只有一张「赞助者人数」，数的是后台那一份。

**② 鸣谢名单（🎮 Roblox ID 宝库）**

- 每条都能「**✏️ 编辑**」：复用「➕ 添加鸣谢」弹窗（标题变「✏️ 编辑鸣谢」、按钮变「💾 保存修改」、
  类别用自定义下拉回显），保存走 `/api/thanks` 的 `action: 'update'`；删除照旧。
- 上面的统计是**每个类别一张卡**（现在 3 张：🎬 ID公益UP主/作者 / 📋 歌单整理者 / 💬 反馈贡献者），
  按 D1 里实际的类别动态生成 —— 以后加 / 删类别会自动多一张、少一张。

**③ 「🔥 热门推荐」按「100 组」算**

- `/api/hot/list` 支持 `?limit=`（默认 100、上限 500），宝库页取 `limit=500`，
  **按歌名合并成组后取前 100 组**（`HOT_GROUP_LIMIT`）—— 是 100 组，不是 100 个 ID。
- 实测：热门视图显示「共 100 组 · 108 个 ID」（100 组对应 108 个 ID，同名多 ID 算一组）。

**④ 统计卡与图标**

- 统计卡偏小一号：数字 1.3rem、标签 0.74rem、内边距 12px、栅格间距 10px（卡片高约 67px）。
- 后台「数据统计」的图标是 **📈**（标签栏 + 各面板标题一致）；想换别的搜 `admin.html` 里的 `📈 数据`。

**⑤ 花费数字**：`js/common.js` 最上面的 `SITE_COST`（首页赞赏码右边那一块），
改 `amount` 时顺手把 `checkedAt` 改成核对当天的日期，`index.html` 里没脚本时的兜底也一起改。
**2026-10-09 当前值：`¥184.47` / `2026-10-09`**（10-04 那天从 `¥141.51` → `¥151.36` → `¥153.54` 核了两次；10-05 又核了几次：`¥167.76` → `¥168.52` → `¥169.47` → `¥172.41` → `¥175.77`；10-07 核了两次：`¥180.04` → `¥182.03`；10-09 站主给了 `¥184.47`）；它右边那块「收到赞助」不用手改，见下面第 11 节。

---

### 11）2026-10-04 这一轮改了什么（8 项，用户逐条点名）

1. **首页公告条**从 `main` 里**搬到导航栏正下方**，并改成**横向滚动**（走马灯）：
   `index.html` 里 `<nav>` 后面那条 `.site-announce`，动画 `announceMarquee`，
   悬停 / 键盘聚焦暂停，`prefers-reduced-motion` 下不滚（只留第一份）。
2. 首页赞赏块右边加了**「收到赞助」**：`js/common.js` 的 `fillSponsorTotal()`
   按 **D1（`👑 赞助者` 的 `platform`）+ 底档 `data/sponsors.json`（`amount`）** 现算，
   同名以 D1 为准；接口挂了保留 HTML 兜底，绝不显示半份数据的错数。
   **当晚又按用户要求把「截至 xxxx-xx-xx」抽出来，做成两笔账共用的一行**
   （`.hero-sponsor-stats` = 整块 → `.hero-sponsor-nums` 两个数字 + `.hero-sponsor-stats-date` 共用日期；
   桌面压在两个数字下面居中，手机上整块换行、两个数字并排、日期在下一行）。
3. 花费数字 **`¥141.51` → `¥151.36` →（当晚又核一次）`¥153.54` →（2026-10-05）`¥167.76` → `¥168.52` → `¥169.47` → `¥172.41` → `¥175.77` →（2026-10-07）`¥180.04` → `¥182.03` →（2026-10-09）`¥184.47`**
   （`js/common.js` 的 `SITE_COST.amount` + `index.html` 的兜底；`checkedAt` 现在是 `2026-10-09`）。
4. **分享本站**：`js/common.js` 里新增 `buildShareModal()` / `openShareModal()` /
   `initShareTriggers()`（事件委托 `[data-invite]`），样式在 `css/style.css` 的
   「分享本站弹窗」段。零依赖、不联网：复制走 `copyText()`，手机上还能调 `navigator.share`。
   弹窗里四个按钮：**复制文案 + 链接 / 只复制文案 / 只复制链接 / 系统分享**——
   「只复制文案」是当晚按用户要求补的，复制的是 `SHARE_TEXT`（纯推荐语、不带网址）。
   **同一晚站主又提了几条**：① 「分享入口只有主页有」→ 于是 `index / feedback / thanks /
   roblox_music` 的**页脚都加了「🔗 分享本站」**（`.footer .zb-invite-link`）；
   ② 分享按钮颜色要「贴主题 + 护眼」→ 新加 `.zb-invite`（暖金：浅色淡金底 + 深金棕字
   ≈5.4:1，深色暖褐底 + 浅金字 ≈9.5:1），首页 hero 那颗换成了它；
   ③ **接着站主又改主意：宝库页不要分享**（「只删除分享，另外 2 个留着」＋
   「我只让你删除 Roblox ID 宝库的」）→ `roblox_music.html` 工具栏第三组「分享」整组删掉、
   页脚那个分享入口也撤掉，这一页回到「只有浏览 / 管理两组按钮 + 左下角返回首页」，
   **首页 / 反馈 / 鸣谢 三页的分享入口一个没动**。同时按站主要求**删掉了首页 hero 里的
   「💬 提个意见」按钮**——反馈入口还有导航栏的「💬 反馈」和页脚的「意见反馈」两处，不影响。
   ④ 紧接着站主又说「把所有页脚下面的如首页等内容都删除了」→ `index / feedback / thanks`
   三个页脚的导航链接（首页 / 意见反馈 / ID 宝库 / ❤️ 鸣谢）**全部删掉**，全站页脚统一只剩
   版权行；`roblox_music` 的页脚本就更没有链接，于是四页页脚口径完全一致
   （**分享入口保留** —— 站主明确说过分享按钮不要删；页脚那三个分享入口也因此在）。
   ⑤ 站主反馈「手机端有分享按钮、**电脑端没有**」，同一份 HTML/CSS/JS 在手机与无头浏览器
   （1366 / 1920 两种宽度）实测都能看到、也能点开，所以判断是**电脑上的广告拦截插件**
   把 class 里带 `share` 的元素整块隐藏了（中文拦截列表里这类规则很常见）。
   于是把分享相关的 **class / id / 属性全部改名为不含 share 的中性名字**：
   `btn-share → zb-invite`、`share-link → zb-invite-link`、
   `shareModal → inviteModal`、`shareText/shareCopy*/shareClose → invite*`、
   `data-share → data-invite`；**JS 仍然兼容老的 `[data-share]`**，老缓存页面照样能点开弹窗。
   行为、颜色、文案一点没变，只是不再撞拦截规则。
   ⑥ 最后站主又下了一条：「**任何页面的页脚都不要有分享链接**」→ 于是把 `index / feedback /
   thanks` 三个页脚的分享入口也删掉，四个页面的页脚现在**统一只剩版权行**。
   分享功能本身没删，**入口只剩首页 hero 那颗**（站主明确说过那颗不要删）。
5. **反馈的称呼 / 描述改成选填**，但**选「Roblox ID 宝库」（卡片1）时称呼必填**：
   `feedback.html`（标记 `.field-flag` + 提交前校验）和 `functions/api/feedback.js`
   （服务端再兜一道）都改了。称呼为空的反馈在后台显示成「（未填称呼）」，
   加入鸣谢时会兜成「匿名用户」。
6. ~~**鸣谢类别可以自定义**~~ —— **2026-10-05 已按站主要求删除**（原实现：`admin.html`
   下拉里的「✏️ 自定义类别…」+ 输入框 `#addThanksCustomCat`，`js/admin.js` 里
   `currentThanksCategory()` 取自定义输入，保存时给玩家感谢栏的类别补 `🙏 ` 前缀）。
   现在类别只能从「固定项 + D1 里已有的类别」里选，`syncThanksCategoryOptions()`
   照旧把 D1 里出现过的类别补进下拉（这是历史数据仍然选得到的原因）；
   下拉保留可滚动（`overflow-y: auto`），类别多了也点得到。
   历史实现见 `git show 4e559d0 -- admin.html js/admin.js`。
7. **隔离区加了「💬 去反馈」**（`roblox_music.html` 的 `.quarantine-footer`），
   跳 `feedback.html?type=card1&upload=1`，反馈页会预选类型、隔离区非空时顺手钩上上传。
8. **宝库页取消导航栏**：`<nav class="navbar">` 和页脚那排链接都删了，
   只在**左下角**留一个常驻的「🏠 返回首页」（`.back-home-fab`，`position: fixed`，
   `z-index: 950` 压在弹窗之下）；深色模式开关改挂到页头的 `[data-theme-slot]`，
   反馈入口挪进隔离区弹窗（见第 7 条）。**这一页也没有分享入口**（工具栏那组和页脚那个
   后来都按站主要求撤了，见第 4 条③），工具栏只剩「浏览」「管理」两组。

### 12）2026-10-07 这一轮改了什么（站主一次列了 8 件事）

> 站主原话：「以下任务实现后，做好适配。并且如果完成了这个任务，但是整个网站没有与之适配的
> 功能也加上（完成任务为主，思考是必须的，请添加记忆：不要过度思考）」，随后又补了一句
> 「任务完成后，我需要所有修改过地方的更新弹窗」。**这一轮动了 3 个页面 + 6 个接口 + 1 次迁移。**

1. **删掉鸣谢里的「💬 反馈贡献者」**（站主：「包括跟它有关的 D1 和文件等」）：
   `data/thanks.json` 里那一整块删掉、`admin.html` 类别下拉里那一项删掉，
   `thanks.html` 再加一道 `REMOVED_CATEGORY` **过滤**（D1 里那几行即使还没清也**不显示**）；
   D1 里的数据用 `migrations.sql` 第 3 组的 `DELETE FROM thanks WHERE category = '💬 反馈贡献者';` 清。
   ⚠️ 顺手删掉的还有反馈功能早就留下的 `page_updates` 里那行死数据（同一条 SQL 里）。
2. **宝库页「📋 复制全部」→「✏️ 信息出错」**（站主：「让玩家修改信息，然后点击『确定上报』
   然后上报到后台」「按钮颜色要区分开，但是要护眼」）：按钮在每首歌的右上角（`.btn-info-error`），
   点开 `#infoErrorModal`：**歌名 / 分类按当前值预填**（玩家在原文上改）、可选写一句说明，
   点「✅ 确定上报」→ `POST /api/invalid/report` 带 `type:'info'`，落到后台待处理。
   颜色用**琥珀色**（浅色 `#a97a2f` / 深色 `#e8b866` + 淡琥珀底），跟柔红的「🚫 无效处理」、
   中性的「📋 复制」都能一眼分开，也不刺眼（`.group-actions .btn-info-error`）。
   ⚠️ **「复制全部」这个功能随之取消**（站主要求「改成」，不是「再加一个」）；要整组复制
   可以逐个点「📋 复制」，想恢复整组复制就说一声。
3. **「📋 我上报的」→「📌 问题上报」，里面分两类**：`#myReportsModal` 里加了
   `#myRepTypeTabs`（`🚫 无效ID（N）` / `✏️ 信息出错（N）`），数据还是 `GET /api/invalid/mine`，
   接口多回了 `type` 与 `note`；「信息出错」那一类多一列「你写的说明」。
   撤回按钮统一叫「↩️ 撤回」/「↩️ 全部撤回（N）」（只撤当前这一类里后台待处理的那些）。
   ⚠️ 同一个人对**同一个 ID** 只会留一条上报：先报无效、后又点了「信息出错」，
   后台那条会按**最近一次**刷新类型（唯一键是 `(music_id, reporter)`，见 `report.js` 的说明）。
4. **旁边加「➕ 添加歌曲ID」**（站主：「让玩家把自己得到的歌曲ID上报上来，然后后台可以控制，
   这个放在 D1歌曲管理里面」）：`#submitSongModal` 填歌名 / 分类（选填）/ ID（一行一个，最多 20 个），
   `POST /api/songs/submit` → 落到 **D1 新表 `song_submissions`（待审核）**，
   **不直接进宝库**；后台「🎶 D1歌曲管理 → 📥 玩家投稿」里点「✅ 通过（加进 D1）」才写进
   `songs_extra`（那时宝库搜得到），点「🗑️ 不要」就丢掉。接口：`GET /api/songs/submissions`
   （按 ID 聚合的待审列表）+ `POST` 同地址 `{action:'approve'|'delete', ids}`。
5. **「🎶 歌曲管理」→「🎶 D1歌曲管理」**（子标签 + 面板标题一起改；面板 id 还是 `card1-songs`）。
6. **「🙈 已忽略」整段下线**（站主：「其实没必要，没有问题的上报的 ID 直接删除后台记录就行，
   Roblox ID 宝库里面谁将它上报了，谁的上报区里面就没有这个 ID 了，并且搜索这个歌曲仍然能在
   Roblox 搜索到」）：`admin.html` 那一段（含搜索框 / 分页 / 「🧹 清空已忽略」）删掉，
   后台只剩「🚫 待处理上报 / ✅ 已下架」两段；待处理每行多一颗 **「🗑️ 删除记录」**
   （批量那颗也从「🙈 批量忽略」改成「🗑️ 批量删除记录」），走
   `POST /api/invalid/handle {action:'delete-records'}` = **真删 `invalid_reports` 里那几条**：
   删完上报者自己的「📌 问题上报」里自然就没有这个 ID 了（同一张表），
   而 `quarantine_admin` / `songs_extra` **一概不碰** —— 歌还在，宝库照样搜得到。
   接口里原来的 `ignore` / `clear-ignored` 两个动作一起删掉；统计卡「已忽略」换成「其中信息出错」。
   D1 里的历史 `ignored` 行由迁移脚本那句 `DELETE FROM invalid_reports WHERE status = 'ignored';` 清。
7. **三个页面各弹一次更新弹窗**（站主：「我需要所有修改过地方的更新弹窗」）：
   `data/updates.json` 的 `index` → `V2.2.2`（天青 · 体验优化）、`roblox` → `V2.1.0`（紫罗兰 · 重大更新）、
   新增 `thanks` → `V1.1.0`（苔绿 · 修复更新）。文案只写访客能察觉到的变化，
   后台相关的一个字都没提（符合这个文件顶部那条硬规矩）。
   ⚠️ 站主没给成稿，这三段是**用他列的需求条目拼的**；要换成他自己的原话，改 `updates.json` 即可
   （`_说明` 里写着怎么改、主题色怎么选）。
8. **D1 迁移**（`migrations.sql` 第 3 组 + 第 4 组，站主要在 D1 Console 里跑一次）：
   ```sql
   ALTER TABLE invalid_reports ADD COLUMN type TEXT NOT NULL DEFAULT 'invalid';
   ALTER TABLE invalid_reports ADD COLUMN note TEXT;
   CREATE TABLE IF NOT EXISTS song_submissions ( ... );
   CREATE UNIQUE INDEX IF NOT EXISTS idx_song_sub_unique ON song_submissions(music_id, reporter);
   CREATE INDEX IF NOT EXISTS idx_song_sub_status ON song_submissions(status, music_id);
   DELETE FROM invalid_reports WHERE status = 'ignored';
   DELETE FROM thanks WHERE category = '💬 反馈贡献者';
   DELETE FROM page_updates WHERE page_key = 'feedback';

   CREATE TABLE IF NOT EXISTS report_notices ( ... );   -- 第 4 组：上报结果通知
   CREATE INDEX IF NOT EXISTS idx_notice_reporter ON report_notices(reporter, seen);
   ```
   `ALTER TABLE ... ADD COLUMN` 只能成功一次，第二遍会报 `duplicate column name` ——
   报这个错就跳过那两句，继续跑后面的（`CREATE` / `DELETE` 都可重复执行）。
   **代码在迁移之前也不会崩**：`type` 缺列时 `report.js` 会自动退回旧的 4 列写法
   （上报照旧进后台，只是少了类型与说明），`/api/notices/mine` 查不到表时当作「没有通知」。
   但**「添加歌曲ID」投稿必须有 `song_submissions` 表**，所以第 3 组最好尽快跑。
9. **更新弹窗大标题「再长也一行」**（站主：「4 个字很好看，大于 4 个字就换行，就变得很难看」）：
   `js/common.js` 的 `fitUpdateTitle()` —— **先上屏、再用 Range 量文字真实宽度、再缩**：
   ① 只收字距 5px→1px；② 还不够再收字号 30px→16px；③ 都到下限才允许折行并用
   `text-wrap: balance` 让两行接近。预算宽度 = `css/update-modal.css` 里 `.left-block` 的
   `max-width: 420px`（原来左块是 `flex: 0 1 auto` 会被挤到 ~110px，所以连 4 个字都折行 —— 那才是病根）。
   实测：4/6/8/12 字全程 30px + 5px 一行；17 字自动缩到 24px + 1px 仍是一行。
   ⚠️ 两个坑写在这儿免得再踩：① 量尺必须放在 `fitCanvas()` 里（canvas 宽度是那一步才定下来的）；
   ② Chrome 里 `white-space` 是**简写**（含 text-wrap-mode），`el.style.textWrap = ''` 会把
   `whiteSpace = 'nowrap'` 一起清掉 —— 顺序必须是「先清 text-wrap、最后设 white-space」。
10. **「✏️ 信息出错管理」独立子面板**（站主：「卡片管理，Roblox ID 宝库中加一个信息出错管理」）：
    第二级子标签从 2 个变 3 个（`card1-songs` / `card1-invalid` / `card1-info`）。
    它跟「🚫 无效音乐ID管理」共用 `/api/invalid/list` 那份缓存，前端按 `infoCount > 0` 分栏：
    信息出错的条目只在**新面板**里出现（每行带玩家改好的歌名/分类 + 说明 + 操作），
    无效那一栏只放无效上报；统计卡也跟着分开（无效面板 3 张、信息出错面板 2 张）。
11. **「📥 玩家投稿」改成并列子标签**（站主：「不要放在最下面，跟『待处理上报』和『已下架』一样并列」）：
    `#card1-songs` 里加了 `#songSegTabs`（`🎶 歌曲列表` / `📥 玩家投稿`），两块是**同级** `.subpanel`
    （`#songs-list` / `#songs-submissions`），不再一个套在另一个下面。
12. **「以无效为主」**（站主：「如果他点了无效，就不能修改信息」）：
    · 访客端：这一组只要报过无效，`✏️ 信息出错` 按钮就置灰（`.blocked` + `aria-disabled`），
      点了不开弹窗，只提示并把「📌 问题上报」打开到「🚫 无效ID」那一栏；撤回后自动恢复可点
      （`groupHasInvalidReport()` / `syncInfoErrorBtn()`，上报与撤回两条路都会同步）。
    · 服务端：`report.js` 先查这个身份在这个 ID 上是否已有 `type='invalid'` 的待处理记录，
      是则**整条跳过**并回 `blocked:N`，前端据此如实提示。
13. **站长下架 / 删记录 → 上报的人收到我们自己的弹窗**（站主：「上报的人都会收到弹窗提示，
    弹窗是我们自己的」）：新表 `report_notices`（第 4 组迁移）；
    `invalid/handle.js` 在 `remove` 时写 `kind='removed'`、在 `delete-records` 时写 `kind='deleted'`
    ——⚠️ 删记录那条链是**先写通知、再删上报记录**（记录删了就查不到 reporter 了）；
    访客端 `js/common.js` 的 `checkReportNotices()` 在每个页面打开 1.2 秒后查一次
    （`GET /api/notices/mine?reporter=`，同一标签页用 sessionStorage 只查一次），
    有未读就弹 `.modal` 那套**自己的弹窗**（最多列 5 条），点「我知道了」→ `POST` 标已读。
    接口挂了 / 没跑迁移 → 静默跳过，绝不弹错误框打扰访客。
14. **按钮胶囊**（站主：「提交投稿的按钮样式不好看，不是胶囊的」）：
    `.btn-info-confirm`（「✅ 确定上报 / 提交投稿」共用）补上 `border-radius: var(--radius-pill)`
    + 对齐其它弹窗按钮的内边距，跟「关闭」那颗圆角一致（实测都是 50px）。

**这一轮的验收**：`.verify/lead-round1007-check.mjs`（42 项）+ `.verify/lead-round1007b-check.mjs`（34 项）
+ `.verify/lead-update-title-check.mjs`（11 项，4/6/8/12/17 字 + 手机档 + 截图）
都是真浏览器 + 真请求体；连同 10 个既有用例一起跑，**合计 314 项全绿**。
此外花费数字 **`¥182.03` → `¥184.47`**，核对日期改成 **`2026-10-09`**
（`js/common.js` 的 `SITE_COST.amount` + `index.html` 兜底 + 这个 README 第 11 节那条流水）。
