/* ============================================================
   织雾满穗 · 鸣谢名单
   GET  公开获取鸣谢列表
   POST 管理操作（需认证）：add / delete / update
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

/* ---------- GET：公开获取鸣谢名单 ---------- */
export async function onRequestGet(context) {
  const { env } = context;

  try {
    const result = await env.DB.prepare(
      `SELECT id, category, name, platform, message
       FROM thanks
       ORDER BY category, id`
    ).all();

    const rows = result.results || [];

    /* 按 category 分组 */
    const grouped = [];
    const map = new Map();

    for (const row of rows) {
      if (!map.has(row.category)) {
        const item = { category: row.category, people: [] };
        map.set(row.category, item);
        grouped.push(item);
      }
      map.get(row.category).people.push({
        id: row.id,
        name: row.name,
        platform: row.platform || '',
        message: row.message || ''
      });
    }

    return json(grouped);
  } catch (err) {
    return json([], 200);
  }
}

/* ---------- POST：管理操作（需认证） ---------- */
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await request.json();
    const action = String(body.action || '').trim();

    /* 添加 */
    if (action === 'add') {
      const category = String(body.category || '').trim();
      const name = String(body.name || '').trim();
      const platform = String(body.platform || '').trim();
      const message = String(body.message || '').trim();
      const feedbackId = body.feedbackId ? Number(body.feedbackId) : null;

      if (!category || !name) {
        return json({ ok: false, error: 'missing fields' }, 400);
      }
      if (name.length > 40 || category.length > 30 || platform.length > 30 || message.length > 200) {
        return json({ ok: false, error: 'too long' }, 400);
      }

      const result = await env.DB.prepare(
        `INSERT INTO thanks (category, name, platform, message, feedback_id)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(category, name, platform || null, message || null, feedbackId).run();

      return json({ ok: true, id: result.meta.last_row_id });
    }

    /* 删除 */
    if (action === 'delete') {
      const id = Number(body.id);
      if (!id) {
        return json({ ok: false, error: 'invalid id' }, 400);
      }
      await env.DB.prepare('DELETE FROM thanks WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    /* 修改 */
    if (action === 'update') {
      const id = Number(body.id);
      const category = String(body.category || '').trim();
      const name = String(body.name || '').trim();
      const platform = String(body.platform || '').trim();
      const message = String(body.message || '').trim();

      if (!id || !category || !name) {
        return json({ ok: false, error: 'missing fields' }, 400);
      }

      await env.DB.prepare(
        `UPDATE thanks
         SET category = ?, name = ?, platform = ?, message = ?
         WHERE id = ?`
      ).bind(category, name, platform || null, message || null, id).run();

      return json({ ok: true });
    }

    return json({ ok: false, error: 'unknown action' }, 400);
  } catch (err) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}