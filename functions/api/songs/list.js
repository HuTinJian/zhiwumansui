/* ============================================================
   织雾满穗 · D1 歌曲列表（公开）
   ============================================================ */

import { json } from '../_utils.js';

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const result = await env.DB.prepare(
      `SELECT music_id, name, category, line_index
       FROM songs_extra
       ORDER BY line_index ASC, id ASC`
    ).all();

    const list = (result.results || []).map(r => ({
      id: r.music_id,
      name: r.name,
      category: r.category || '未分类',
      lineIndex: r.line_index || 0
    }));

    return json({ ok: true, data: list });
  } catch (err) {
    console.error('[songs/list]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}