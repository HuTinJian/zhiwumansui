-- ============================================================
-- 织雾满穗 · D1 建表语句
-- 用法：部署前在 Cloudflare D1 控制台执行一次
-- ============================================================

-- 反馈表
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  message TEXT NOT NULL,
  want_thanks INTEGER DEFAULT 0,
  upload_quarantine INTEGER DEFAULT 0,
  quarantine_ids TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  client_id TEXT,
  reply TEXT,
  decided_at TEXT
);

-- 社区账号（发帖 / 评论需要登录；浏览不需要）
CREATE TABLE IF NOT EXISTS blog_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  avatar TEXT,                     -- 自定义头像：一个 emoji，或一个 http(s) 图片直链
  banned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 玩家社区（卡片2 · 玩家交流）
-- parent_id 为 NULL 是主帖，否则是对某条内容的评论（只做一层嵌套）
CREATE TABLE IF NOT EXISTS blog_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER,
  user_id INTEGER,
  name TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  cover TEXT,
  tags TEXT,
  kind TEXT,                       -- 板块：resource/game/bug/idea/chat（见 _moderation.js 的 KINDS）
  client_id TEXT,
  likes INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  reports INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  status TEXT DEFAULT 'visible',
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  edited_at TEXT                   -- 最后一次编辑时间（没编辑过就是空）
);

-- 每人每帖只能点一次赞
CREATE TABLE IF NOT EXISTS blog_likes (
  post_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  PRIMARY KEY (post_id, client_id)
);

-- 每人每帖只能举报一次
CREATE TABLE IF NOT EXISTS blog_reports (
  post_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  PRIMARY KEY (post_id, client_id)
);

-- 博客封禁名单（按浏览器身份 client_id 拉黑）
CREATE TABLE IF NOT EXISTS blog_bans (
  client_id TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 开发者隔离区
CREATE TABLE IF NOT EXISTS quarantine_admin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  music_id TEXT NOT NULL UNIQUE,
  name TEXT,
  category TEXT,
  source TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 后台加的新歌
CREATE TABLE IF NOT EXISTS songs_extra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  music_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT DEFAULT '未分类',
  line_index INTEGER DEFAULT 100000,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 鸣谢名单
CREATE TABLE IF NOT EXISTS thanks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT,
  message TEXT,
  feedback_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 版本信息（page_key 必须 UNIQUE，ON CONFLICT 才能生效）
CREATE TABLE IF NOT EXISTS page_updates (
  page_key TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  date TEXT NOT NULL,
  updates TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 热门统计
CREATE TABLE IF NOT EXISTS hot_songs (
  music_id TEXT PRIMARY KEY,
  copy_count INTEGER DEFAULT 0,
  play_count INTEGER DEFAULT 0,
  fav_count INTEGER DEFAULT 0,
  last_updated TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 访问渠道
CREATE TABLE IF NOT EXISTS visit_sources (
  user_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 索引：加速常用查询
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(id DESC);
CREATE INDEX IF NOT EXISTS idx_thanks_category ON thanks(category, id);
CREATE INDEX IF NOT EXISTS idx_songs_line ON songs_extra(line_index);