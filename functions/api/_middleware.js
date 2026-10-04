/* ============================================================
   织雾满穗 · /api/* 专用中间件（2026-10-05 新增）
   ------------------------------------------------------------
   为什么只写在这一层：functions/_middleware.js（根目录那个）会连
   静态页面一起拦，等于把每一次访客打开网页都算成一次 Functions 调用，
   白白消耗 Workers 免费额度（10 万次/天），代价太大。
   放在 functions/api/ 下只对 /api/* 生效，额度使用与今天完全一致。

   做三件事：
     1. 全站 API 突发限速（单 IP，10 分钟 600 次）——安全网，
        正常访客远到不了这个数（手机运营商大内网共享 IP 的情况也留了余量）；
     2. 请求体上限 256 KB，超了直接 413，不读进内存；
     3. 给所有 API 响应补安全响应头。
   ============================================================ */

import { clientIp, createRateLimiter } from './_utils.js';

const limiter = createRateLimiter(600, 10 * 60 * 1000);

/* 最大的批量上报（200 条）序列化后也就几十 KB，256 KB 足够宽松 */
const MAX_BODY_BYTES = 256 * 1024;

function jsonError(error, status, extra) {
  const payload = Object.assign({ ok: false, error }, extra || {});
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export async function onRequest(context) {
  const { request } = context;

  /* 1) 突发限速：正常浏览/复制/试听远低于 600 次/10 分钟 */
  const limit = limiter.check(clientIp(request));
  if (!limit.ok) {
    return jsonError('too_many_requests', 429, { wait: limit.wait });
  }

  /* 2) 请求体上限：只看声明长度，不把 body 读进来（读进来就已经消耗内存了） */
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonError('payload_too_large', 413);
  }

  const response = await context.next();

  /* 3) 安全响应头兜底（各接口自己的 json() 已经设过一部分，这里补齐）
     204/205/304 按规范不允许带 body，这类响应原样返回，别去重建 */
  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
