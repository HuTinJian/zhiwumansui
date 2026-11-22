/* ============================================================
   织雾满穗 · 功能建议表的「自修复」建表
   ------------------------------------------------------------
   为什么有它（2026-11-23）：
     Cloudflare 的 API Token 是账号级、且没有「列账户」权限，拿不到
     account_id 就没法用 REST 直接跑 D1 迁移。与其让站主去控制台手动
     粘 SQL，不如让接口在第一次真正用到时自己把表建好：
       · 表不存在 → CREATE TABLE IF NOT EXISTS + 两个索引；
       · 表已存在 → 什么也不做（每个 isolate 只跑一次，结果缓存）。
   安全性：只建这一张固定表，SQL 全部写死在代码里，不接受任何外部
     输入；不读、不删、不改已有数据。公开的只有 health.js 一个自检口，
     它也只返回表名。
   【回退】删掉本文件 + 三个接口里的 ensure 调用 + health.js；
     已建好的表留在 D1 里，不影响数据。
   ============================================================ */

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS feature_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    chapter TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_feature_suggest_status ON feature_suggestions(status, id)',
  'CREATE INDEX IF NOT EXISTS idx_feature_suggest_created ON feature_suggestions(created_at)'
];

/* 每个 isolate 只跑一次；D1 的 IF NOT EXISTS 本身也可重复执行，
   这个缓存只是为了省掉每次请求的 3 条 DDL。 */
let ready = false;

export async function ensureFeatureSuggestionsTable(env) {
  if (ready) return;
  if (!env || !env.DB) throw new Error('DB binding missing');

  for (const sql of STATEMENTS) {
    await env.DB.prepare(sql).run();
  }
  ready = true;
}
