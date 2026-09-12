/* ============================================================
   织雾满穗 · 添加歌曲
   需认证，自动分配 lineIndex
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

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
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

    /* 自动分配 lineIndex：现有最大值 + 1 */
    const row = await env.DB.prepare(
      `SELECT COALESCE(MAX(line_index), 100000) AS max_line FROM songs_extra`
    ).first();
    const nextLine = (row && row.max_line ? row.max_line : 100000) + 1;

    await env.DB.prepare(
      `INSERT INTO songs_extra (music_id, name, category, line_index)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(music_id) DO UPDATE SET
         name = excluded.name,
         category = excluded.category`
    ).bind(musicId, name, category, nextLine).run();

    return json({ ok: true });
  } catch (err) {
    return json({
      ok: false,
      error: 'server error',
      message: String((err && err.message) || err)
    }, 500);
  }
}