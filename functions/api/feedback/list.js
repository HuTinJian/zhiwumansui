/* ============================================================
   GET /api/feedback/list
   获取所有反馈（需认证）
   新增：返回 upload_quarantine 和 quarantine_ids
   ============================================================ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function readCookie(cookieHeader, key) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...v] = part.trim().split('=');
    if (k === key) return v.join('=');
  }
  return null;
}

function checkAuth(request, env) {
  const token = readCookie(request.headers.get('Cookie'), 'zm_auth');
  return token && token === env.AUTH_TOKEN;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const result = await env.DB.prepare(
      `SELECT id, type, name, email, message,
              want_thanks, upload_quarantine, quarantine_ids,
              status, created_at
       FROM feedback
       ORDER BY id DESC`
    ).all();

    const list = (result.results || []).map(r => {
      let quarantineIds = [];
      if (r.quarantine_ids) {
        try { quarantineIds = JSON.parse(r.quarantine_ids); } catch {}
      }
      return {
        id: r.id,
        type: r.type,
        name: r.name,
        email: r.email || '',
        message: r.message,
        want_thanks: r.want_thanks || 0,
        upload_quarantine: r.upload_quarantine || 0,
        quarantine_ids: quarantineIds,
        status: r.status || 'pending',
        created_at: r.created_at
      };
    });

    return json(list);
  } catch (err) {
    return json([], 200);
  }
}