-- ============================================================
-- 织雾满穗 · 只建「功能建议」这一张表（2026-11-23）
-- ------------------------------------------------------------
-- 用途：老库升级。整份 migrations.sql 里前面几组有 ALTER TABLE，
--       在老库上重复跑会报 duplicate column；这一份只含功能建议，
--       可以放心重复执行（全是 IF NOT EXISTS）。
-- 用法（在仓库根目录）：
--   npx wrangler d1 execute zhimist-db --remote --file=./d1-add-feature-suggestions.sql
-- 或者：Cloudflare 控制台 → D1 → zhimist-db → Console，把下面几行贴进去执行。
-- 【回退】DROP TABLE IF EXISTS feature_suggestions;
-- ============================================================

CREATE TABLE IF NOT EXISTS feature_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  chapter TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_feature_suggest_status ON feature_suggestions(status, id);
CREATE INDEX IF NOT EXISTS idx_feature_suggest_created ON feature_suggestions(created_at);
