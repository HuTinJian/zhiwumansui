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
-- 【怎么跑】
--   Cloudflare 控制台 → D1 → 选中你的库 → Console（查询编辑器）
--   把下面语句一条一条粘进去执行即可。
--
--   ⚠️ 如果某条报 `duplicate column name: xxx`，说明这个字段之前已经加过了，
--      直接跳过它、继续执行下一条就行，不影响其它语句。
-- ============================================================


-- ---------- 1. 反馈：浏览器身份 + 处理结果回执 ----------
-- client_id：游客浏览器的稳定标识，用来把「处理结果」回传给提出问题的那个人
-- reply    ：管理员给的一句话说明（选填）
-- decided_at：受理 / 拒绝的时间
ALTER TABLE feedback ADD COLUMN client_id TEXT;
ALTER TABLE feedback ADD COLUMN reply TEXT;
ALTER TABLE feedback ADD COLUMN decided_at TEXT;

-- 加速「查我自己的反馈」这个查询
CREATE INDEX IF NOT EXISTS idx_feedback_client ON feedback(client_id);


-- ---------- 2. 博客（卡片2 · 玩家交流） ----------
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

-- 每人每帖只能举报一次（防止一个人连点三次就把别人的帖子刷下线）
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
