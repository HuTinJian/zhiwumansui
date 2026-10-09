/* ============================================================
   织雾满穗 · 热门统计上报（公开，带 IP 限速）
   ============================================================ */

import { json, clientIp, createRateLimiter } from '../_utils.js';

/* 单 IP 10 分钟最多 60 次上报（正常浏览远低于此值） */
const limiter = createRateLimiter(60, 10 * 60 * 1000);

const ID_PATTERN = /^[A-Za-z0-9_-]{1,30}$/;
const VALID_TYPES = ['copy', 'play', 'fav'];

/* 2026-10-10：这个接口比别处更严一档 —— 【必须带 Origin】。
   原因：共享的 requireSameOrigin()（_utils.js:161）在「请求压根没带 Origin」时是**放行**的
   （见 _utils.js:167），于是 curl / 脚本可以不带头直接刷热度榜。
   ⚠️ 只收紧这一个接口，**不动共享函数**：登录、无效上报、渠道上报、投稿那几个接口继续用原口径 ——
   那些接口宁可漏挡也不能漏记（个别浏览器扩展会剥掉 Origin）。 */
function requireOriginStrict(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch (e) {
    return false;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireOriginStrict(request)) {
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
