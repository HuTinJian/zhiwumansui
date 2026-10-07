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
--      把第 1 组的三条 ALTER 一条一条执行
--      （某条报 `duplicate column name: xxx` 是正常的，说明那个字段之前加过了，
--        跳过它继续执行后面的就行），最后跑一下那条索引。
--
--   ② 命令行版（要在你自己电脑的终端里跑，不是在 Cloudflare 网页里）
--      需要先装 Node.js，然后在项目根目录执行：
--        npx wrangler d1 execute <你的库名> --remote --file=./migrations.sql
--
-- 【2026-09-29 大改动】
--   原来第 2～5 组全是「玩家社区（卡片2）」的建表和加字段语句
--   （blog_posts / blog_users / blog_likes / blog_reports / blog_bans、
--     kind / avatar / edited_at …）。玩家社区已经整个删除：
--   前端页面、functions/api/blog/* 接口、后台管理面板、D1 表都不要了，
--   所以那些语句从这里一并删掉 —— 免得哪天照着重跑，又把表建回来。
--   老库里已经建好的那五张表，按《d1-drop-blog.sql》里的语句 DROP 掉即可。
--
-- 【2026-10-05 大改动】
--   反馈功能整体下线：feedback.html、functions/api/feedback* 全部删除，
--   feedback 表保留仅供考古（不读不写，也不要 DROP）。
--   新增「无效音乐 ID 上报」链路 → 见文件最后的第 2 组（可重复执行，不会报错）。
--   第 1 组那三条 ALTER 只对考古老库有意义，新库不用跑。
-- ============================================================


-- ---------- 第 1 组：给 feedback 补三个字段（请一条一条执行） ----------
-- client_id ：游客浏览器的稳定标识，用来把「处理结果」回传给提出问题的那个人
-- reply     ：管理员给的一句话说明（选填）
-- decided_at：受理 / 拒绝的时间
ALTER TABLE feedback ADD COLUMN client_id TEXT;

ALTER TABLE feedback ADD COLUMN reply TEXT;

ALTER TABLE feedback ADD COLUMN decided_at TEXT;

-- 加速「查我自己的反馈」这个查询
CREATE INDEX IF NOT EXISTS idx_feedback_client ON feedback(client_id);


-- ---------- 第 2 组：无效音乐 ID 上报（2026-10-05 新增） ----------
-- 这一组【可以整段重复执行】：全部是 IF NOT EXISTS，跑第二遍也不会报错，
-- 所以网页版 D1 Console 里直接把下面四条一起粘进去执行就行。
-- 表结构说明见 schema.sql 里的注释（status：pending / ignored / removed）。
CREATE TABLE IF NOT EXISTS invalid_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  music_id TEXT NOT NULL,
  name TEXT,
  category TEXT,
  reporter TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invalid_unique ON invalid_reports(music_id, reporter);

CREATE INDEX IF NOT EXISTS idx_invalid_status ON invalid_reports(status, music_id);


-- ---------- 第 3 组：上报分两类 + 玩家歌曲投稿（2026-10-07 新增） ----------
-- 站主这一轮的要求：
--   ① 「问题上报」里要分「🚫 无效ID」和「✏️ 信息出错」两类 → 给 invalid_reports 加 type / note；
--   ② 「已忽略」不要了（没问题的上报直接删记录）→ 顺手把历史 ignored 行清掉；
--   ③ 玩家能「添加歌曲ID」投稿，**后台控制**后才进 D1 歌曲 → 新建 song_submissions 待审核表；
--   ④ 鸣谢里的「💬 反馈贡献者」整类删掉（反馈功能早就下线了）。
-- ⚠️ ALTER TABLE ADD COLUMN 只在第一次执行成功；第二次会报「duplicate column name」——
--    报这个错说明这一列已经有了，跳过继续执行后面的语句即可（D1 Console 里可以只选后面几句再跑）。
ALTER TABLE invalid_reports ADD COLUMN type TEXT NOT NULL DEFAULT 'invalid';
ALTER TABLE invalid_reports ADD COLUMN note TEXT;

CREATE TABLE IF NOT EXISTS song_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  music_id TEXT NOT NULL,
  name TEXT,
  category TEXT,
  reporter TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_song_sub_unique ON song_submissions(music_id, reporter);
CREATE INDEX IF NOT EXISTS idx_song_sub_status ON song_submissions(status, music_id);

-- 清理历史数据（可重复执行，删不到东西也不会报错）
DELETE FROM invalid_reports WHERE status = 'ignored';
DELETE FROM thanks WHERE category = '💬 反馈贡献者';
DELETE FROM page_updates WHERE page_key = 'feedback';


-- ---------- 第 4 组：给上报的人留个通知（2026-10-07 新增） ----------
-- 站主原话：「我如果下架了歌曲ID或者是删除了记录，上报的人都会收到弹窗提示，弹窗是我们自己的」。
-- 做法：站长在后台做「✅ 确认无效并下架」或「🗑️ 删除记录」时，顺手给**当时报过这个 ID 的人**
-- 各写一条通知（下面这张表）；访客下次打开任意页面时，js/common.js 会拉一次未读通知，
-- 有就弹**我们自己的弹窗**（不是浏览器的通知），点「我知道了」回写 seen=1，之后不再弹。
-- ⚠️「删除记录」那条链是**先写通知、再删上报记录**（记录删了就查不到 reporter 了）。
CREATE TABLE IF NOT EXISTS report_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter TEXT NOT NULL,
  music_id TEXT NOT NULL,
  name TEXT,
  kind TEXT NOT NULL DEFAULT 'deleted',   -- removed = 已下架；deleted = 上报记录被删（歌还在）
  seen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_notice_reporter ON report_notices(reporter, seen);
