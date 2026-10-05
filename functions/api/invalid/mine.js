/* ============================================================
   织雾满穗 · 查「我自己上报过的无效 ID」（公开，按浏览器匿名身份过滤）
   2026-10-05：站主要求宝库页加一张「上报表」—— 访客能看到自己点过
   「🚫 无效处理」的歌，还能单条恢复 / 全部恢复（本质上就是只属于自己的那份隔离区）。
   ------------------------------------------------------------
   安全口径（重要，别放宽）：
   · reporter 必填且必须合法，**不合法一律 400**。绝不能「不传 reporter 就返回全部」——
     那样会把别人（尤其是 reporter = '' 那批没带身份的）的上报列出来。
   · 只返回这一条身份自己的记录，字段只给访客用得上的：id / 名字 / 分类 / 状态 / 时间。
   · 这个接口**只读**：恢复（撤销）仍然走 POST /api/invalid/withdraw（那边同样只删自己那条）。
   · 限速与上报同口径：同一身份 10 分钟 60 次。
   ============================================================ */

import { json, createRateLimiter } from '../_utils.js';

/* 浏览器匿名身份（前端 getClientId()）：小写字母数字 8~64 位 */
const REPORTER_PATTERN = /^[a-z0-9]{8,64}$/;

/* 一次最多回 200 条（新的在前）—— 表太长也没人看，恢复按钮在页面上还能批量操作 */
const MAX_ROWS = 200;

const limiter = createRateLimiter(60, 10 * 60 * 1000);

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const reporter = String(url.searchParams.get('reporter') || '').trim().toLowerCase();
    if (!REPORTER_PATTERN.test(reporter)) {
      return json({ ok: false, error: 'missing reporter' }, 400);
    }

    const limit = limiter.check(reporter);
    if (!limit.ok) {
      return json({ ok: false, error: 'too many requests', wait: limit.wait }, 429);
    }

    const result = await env.DB.prepare(
      `SELECT music_id, name, category, status, created_at
         FROM invalid_reports
        WHERE reporter = ?
        ORDER BY id DESC
        LIMIT ?`
    ).bind(reporter, MAX_ROWS).all();

    const items = (result.results || []).map(row => ({
      id: String(row.music_id),
      name: row.name || '',
      category: row.category || '',
      /* pending = 后台还没处理（访客可自行恢复）；ignored = 后台已忽略；removed = 已下架 */
      status: String(row.status || 'pending'),
      createdAt: row.created_at || ''
    }));

    return json({ ok: true, items, count: items.length });
  } catch (err) {
    console.error('[invalid/mine]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
