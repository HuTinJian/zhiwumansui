/* ============================================================
   织雾满穗 · 提交反馈
   接收反馈 → 存入 D1
   ============================================================ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/* 有效的反馈类型 */
const VALID_TYPES = ['主页', '反馈页', '卡片1', '其他'];

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();

    const type = String(body.type || '').trim();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim();
    const message = String(body.message || '').trim();
    const wantThanks = body.wantThanks === 1 ? 1 : 0;
    const uploadQuarantine = body.uploadQuarantine === 1 ? 1 : 0;
    const quarantineIds = Array.isArray(body.quarantineIds) ? body.quarantineIds : [];

    /* 类型校验 */
    if (!VALID_TYPES.includes(type)) {
      return json({ ok: false, error: 'invalid type' }, 400);
    }
    /* 必填校验 */
    if (!name || name.length > 40) {
      return json({ ok: false, error: 'invalid name' }, 400);
    }
    if (!message || message.length > 1000) {
      return json({ ok: false, error: 'invalid message' }, 400);
    }

    /* 邮箱选填，填了要格式正确 */
    if (email) {
      const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;
      if (!emailPattern.test(email) || email.length > 100) {
        return json({ ok: false, error: 'invalid email' }, 400);
      }
    }

    /* 只有"卡片1"类型才允许附加选项 */
    const finalWantThanks = (type === '卡片1') ? wantThanks : 0;
    const finalUploadQuarantine = (type === '卡片1') ? uploadQuarantine : 0;

    /* 隔离区ID：只保留有效字段，最多 500 个 */
    let quarantineJson = null;
    if (finalUploadQuarantine === 1 && quarantineIds.length > 0) {
      const cleaned = quarantineIds
        .slice(0, 500)
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
    return json({ ok: false, error: 'server error' }, 500);
  }
}