/* ============================================================
   织雾满穗 · 访问渠道统计
   公开接口，返回每个 source 的计数
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
      `SELECT source, COUNT(*) AS count
       FROM visit_sources
       GROUP BY source
       ORDER BY count DESC`
    ).all();

    return json({ ok: true, data: result.results || [] });
  } catch (err) {
    return json({ ok: true, data: [] }, 200);
  }
}