/* ============================================================
   织雾满穗 · 热门统计上报（公开，带 IP 限速）
   ============================================================ */

import { json, clientIp, createRateLimiter, requireSameOrigin } from '../_utils.js';

/* 单 IP 10 分钟最多 60 次上报（正常浏览远低于此值） */
const limiter = createRateLimiter(60, 10 * 60 * 1000);

const ID_PATTERN = /^[A-Za-z0-9_-]{1,30}$/;
const VALID_TYPES = ['copy', 'play', 'fav'];

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
    const body = await request.json();
    const id = String(body.id || '').trim();
    const type = String(body.type || '').trim();

    if (!ID_PATTERN.test(id)) {
      return json({ ok: false, error: 'invalid id' }, 400);
    }
    if (!VALID_TYPES.includes(type)) {
      return json({ ok: false, error: 'invalid type' }, 400);
    }

    let sql;
    if (type === 'copy') {
      sql = `INSERT INTO hot_songs (music_id, copy_count, play_count, fav_count, last_updated)
             VALUES (?, 1, 0, 0, datetime('now', 'localtime'))
             ON CONFLICT(music_id) DO UPDATE SET
               copy_count = copy_count + 1,
               last_updated = datetime('now', 'localtime')`;
    } else if (type === 'play') {
      sql = `INSERT INTO hot_songs (music_id, copy_count, play_count, fav_count, last_updated)
             VALUES (?, 0, 1, 0, datetime('now', 'localtime'))
             ON CONFLICT(music_id) DO UPDATE SET
               play_count = play_count + 1,
               last_updated = datetime('now', 'localtime')`;
    } else {
      sql = `INSERT INTO hot_songs (music_id, copy_count, play_count, fav_count, last_updated)
             VALUES (?, 0, 0, 1, datetime('now', 'localtime'))
             ON CONFLICT(music_id) DO UPDATE SET
               fav_count = fav_count + 1,
               last_updated = datetime('now', 'localtime')`;
    }

    await env.DB.prepare(sql).bind(id).run();
    return json({ ok: true });
  } catch (err) {
    console.error('[hot/report]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
