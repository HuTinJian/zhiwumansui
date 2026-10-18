/* ============================================================
   织雾满穗 · 访客数据上报（公开，带 IP 限速）
   ------------------------------------------------------------
   2026-10-17 站主要求：「『你从哪里来』停用，改成收集玩家的手机屏幕尺寸，
   方便之后做适配」。
   所以 `source` 字段现在**存屏幕尺寸标识**，不再是渠道名：
       "407x886@3"   →  CSS 视口 407×886、DPR 3（小米 17 6.3" 就是这个）
   · 表结构不变（visit_sources.source），接口路径不变，前端改传尺寸；
   · 同一 userId 仍是覆盖写（ON CONFLICT），所以一个人反复访问不会刷高计数；
   · 校验照旧：去掉换行/尖括号，最长 30 字符 —— "407x886@3" 只有 10 个字符，够用。
   【回退办法】前端把传参改回渠道名即可，本文件无需再改（它只做字符串校验与入库）。
   ============================================================ */

import {
  json,
  checkTurnstile,
  clientIp,
  createRateLimiter,
  readJsonBody,
  requireSameOrigin,
  turnstileRejection
} from '../_utils.js';

/* 单 IP 10 分钟最多 20 次上报（同一用户只会选一次渠道） */
/* 2026-10-18 安全修复：额度 20 → 10（正常访客一次会话只报一次尺寸）。
   【回退办法】改回 20。 */
const limiter = createRateLimiter(10, 10 * 60 * 1000);

/* 2026-10-18 安全修复：原来只要求 1~30 位字母数字，传 "a" 也能过，
   攻击者每次换一个 userId 就能凭空造出无数「新访客」，把屏幕尺寸统计刷歪。
   收紧成前端真实生成的形状：u_<base36>_<base36>（见 common.js 的 getClientId）。
   【回退办法】改回 /^[A-Za-z0-9_-]{1,30}$/。 */
const ID_PATTERN = /^u_[a-z0-9]{6,}_[a-z0-9]{6,}$/;

/* 屏幕尺寸标识必须是「宽x高@DPR」，例如 407x886@3 —— 这是本接口唯一合法的 source 形态。
   以前任意 30 字文本都收，等于给了一个公开的任意写入点。 */
const SIZE_PATTERN = /^\d{2,5}x\d{2,5}@\d{1,2}(?:\.\d{1,2})?$/;

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
    /* readJsonBody 不会抛：非法 JSON 一律当空对象，交给下面的校验兜 */
    const body = await readJsonBody(request);

    /* 人机验证：配了 TURNSTILE_SECRET 才生效（防止脚本刷渠道统计） */
    const ts = await checkTurnstile(request, env, body);
    if (!ts.ok) return turnstileRejection(ts);

    const userId = String(body.userId || '').trim();
    let source = String(body.source || '').trim().slice(0, 30);

    if (!ID_PATTERN.test(userId)) {
      return json({ ok: false, error: 'invalid userId' }, 400);
    }
    if (!source) {
      return json({ ok: false, error: 'invalid source' }, 400);
    }

    /* 2026-10-18 安全修复：只收「宽x高@DPR」这一种形态。
       【回退办法】删掉下面这个 SIZE_PATTERN 判断即可。 */
    if (!SIZE_PATTERN.test(source)) {
      return json({ ok: false, error: 'invalid source' }, 400);
    }

    source = source.replace(/[\r\n\t<>]/g, '').trim();
    if (!source) {
      return json({ ok: false, error: 'invalid source' }, 400);
    }

    await env.DB.prepare(
      `INSERT INTO visit_sources (user_id, source, updated_at)
       VALUES (?, ?, datetime('now', 'localtime'))
       ON CONFLICT(user_id) DO UPDATE SET
         source = excluded.source,
         updated_at = excluded.updated_at`
    ).bind(userId, source).run();

    return json({ ok: true });
  } catch (err) {
    console.error('[visit/report]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
