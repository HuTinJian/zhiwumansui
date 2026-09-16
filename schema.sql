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