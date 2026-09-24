-- ============================================================
-- 织雾满穗 · 增量迁移（老库专用）
-- ------------------------------------------------------------
-- 全新部署不用管这个文件：直接跑 schema.sql 就是最新的表结构。
--
-- 【什么情况下要跑这个】
--   你的 D1 数据库是之前建的、feedback 表已经在用了，
--   那么单纯重跑 schema.sql 不会给已有的表补上新字段
--   （CREATE TABLE IF NOT EXISTS 见到表存在就跳过了）。
--
-- 【⚠️ 怎么跑 —— 这里最容易搞错】
--   Cloudflare 网页上的 D1 Console 是一个【SQL 查询框】，只认 SQL 语句。
--   所以千万不要把 `npx wrangler ...` 那种命令行粘进去，
--   那样只会得到一句 `near "npx": syntax error`。
--
--   两种正确做法，选一种：
--
--   ① 网页版（推荐，什么都不用装）
--      Cloudflare 面板 → Workers & Pages → D1 → 选中你的库 → Console
--        · 先一条一条执行下面第 1 组的 3 条 ALTER
--          （某条报 `duplicate column name: xxx` 是正常的，说明那个字段之前加过了，
--            跳过它继续执行后面的就行）
--        · 再整个执行第 2 组（建表 + 索引）
--        · 第 3 组（博客账号表 blog_users + 内容的新字段）
--        · 第 4 组（社区板块字段 kind）
--
--      ⚠️ 四组都要跑，别在中途停手。漏跑的症状很好认：
--         · 漏了第 3 组的 blog_users → 浏览正常，但「注册 / 登录」一律报
--           「出错了：server error」（注册和登录都要读写这张表）。
--         · 漏了第 4 组的 kind → 社区页顶部会自己弹一条提示，
--           告诉你缺哪个字段、该跑哪句 SQL（页面不会崩，发帖也能用，
--           只是所有内容暂时都归到「💬 闲聊」）。
--         新功能一律做了「缺字段就降级」的兜底，所以漏跑不会白屏，
--         但会少一块功能 —— 看到提示就补跑对应的那一句即可。
--
--   ② 命令行版（要在你自己电脑的终端里跑，不是在 Cloudflare 网页里）
--      需要先装 Node.js，然后在项目根目录执行：
--        npx wrangler d1 execute <你的库名> --remote --file=./migrations.sql
-- ============================================================


-- ---------- 第 1 组：给 feedback 补三个字段（请一条一条执行） ----------
-- client_id ：游客浏览器的稳定标识，用来把「处理结果」回传给提出问题的那个人
-- reply     ：管理员给的一句话说明（选填）
-- decided_at：受理 / 拒绝的时间
ALTER TABLE feedback ADD COLUMN client_id TEXT;

ALTER TABLE feedback ADD COLUMN reply TEXT;

ALTER TABLE feedback ADD COLUMN decided_at TEXT;


-- ---------- 第 2 组：索引与博客表（可以整段一起执行） ----------

-- 加速「查我自己的反馈」这个查询
CREATE INDEX IF NOT EXISTS idx_feedback_client ON feedback(client_id);

-- 博客（卡片2 · 玩家交流）
-- parent_id 为 NULL 是主帖（文章），否则是对某篇文章的评论（只做一层嵌套）
CREATE TABLE IF NOT EXISTS blog_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER,
  name TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  client_id TEXT,
  likes INTEGER DEFAULT 0,
  reports INTEGER DEFAULT 0,
  status TEXT DEFAULT 'visible',
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS blog_likes (
  post_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  PRIMARY KEY (post_id, client_id)
);

-- 每人每篇只能举报一次（防止一个人连点三次就把别人的文章刷下线）
CREATE TABLE IF NOT EXISTS blog_reports (
  post_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  PRIMARY KEY (post_id, client_id)
);

CREATE TABLE IF NOT EXISTS blog_bans (
  client_id TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_blog_parent ON blog_posts(parent_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_blog_status ON blog_posts(status, id DESC);


-- ---------- 第 3 组：博客账号 + 封面 / 标签 / 浏览量 / 置顶 ----------
-- 同样是「已存在会报 duplicate column，跳过继续」那一套。

-- 登录功能：发帖和评论需要登录，浏览不需要。
-- 密码只存「盐 + SHA-512 哈希」，不存明文。
CREATE TABLE IF NOT EXISTS blog_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  banned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 内容的新字段
ALTER TABLE blog_posts ADD COLUMN user_id INTEGER;   -- 作者账号 id
ALTER TABLE blog_posts ADD COLUMN cover TEXT;        -- 封面图地址（选填，不填就用自动渐变封面）
ALTER TABLE blog_posts ADD COLUMN tags TEXT;         -- 标签，英文逗号分隔
ALTER TABLE blog_posts ADD COLUMN views INTEGER DEFAULT 0;    -- 浏览量
ALTER TABLE blog_posts ADD COLUMN pinned INTEGER DEFAULT 0;   -- 是否置顶

CREATE INDEX IF NOT EXISTS idx_blog_user ON blog_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_blog_pinned ON blog_posts(pinned, id DESC);


-- ---------- 第 4 组：社区板块（2026-09-24 起，博客改成「玩家社区」） ----------
-- kind 存板块 id：resource 资源分享 / game 游戏交流 / bug BUG反馈 / idea 建议 / chat 闲聊
-- （取值清单在 functions/api/blog/_moderation.js 的 KINDS，前后端必须一致）
--
-- 漏跑也能用：社区页会自己提示缺这个字段，浏览和发帖都照常，
-- 只是所有内容暂时都归到「💬 闲聊」。跑完这一句就正常了。
ALTER TABLE blog_posts ADD COLUMN kind TEXT;

-- 按板块筛列表时用得上
CREATE INDEX IF NOT EXISTS idx_blog_kind ON blog_posts(kind, id DESC);


