/* ============================================================
   织雾满穗 · 删除歌曲（需认证，支持单个或批量）
   ============================================================ */

import { json, checkAuth, requireSameOrigin } from '../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await request.json();

    /* id 与 ids 合并处理（此前同时出现时 id 会被静默丢弃） */
    const raw = [];
    if (body.id) raw.push(String(body.id));
    if (Array.isArray(body.ids)) {
      for (const v of body.ids) raw.push(String(v));
    }
    const ids = raw.filter(Boolean).slice(0, 500);

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
    console.error('[songs/delete]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
