/* ============================================================
   织雾满穗 · 赞助登记列表（后台专用，2026-11-07 新增）
   ------------------------------------------------------------
   只给 /admin 的「❤️ 鸣谢名单 → ✅ 赞助登记」面板用：
     GET /api/sponsor/list            → 全部登记（待核对在前）
     GET /api/sponsor/list?status=xxx → 只要某一状态
   登录态由 checkAuth 校验（cookie zm_auth），未登录一律 401。

   返回形状：
     { ok: true, items: [...], stats: { pending, confirmed, rejected } }
   其中 order_no 只给后台看，公开页面永远不会看到它。

   【回退办法】删掉本文件即可；后台面板会显示「加载失败」，不影响其它页面。
   ============================================================ */

import { json, checkAuth } from '../_utils.js';

/* 一次最多取 500 条：赞助登记不是高频数据，500 足够翻很久；
   将来真超过，再加分页参数。 */
const MAX_ROWS = 500;

const STATUSES = ['pending', 'confirmed', 'rejected'];

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const wanted = new URL(request.url).searchParams.get('status') || '';

  try {
    const result = await env.DB.prepare(
      `SELECT id, nickname, order_no, tier, message, status, amount,
              thanks_id, created_at, confirmed_at
       FROM sponsor_regs
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
                id DESC
       LIMIT ${MAX_ROWS}`
    ).all();

    const rows = result.results || [];

    /* 统计永远按全量算（不受 ?status 过滤影响），后台顶部三张卡要显示总数 */
    const stats = { pending: 0, confirmed: 0, rejected: 0 };
    rows.forEach(row => {
      if (Object.prototype.hasOwnProperty.call(stats, row.status)) stats[row.status] += 1;
    });

    const items = STATUSES.indexOf(wanted) >= 0
      ? rows.filter(row => row.status === wanted)
      : rows;

    return json({ ok: true, items, stats });
  } catch (err) {
    console.error('[sponsor list]', err);
    /* 表还没建的时候也给一句人话，别让后台只看到 500 */
    const text = String((err && err.message) || '');
    if (/no such table/i.test(text)) {
      return json({ ok: false, error: 'table missing' }, 500);
    }
    return json({ ok: false, error: 'server error' }, 500);
  }
}
