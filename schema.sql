-- ============================================================
-- 织雾满穗 · D1 建表语句
-- 用法：部署前在 Cloudflare D1 控制台执行一次
-- ============================================================

-- 2026-11-07：站主要求「建议和反馈的页面删除了！包括跟 D1，后台有关的内容」——
-- 旧「反馈表」（2026-09 那版）不再纳入新库建表，索引也一并去掉。
-- ⚠️ 已有老库里的 feedback 表/数据**没有删**（删了不可回退）；确定不要时按
--    migrations.sql 第 6 组末尾那条「可选」DROP 手动执行。

-- 2026-09-29：原来这里还有玩家社区（卡片2）的五张表 ——
--   blog_users / blog_posts / blog_likes / blog_reports / blog_bans。
-- 用户要求把玩家社区及其数据全部删除，所以建表语句一并去掉，
-- 老库里那五张表请用 README 里的清理 SQL（或 d1-删除玩家社区.sql）手动 DROP。

-- 无效音乐 ID 上报（2026-10-05 新增；替代旧「访客隔离区 + 反馈上传」那条链路）
-- 访客上报 → 管理员在后台确认（remove 写入 quarantine_admin / delete-records 标记已审核），
-- status：pending 待处理 | ignored 已忽略（历史遗留） | removed 已下架
--         | noted 已审核·无需处理（2026-10-17 新增：后台「🗑️ 删记录」不再是真删行，
--           改成标这个状态，好让上报者能查到「我报的过没过审核」）
-- ⚠️ noted 是纯 TEXT 取值，不需要改表结构、不需要跑迁移。
CREATE TABLE IF NOT EXISTS invalid_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  music_id TEXT NOT NULL,
  name TEXT,
  category TEXT,
  reporter TEXT NOT NULL DEFAULT '',      -- 匿名浏览器身份（前端 getClientId()），用于去重与撤销
  status TEXT NOT NULL DEFAULT 'pending', -- pending | ignored | removed | noted
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

-- 玩家投稿（「➕ 添加歌曲ID」→ 后台「📥 玩家投稿」审核）用的待审核表在 migrations.sql 第 3 组建；
-- 2026-10-17 起它多一列 note（玩家写的「说明」），见 migrations.sql 第 5 组。

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

-- 2026-11-07：赞助登记（站内登记 + 站主后台人工核对，替代「爱发电没有回调」的空缺）
-- 流程：/support 填昵称 + 爱发电订单号 → 这里 pending → 后台确认后才写进 thanks 表
CREATE TABLE IF NOT EXISTS sponsor_regs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  order_no TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'custom',
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  amount TEXT,
  thanks_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  confirmed_at TEXT
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
CREATE INDEX IF NOT EXISTS idx_thanks_category ON thanks(category, id);
-- 2026-11-07：同一张爱发电订单只能登记一次（重复提交返回 409，不会写两条）
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_reg_order ON sponsor_regs(order_no);
CREATE INDEX IF NOT EXISTS idx_sponsor_reg_status ON sponsor_regs(status, id);
CREATE INDEX IF NOT EXISTS idx_songs_line ON songs_extra(line_index);
-- 2026-10-05：无效上报的唯一键（同一浏览器对同一个 ID 只算一条）+ 按状态取列表
CREATE UNIQUE INDEX IF NOT EXISTS idx_invalid_unique ON invalid_reports(music_id, reporter);
CREATE INDEX IF NOT EXISTS idx_invalid_status ON invalid_reports(status, music_id);

-- ============================================================
-- 2026-11-07：原来的「💡 建议」与「🐞 反馈」两张表（suggestions / site_feedback）
-- 连同两个页面、两个 submit 接口、/api/inbox 接口、后台「📬 建议/反馈」面板
-- 已按站主要求【整块删除】，所以这里不再建表。
-- 已有 D1 里那两张表请跑 migrations.sql 第 6 组（DROP TABLE）清掉。
-- ============================================================