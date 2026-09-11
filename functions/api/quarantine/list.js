/* ============================================================
   GET /api/quarantine/list
   公开接口：返回开发者隔离区列表
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
      `SELECT music_id, name, category, source, created_at
       FROM quarantine_admin
       ORDER BY id DESC`
    ).all();

    const list = (result.results || []).map(r => ({
      id: r.music_id,
      name: r.name || '未知歌名',
      category: r.category || '未分类',
      source: r.source || '',
      quarantinedAt: r.created_at || ''
    }));

    return json({ ok: true, data: list });
  } catch (err) {
    return json({ ok: false, data: [] }, 200);
  }
}