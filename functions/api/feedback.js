/* ============================================================
   织雾满穗 · 提交反馈
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin } from './_utils.js';

const VALID_TYPES = ['主页', '反馈', '卡片1', '卡片2', '其他'];
const CLIENT_ID_PATTERN = /^[a-z0-9]{16,40}$/;

/* 单 IP 10 分钟最多 5 条反馈，避免被刷屏 */
const limiter = createRateLimiter(5, 10 * 60 * 1000);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  const limit = limiter.check(clientIp(request));
  if (!limit.ok) {
    return json({ ok: false, error: 'too_many_requests', wait: limit.wait }, 429);
  }

  try {
    const body = await readJsonBody(request);

    const type = String(body.type || '').trim();
    const name = String(body.name || '').trim();
    const message = String(body.message || '').trim();
    const wantThanks = body.wantThanks === 1 ? 1 : 0;
    const uploadQuarantine = body.uploadQuarantine === 1 ? 1 : 0;
    const quarantineIds = Array.isArray(body.quarantineIds) ? body.quarantineIds : [];

    /* 浏览器身份：用来在管理员受理/拒绝之后，把结果回传给提出问题的那个人。
       没有它也能提交，只是拿不到回执 —— 所以只做格式校验，不做强制。 */
    const rawClient = String(body.clientId || '').trim().toLowerCase();
    const clientId = CLIENT_ID_PATTERN.test(rawClient) ? rawClient : null;

    if (!VALID_TYPES.includes(type)) {
      return json({ ok: false, error: 'invalid type' }, 400);
    }
    if (!name || name.length > 40) {
      return json({ ok: false, error: 'invalid name' }, 400);
    }
    if (!message || message.length > 1000) {
      return json({ ok: false, error: 'invalid message' }, 400);
    }

    /* 鸣谢名单、上传隔离区这两项只对「卡片1 · Roblox ID 宝库」有意义 */
    const finalWantThanks = (type === '卡片1') ? wantThanks : 0;
    const finalUploadQuarantine = (type === '卡片1') ? uploadQuarantine : 0;

    let quarantineJson = null;
    if (finalUploadQuarantine === 1 && quarantineIds.length > 0) {
      const cleaned = quarantineIds
        .slice(0, 500)
        .filter(i => i && typeof i === 'object')
        .map(i => ({
          id: String(i.id || '').slice(0, 30),
          name: String(i.name || '').slice(0, 100),
          category: String(i.category || '').slice(0, 30)
        }))
        .filter(i => i.id);
      quarantineJson = JSON.stringify(cleaned);
    }

    await env.DB.prepare(
      `INSERT INTO feedback (type, name, message, want_thanks, upload_quarantine, quarantine_ids, status, client_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(type, name, message, finalWantThanks, finalUploadQuarantine, quarantineJson, clientId).run();

    return json({ ok: true });
  } catch (err) {
    console.error('[feedback]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
