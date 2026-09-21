/* ============================================================
   织雾满穗 · 查询「我自己提交过的反馈」
   ------------------------------------------------------------
   无需登录：只用浏览器自己生成的那串随机身份去查自己的记录，
   拿不到别人的（client_id 是 32 位随机十六进制，猜不出来）。
   用途：管理员受理 / 拒绝之后，访客下次进入对应的页面能看到回执弹窗。
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin } from '../_utils.js';

const CLIENT_ID_PATTERN = /^[a-z0-9]{16,40}$/;

/* 查自己的记录很轻，但也不能让人无限刷 */
const limiter = createRateLimiter(60, 10 * 60 * 1000);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  const limit = limiter.check(clientIp(request));
  if (!limit.ok) {
    return json({ ok: false, error: 'too_many_requests' }, 429);
  }

  try {
    const body = await readJsonBody(request);
    const clientId = String(body.clientId || '').trim().toLowerCase();

    if (!CLIENT_ID_PATTERN.test(clientId)) {
      return json({ ok: true, data: [] });
    }

    const rows = await env.DB.prepare(
      `SELECT id, type, status, reply, message, created_at, decided_at
         FROM feedback
        WHERE client_id = ?
        ORDER BY id DESC
        LIMIT 50`
    ).bind(clientId).all();

    const list = (rows && rows.results) ? rows.results : [];

    /* 只回传界面需要的字段，不把整行数据丢给前端；
       正文只取前 120 字做「你当时提交的内容」回显 */
    const data = list.map(r => {
      const msg = String(r.message || '');
      return {
        id: Number(r.id) || 0,
        type: String(r.type || ''),
        status: String(r.status || 'pending'),
        reply: r.reply ? String(r.reply) : '',
        excerpt: msg.length > 120 ? msg.slice(0, 120) + '…' : msg,
        createdAt: String(r.created_at || ''),
        decidedAt: r.decided_at ? String(r.decided_at) : ''
      };
    });

    return json({ ok: true, data });
  } catch (err) {
    console.error('[feedback/mine]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
