-- ============================================================
-- 织雾满穗 · D1 建表语句
-- 用法：部署前在 Cloudflare D1 控制台执行一次
-- ============================================================

-- 反馈表
-- 2026-10-05：反馈功能已整体下线（feedback.html、functions/api/feedback* 均已删除），
-- 这张表保留仅供考古 —— 不再有任何代码读写它，也不要 DROP（老数据留档）。
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

-- 2026-09-29：原来这里还有玩家社区（卡片2）的五张表 ——
--   blog_users / blog_posts / blog_likes / blog_reports / blog_bans。
-- 用户要求把玩家社区及其数据全部删除，所以建表语句一并去掉，
-- 老库里那五张表请用 README 里的清理 SQL（或 d1-删除玩家社区.sql）手动 DROP。

-- 无效音乐 ID 上报（2026-10-05 新增；替代旧「访客隔离区 + 反馈上传」那条链路）
-- 访客上报 → 管理员在后台确认（remove 写入 quarantine_admin / ignore 标记忽略），
-- status：pending 待处理 | ignored 已忽略 | removed 已下架
CREATE TABLE IF NOT EXISTS invalid_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  music_id TEXT NOT NULL,
  name TEXT,
  category TEXT,
  reporter TEXT NOT NULL DEFAULT '',      -- 匿名浏览器身份（前端 getClientId()），用于去重与撤销
  status TEXT NOT NULL DEFAULT 'pending', -- pending | ignored | removed
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 开发者隔离区（界面文案已改叫「已下架」，表名保持不变，静态快照与前台隐藏逻辑都靠它）
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
-- 2026-10-05：无效上报的唯一键（同一浏览器对同一个 ID 只算一条）+ 按状态取列表
CREATE UNIQUE INDEX IF NOT EXISTS idx_invalid_unique ON invalid_reports(music_id, reporter);
CREATE INDEX IF NOT EXISTS idx_invalid_status ON invalid_reports(status, music_id);