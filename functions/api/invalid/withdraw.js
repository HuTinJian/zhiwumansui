/* ============================================================
   织雾满穗 · 撤销自己的无效上报（公开，支持单个或批量）
   2026-10-05：新增。上报后不隐藏、可撤销 —— 访客点「↩️ 撤销」走这里。
   ============================================================ */

import {
  json,
  checkTurnstile,
  createRateLimiter,
  readJsonBody,
  requireSameOrigin,
  turnstileRejection
} from '../_utils.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const REPORTER_PATTERN = /^[a-z0-9]{8,64}$/;

const MAX_ITEMS = 200;

/* 与 report 同口径的限速：同一浏览器身份 10 分钟最多 60 次 */
const limiter = createRateLimiter(60, 10 * 60 * 1000);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  const body = await readJsonBody(request);

  const reporter = String(body.reporter || '').trim().toLowerCase();
  const validReporter = REPORTER_PATTERN.test(reporter) ? reporter : '';

  /* 撤销必须知道「你是谁」，这一条不降级 —— 否则可能删掉别人的上报 */
  if (!validReporter) {
    return json({ ok: false, error: 'missing reporter' }, 400);
  }

  const limit = limiter.check(validReporter);
  if (!limit.ok) {
    return json({ ok: false, error: 'too many requests', wait: limit.wait }, 429);
  }

  /* 人机验证：配了 TURNSTILE_SECRET 才生效（撤销也要过，防止脚本批量撤别人的） */
  const ts = await checkTurnstile(request, env, body);
  if (!ts.ok) return turnstileRejection(ts);

  try {
    /* 两种写法都收：{ id, reporter } / { items: [ { id } ], reporter } */
    const raw = Array.isArray(body.items) ? body.items : [body];
    const ids = [];
    for (const item of raw.slice(0, MAX_ITEMS)) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id === undefined || item.id === null ? '' : item.id).trim();
      if (ID_PATTERN.test(id) && !ids.includes(id)) ids.push(id);
    }

    /* 没有可撤的 ID 视为已经撤干净，返回 0 而不是报错（撤销要幂等） */
    if (ids.length === 0) {
      return json({ ok: true, withdrew: 0 });
    }

    /* 只删自己 + 仍处于 pending 的行：已被管理员下架 / 忽略的上报不允许访客撤掉 */
    let withdrew = 0;
    const stmts = ids.map(id =>
      env.DB.prepare(
        `DELETE FROM invalid_reports
         WHERE music_id = ? AND reporter = ? AND status = 'pending'`
      ).bind(id, validReporter)
    );
    const results = await env.DB.batch(stmts);
    for (const r of results) {
      if (r && r.meta && r.meta.changes > 0) withdrew++;
    }

    return json({ ok: true, withdrew });
  } catch (err) {
    console.error('[invalid/withdraw]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
