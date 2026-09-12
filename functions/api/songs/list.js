/* ============================================================
   织雾满穗 · D1 歌曲列表
   公开接口，宝库页读取用
   ============================================================ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

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
    return json({ ok: true, data: [] }, 200);
  }
}