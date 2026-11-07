/* ============================================================
   织雾满穗 · 赞助登记（公开接口）
   ------------------------------------------------------------
   为什么有这个东西：
     站主用爱发电收赞助（https://afdian.com/a/HuTinJianZW），但爱发电
     没有对外的「支付成功回调」接口，网站没法自动知道谁赞助了。
     所以改成「站内登记 + 站主在后台人工核对」：
       ① 赞助者在爱发电付完钱，来 /support 填昵称、订单号、档位、
          想说的话（可选）；
       ② 这里把记录写进 D1 的 sponsor_regs，状态 pending（待核对）；
       ③ 站主在后台「❤️ 鸣谢名单 → ✅ 赞助登记」里看到这条，核对爱发电
          后台的订单，点「确认入账」才写进鸣谢名单（thanks 表）。
     这样即使有人乱填，也只是在待核对列表里多一条，不会直接上墙。
   安全边界（跟站内其它公开写接口同一套）：
     · 必须同源（requireSameOrigin）；
     · 按 IP 限速，10 分钟最多 10 条（防刷）；
     · 配了 Turnstile 就必须带通行证（checkTurnstile）；
     · 昵称/留言里的尖括号一律抹掉，防止有人拿 XSS 语句当昵称；
     · 订单号唯一（D1 唯一索引），重复提交返回 409，不会写两条。
   【回退办法】
     · 删掉 functions/api/sponsor/ 整个目录 → 接口消失，页面登记会报错；
     · 想连页面一起撤：删 support.html + 鸣谢页弹窗里那颗「✅ 已赞助，去登记」
       按钮 + admin.html 的「✅ 赞助登记」子标签
       （以及 js/admin.js 里 loadSponsorRegs 那一整段）；
     · D1 表可以留着不动（不影响任何现有功能），要清就跑：
       DROP TABLE IF EXISTS sponsor_regs;
     · 数据备份：站主在后台「❤️ 鸣谢名单 → 👑 赞助者 → 📤 导出」可以导
       thanks 表；sponsor_regs 目前没有导出按钮，需要的话先用
       wrangler d1 execute 或 Cloudflare 控制台导出。
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

/* 同一 IP 10 分钟最多登记 10 条：正常人一次就够，刷子也写不爆 D1 */
const limiter = createRateLimiter(10, 10 * 60 * 1000);

/* 档位不再由访客填写（所有档位权益相同）：缺省一律按 'custom' 存；
   旧数据 / 手动提交带了 tier 就照收，非法值仍然拒绝。 */
const TIERS = ['5', '10', '25', '50', 'custom'];

/* 订单号：爱发电的订单号是数字串（通常 16~20 位），这里放宽到字母数字 _-
   4~64 位，兼容以后格式变化；空格/全角空格先去掉再校验。 */
const ORDER_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

/* 把用户输入里的尖括号抹掉（防止把 HTML 当昵称存进去，后台/鸣谢页会原样渲染） */
function stripTags(value) {
  return String(value == null ? '' : value).replace(/[<>]/g, '').trim();
}

/* 访客自报的赞助金额：接受 1~1000000 的数字，归一成 ¥x.xx；空串返回 null。
   最终实收仍以站主核对后填的为准，这里只是给站主一个参考。 */
function normalizeDeclaredAmount(value) {
  if (!value) return null;
  const n = Number(String(value).replace(/[¥￥,，\s元]/g, ''));
  if (!isFinite(n) || n <= 0 || n > 1000000) return null;
  return '¥' + n.toFixed(2);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  const body = await readJsonBody(request);

  /* 限速键用 IP（绝不能用 body 里的自报身份：那等于让刷子无限换桶） */
  const limit = limiter.check(clientIp(request));
  if (!limit.ok) {
    return json({ ok: false, error: 'too many requests', wait: limit.wait }, 429);
  }

  /* 人机验证：没配 TURNSTILE_SECRET 时直接放行（跟站内其它公开接口一致） */
  const ts = await checkTurnstile(request, env, body);
  if (!ts.ok) return turnstileRejection(ts);

  const nickname = stripTags(body.nickname);
  const orderNo = String(body.orderNo == null ? '' : body.orderNo).replace(/[\s\u3000]/g, '');
  const tier = String(body.tier == null ? '' : body.tier).trim() || 'custom';
  const message = stripTags(body.message);
  const publicMessage = stripTags(body.publicMessage);
  const amountRaw = String(body.amount == null ? '' : body.amount).trim();
  const amount = normalizeDeclaredAmount(amountRaw);

  if (!nickname) return json({ ok: false, error: 'missing nickname' }, 400);
  if (nickname.length > 40) return json({ ok: false, error: 'nickname too long' }, 400);
  if (!ORDER_PATTERN.test(orderNo)) return json({ ok: false, error: 'bad order' }, 400);
  if (TIERS.indexOf(tier) === -1) return json({ ok: false, error: 'bad tier' }, 400);
  if (message.length > 200) return json({ ok: false, error: 'message too long' }, 400);
  if (publicMessage.length > 200) return json({ ok: false, error: 'message too long' }, 400);
  if (amountRaw && !amount) return json({ ok: false, error: 'bad amount' }, 400);

  try {
    await env.DB.prepare(
      `INSERT INTO sponsor_regs (nickname, order_no, tier, message, public_message, amount, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    ).bind(nickname, orderNo, tier, message || null, publicMessage || null, amount).run();

    return json({ ok: true });
  } catch (err) {
    /* D1 唯一索引冲突：同一张订单被登记了第二次。
       不报 500（那不是服务器坏了），返回 409 让前端提示「这条已经登记过了」。 */
    const text = String((err && err.message) || '');
    if (/UNIQUE|constraint/i.test(text)) {
      return json({ ok: false, error: 'duplicate' }, 409);
    }
    console.error('[sponsor register]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
