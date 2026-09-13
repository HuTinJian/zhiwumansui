/* ============================================================
   织雾满穗 · 访问渠道上报
   公开接口，接收 { source }
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
    let source = String(body.source || '').trim().slice(0, 30);

    if (!source) {
      return json({ ok: false, error: 'invalid source' }, 400);
    }

    source = source.replace(/[\r\n\t<>]/g, '').trim();
    if (!source) {
      return json({ ok: false, error: 'invalid source' }, 400);
    }

    await env.DB.prepare(
      'INSERT INTO visit_sources (source) VALUES (?)'
    ).bind(source).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}