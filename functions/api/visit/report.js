/* ============================================================
   织雾满穗 · 访问渠道上报
   公开接口，接收 { userId, source }
   同一 userId 重复上报会覆盖旧答案
   ============================================================ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const userId = String(body.userId || '').trim().slice(0, 40);
    let source = String(body.source || '').trim().slice(0, 30);

    if (!userId) {
      return json({ ok: false, error: 'invalid userId' }, 400);
    }
    if (!source) {
      return json({ ok: false, error: 'invalid source' }, 400);
    }

    source = source.replace(/[\r\n\t<>]/g, '').trim();
    if (!source) {
      return json({ ok: false, error: 'invalid source' }, 400);
    }

    /* UPSERT：同一 userId 有记录就覆盖 */
    await env.DB.prepare(
      `INSERT INTO visit_sources (user_id, source, updated_at)
       VALUES (?, ?, datetime('now', 'localtime'))
       ON CONFLICT(user_id) DO UPDATE SET
         source = excluded.source,
         updated_at = excluded.updated_at`
    ).bind(userId, source).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}