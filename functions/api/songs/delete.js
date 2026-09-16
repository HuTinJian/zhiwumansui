/* ============================================================
   织雾满穗 · 删除歌曲（需认证，支持单个或批量）
   ============================================================ */

import { json, checkAuth } from '../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await request.json();

    let ids = [];
    if (body.id) ids = [String(body.id)];
    if (Array.isArray(body.ids)) ids = body.ids.map(String);

    if (ids.length === 0) {
      return json({ ok: false, error: 'missing id' }, 400);
    }

    let deleted = 0;
    const stmts = ids.map(id =>
      env.DB.prepare('DELETE FROM songs_extra WHERE music_id = ?').bind(id)
    );
    const results = await env.DB.batch(stmts);
    for (const r of results) {
      if (r.meta && r.meta.changes > 0) deleted++;
    }

    return json({ ok: true, deleted });
  } catch (err) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}