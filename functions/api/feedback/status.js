/* ============================================================
   织雾满穗 · 更新反馈状态（需认证）
   ------------------------------------------------------------
   受理 / 拒绝一条反馈。可选附带一句给访客的说明，
   访客下次进入他当初选择的那个页面时会看到弹窗回执。
   ============================================================ */

import { json, checkAuth, requireSameOrigin, readJsonBody, tooLong } from '../_utils.js';

const VALID_STATUS = ['pending', 'approved', 'rejected'];

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await readJsonBody(request);
    const id = Number(body.id);
    const status = String(body.status || '').trim();
    const reply = String(body.reply || '').trim();

    if (!Number.isSafeInteger(id) || id <= 0) return json({ ok: false }, 400);
    if (!VALID_STATUS.includes(status)) return json({ ok: false }, 400);
    if (tooLong(reply, 200)) return json({ ok: false, error: 'reply too long' }, 400);

    /* pending 表示退回未处理，这时不写决定时间；受理/拒绝才记时间 */
    const decidedAt = status === 'pending' ? null : new Date().toISOString().slice(0, 19).replace('T', ' ');

    const result = await env.DB.prepare(
      'UPDATE feedback SET status = ?, reply = ?, decided_at = ? WHERE id = ?'
    ).bind(status, reply || null, decidedAt, id).run();

    return json({ ok: true, updated: (result.meta && result.meta.changes) || 0 });
  } catch (err) {
    console.error('[feedback/status]', err);
    return json({ ok: false }, 500);
  }
}
