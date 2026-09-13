/* ============================================================
   织雾满穗 · 热门统计上报
   公开接口，接收 { id, type }
   type: 'copy' | 'play' | 'fav'
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
    const id = String(body.id || '').trim();
    const type = String(body.type || '').trim();

    if (!id || id.length > 30) {
      return json({ ok: false, error: 'invalid id' }, 400);
    }
    if (type !== 'copy' && type !== 'play' && type !== 'fav') {
      return json({ ok: false, error: 'invalid type' }, 400);
    }

    if (type === 'copy') {
      await env.DB.prepare(
        `INSERT INTO hot_songs (music_id, copy_count, play_count, fav_count, last_updated)
         VALUES (?, 1, 0, 0, datetime('now', 'localtime'))
         ON CONFLICT(music_id) DO UPDATE SET
           copy_count = copy_count + 1,
           last_updated = datetime('now', 'localtime')`
      ).bind(id).run();
    } else if (type === 'play') {
      await env.DB.prepare(
        `INSERT INTO hot_songs (music_id, copy_count, play_count, fav_count, last_updated)
         VALUES (?, 0, 1, 0, datetime('now', 'localtime'))
         ON CONFLICT(music_id) DO UPDATE SET
           play_count = play_count + 1,
           last_updated = datetime('now', 'localtime')`
      ).bind(id).run();
    } else {
      /* fav */
      await env.DB.prepare(
        `INSERT INTO hot_songs (music_id, copy_count, play_count, fav_count, last_updated)
         VALUES (?, 0, 0, 1, datetime('now', 'localtime'))
         ON CONFLICT(music_id) DO UPDATE SET
           fav_count = fav_count + 1,
           last_updated = datetime('now', 'localtime')`
      ).bind(id).run();
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}