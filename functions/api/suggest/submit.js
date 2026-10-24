/* ============================================================
   织雾满穗 · 「💡 建议」提交接口
   路径：POST /api/suggest/submit
   入库：D1 表 suggestions（建表语句见 schema.sql 末尾）
   ------------------------------------------------------------
   写这个接口的约束（照 functions/api/invalid/report.js 的写法）：
     · requireSameOrigin —— 拒绝跨站 POST；
     · createRateLimiter(10, 10*60*1000) —— 同一 IP 10 分钟最多 10 次；
     · checkTurnstile —— 配了 TURNSTILE_SECRET 才生效，未配置时完全不拦人；
     · readJsonBody —— 非法 JSON 当空对象，交给字段校验兜底。
   返回只有两种形状：
     { ok: true }
     { ok: false, error: '...' }（部分错误额外带 wait，供前端提示等待秒数）

   【回退办法】
     ① 删除本文件（functions/api/suggest/submit.js）并重新部署，
        /api/suggest/submit 会回到 404；suggest.html 提交时会显示失败提示，
        其它页面和接口不受影响。
     ② D1 里的 suggestions 表不会自动删除（留着不影响任何旧功能）；
        确认不需要表里的数据后，才执行：
          DROP TABLE IF EXISTS suggestions;
        —— 这会连同已收集的建议一起删掉，执行前先导出备份。
     ③ schema.sql 末尾追加的建表段落可一并删掉，恢复原文件即可。
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

/* 同一 IP 10 分钟最多 10 次。
   内存限速只在单个 isolate 内有效，换机房/多实例时可能放过一部分，
   所以外面还有 /api/* 中间件（600 次/10 分钟）与 Turnstile 两层兜底。 */
const limiter = createRateLimiter(10, 10 * 60 * 1000);

/* 字段上限：与页面上的 maxlength、字数计数器保持一致 */
const MAX_NICKNAME = 20;
const MAX_CONTENT = 1000;
const MAX_CONTACT = 60;

/* 浏览器匿名身份：与 js/common.js 的 getClientId() 同一形态。
   不合法就存空串（表字段 NOT NULL DEFAULT ''），绝不因为身份缺失而拒绝正常提交。 */
const CLIENT_ID_PATTERN = /^[a-z0-9]{8,64}$/;

/**
 * 把用户输入整理成可入库的纯文本：
 *   1. 换行统一成 \n —— Windows 的 \r\n 原样入库会多一个看不见的字符；
 *   2. 剔除 < 和 > —— 这两个字符是后台若用 innerHTML 渲染时最常见的注入入口，
 *      在源头清一次成本最低（输出端仍然要转义，这是纵深防御，不是替代）；
 *   3. 去掉首尾空白 —— 只填空格不算有效内容。
 * 注意：这里不做 HTML 转义，转义留给输出端。
 */
function normalize(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[<>]/g, '')
    .trim();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  /* 1) 同源校验：跨站页面发来的 POST 直接 403 */
  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  /* 2) 频率限制：键必须用服务端看到的 IP。
     绝不能用请求体里的 clientId —— 那是客户端自报的，每次换一个就等于无限额度。 */
  const limit = limiter.check(clientIp(request));
  if (!limit.ok) {
    return json({ ok: false, error: 'too many requests', wait: limit.wait }, 429);
  }

  /* 3) 读 JSON：readJsonBody 不会抛，非法 JSON 一律当空对象 */
  const body = await readJsonBody(request);

  /* 4) 人机验证：没配 TURNSTILE_SECRET 时 checkTurnstile 直接放行 */
  const ts = await checkTurnstile(request, env, body);
  if (!ts.ok) return turnstileRejection(ts);

  /* 5) 字段校验：先清理（去尖括号/首尾空白），再按清理后的长度判断 */
  const nickname = normalize(body.nickname);
  const content = normalize(body.content);
  const contact = normalize(body.contact);

  if (nickname.length > MAX_NICKNAME) {
    return json({ ok: false, error: 'nickname too long' }, 400);
  }
  if (!content) {
    return json({ ok: false, error: 'missing content' }, 400);
  }
  if (content.length > MAX_CONTENT) {
    return json({ ok: false, error: 'content too long' }, 400);
  }
  if (contact.length > MAX_CONTACT) {
    return json({ ok: false, error: 'contact too long' }, 400);
  }

  /* clientId 同时兼容 camelCase 与表字段的 snake_case，方便以后别的页面复用 */
  const rawClientId = String(body.clientId || body.client_id || '').trim().toLowerCase();
  const clientId = CLIENT_ID_PATTERN.test(rawClientId) ? rawClientId : '';

  try {
    /* status 与 created_at 交给表默认值（'new' / 本地时间），不在这里写死，
       这样以后改默认值只改一处 SQL。slice 是兜底：上面已经拦过超长，正常不会截断。 */
    await env.DB.prepare(
      `INSERT INTO suggestions (nickname, content, contact, client_id)
       VALUES (?, ?, ?, ?)`
    )
      .bind(
        nickname ? nickname.slice(0, MAX_NICKNAME) : null,
        content.slice(0, MAX_CONTENT),
        contact ? contact.slice(0, MAX_CONTACT) : null,
        clientId
      )
      .run();

    return json({ ok: true });
  } catch (err) {
    console.error('[suggest/submit]', err);

    /* schema.sql 末尾的表还没在 D1 执行时，返回一个可排查的错误码；
       不把数据库原文抛给访客，避免泄露内部结构。 */
    if (err && String(err.message || '').indexOf('no such table') >= 0) {
      return json({ ok: false, error: 'storage not ready' }, 503);
    }
    return json({ ok: false, error: 'server error' }, 500);
  }
}
