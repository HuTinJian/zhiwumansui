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
