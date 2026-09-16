/* ============================================================
   织雾满穗 · 热门列表（公开，Top 100）
   ============================================================ */

import { json } from '../_utils.js';

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const result = await env.DB.prepare(
      `SELECT music_id, copy_count, play_count, fav_count,
              (copy_count + play_count + fav_count) AS total
       FROM hot_songs
       WHERE (copy_count + play_count + fav_count) > 0
       ORDER BY total DESC, last_updated DESC
       LIMIT 100`
    ).all();

    const list = (result.results || []).map(r => ({
      id: r.music_id,
      copy: r.copy_count || 0,
      play: r.play_count || 0,
      fav: r.fav_count || 0,
      total: r.total || 0
    }));

    return json({ ok: true, data: list });
  } catch (err) {
    return json({ ok: true, data: [] }, 200);
  }
}