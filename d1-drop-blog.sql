-- ============================================================
-- 织雾满穗 · 删掉「玩家社区（卡片2）」在 D1 里的全部数据
-- ------------------------------------------------------------
-- 什么时候跑：2026-09-29 起，玩家社区功能已经从代码里整个删掉了
--   （blog.html、functions/api/blog/*、后台的社区管理面板），
--   这个文件负责把数据库里剩下的那张五张表也清掉。
--
-- 【怎么跑】（和跑 migrations.sql 一样，二选一）
--   ① 网页版（推荐，什么都不用装）
--      Cloudflare 面板 → Workers & Pages → D1 → 选中你的库 → Console
--      把下面 DROP TABLE 那五行一条一条粘进去执行。
--      报 `no such table: xxx` 是正常的 —— 说明那张表本来就没建过，跳过继续。
--
--   ② 命令行版（在你自己电脑的终端里，项目根目录）
--      npx wrangler d1 execute <你的库名> --remote --file=./d1-drop-blog.sql
--
-- ⚠️ 这是【不可撤销】的操作：DROP TABLE 会把帖子和账号一起删掉，
--    删完没法找回（除非你有别的备份）。确认不要了再执行。
--    删完之后 localStorage / Cookie 里可能还留着旧的登录 Cookie
--    （zm_blog_user），那只是块没用的 cookie，过期后自然消失，不用管。
-- ============================================================

-- 帖子 + 评论（主表）
DROP TABLE IF EXISTS blog_posts;

-- 点赞记录
DROP TABLE IF EXISTS blog_likes;

-- 举报记录
DROP TABLE IF EXISTS blog_reports;

-- 按浏览器身份拉黑的名单
DROP TABLE IF EXISTS blog_bans;

-- 社区账号（注册 / 登录用）
DROP TABLE IF EXISTS blog_users;


-- ------------------------------------------------------------
-- 下面这几条【可选】，看你要不要顺手做：
--
-- 1) 反馈表里 type 是「卡片2」的老反馈（玩家社区提交的那些），
--    现在这一项已经从反馈表单里删掉了，老数据留着只会在后台列表里看到。
--    想把它们一起删掉：
--      DELETE FROM feedback WHERE type = '卡片2';
--    （只是想看看到底有多少条：
--      SELECT COUNT(*) FROM feedback WHERE type = '卡片2'; ）
--
-- 2) 更新公告表 page_updates：2026-09-29 起公告改读仓库里的
--    data/updates.json（后台的「更新管理」已下线），这张表已经用不到了。
--    functions/api/updates.js 只在静态文件读不到时当备胎，所以
--    【建议先别删】—— 留着不占地方，也算一层保险。
-- ------------------------------------------------------------
