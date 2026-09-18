/* ============================================================
   织雾满穗 · 添加歌曲（需认证，自动分配 lineIndex）
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
    const musicId = String(body.musicId || '').trim();
    const name = String(body.name || '').trim();
    const category = String(body.category || '未分类').trim() || '未分类';

    if (!musicId || !name) {
      return json({ ok: false, error: 'missing fields' }, 400);
    }
    if (musicId.length > 30 || name.length > 100 || category.length > 30) {
      return json({ ok: false, error: 'too long' }, 400);
    }

    /* line_index 在单条 INSERT 内用子查询计算，避免「先读后写」竞态 */
    await env.DB.prepare(
      `INSERT INTO songs_extra (music_id, name, category, line_index)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(line_index), 99999) + 1 FROM songs_extra))
       ON CONFLICT(music_id) DO UPDATE SET
         name = excluded.name,
         category = excluded.category`
    ).bind(musicId, name, category).run();

    return json({ ok: true });
  } catch (err) {
    console.error('[songs/add]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
