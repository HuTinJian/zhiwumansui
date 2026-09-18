/* ============================================================
   织雾满穗 · 提交反馈
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin } from './_utils.js';

const VALID_TYPES = ['主页', '反馈', '卡片1', '其他'];

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
    const email = String(body.email || '').trim();
    const message = String(body.message || '').trim();
    const wantThanks = body.wantThanks === 1 ? 1 : 0;
    const uploadQuarantine = body.uploadQuarantine === 1 ? 1 : 0;
    const quarantineIds = Array.isArray(body.quarantineIds) ? body.quarantineIds : [];

    if (!VALID_TYPES.includes(type)) {
      return json({ ok: false, error: 'invalid type' }, 400);
    }
    if (!name || name.length > 40) {
      return json({ ok: false, error: 'invalid name' }, 400);
    }
    if (!message || message.length > 1000) {
      return json({ ok: false, error: 'invalid message' }, 400);
    }
    if (email) {
      const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;
      if (!emailPattern.test(email) || email.length > 100) {
        return json({ ok: false, error: 'invalid email' }, 400);
      }
    }

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
      `INSERT INTO feedback (type, name, email, message, want_thanks, upload_quarantine, quarantine_ids, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).bind(type, name, email || null, message, finalWantThanks, finalUploadQuarantine, quarantineJson).run();

    return json({ ok: true });
  } catch (err) {
    console.error('[feedback]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
