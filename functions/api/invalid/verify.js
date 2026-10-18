/* ============================================================
   织雾满穗 · 「这个音乐 ID 到底存不存在」体检（公开）
   2026-10-17 新增。站主要求原话：
     「无效ID太多了，如果点击试听后，页面显示404的话，我们就认为这个 ID 无效，
       请做出相关功能（玩家想要试听，需要加速器）」。

   ------------------------------------------------------------
   为什么必须放在服务端（Cloudflare Functions）而不是浏览器里直接查：
     · 宝库页的「🔗 试听」跳的是官方资产页 https://create.roblox.com/store/asset/<id>，
       而那个页面是 Next.js 单页应用 —— **任何 ID 都返回 200**，页面内容由浏览器再拉接口渲染。
       所以在浏览器里看那个 URL 的状态码永远看不出 404（2026-10-17 实测：有效 ID、
       不存在的 ID、甚至 id=0 与 id=zzzzzzzz，HEAD 全部 200）。这就是「点了试听才知道 404」的原因。
     · 真正能区分「存在 / 不存在」的是 Roblox 的 economy 接口：
         GET https://economy.roblox.com/v2/assets/<id>/details
         存在   → 200（响应里有 assetTypeId 等）
         不存在 → 404
         格式离谱 → 400
         问太快  → 429
       2026-10-17 实测对照：已下架名单里 12 条绝大多数返回 404、
       data/roblox_music.json 里在架的 8 条绝大多数返回 200 —— 区分得很干净。
     · 这个接口**没有 CORS 头**（Access-Control-Allow-Origin 为空），浏览器 JS 读不到状态码，
       只能由服务端代查。

   三种判定（**关键安全边界**）：
     · 'invalid' —— Roblox 明确说不存在（404）→ 这才叫「点进去是 404」；
     · 'valid'   —— Roblox 说存在（200）；
     · 'unknown' —— 其它一切（连不上 / 超时 / 被限速 429 / 403 / 5xx / 响应看不懂）。
       为什么 400 也算 unknown 而不是 invalid：420 万级的 ID 里「位数太多 / 负数 / 带小数点」
       这类格式问题 Roblox 也回 400，我们不想凭这个就判一首好歌死刑，宁可漏判不误判。
       ⚠️ 玩家在国内没挂加速器时，服务端也是连不上的 —— 那正是 'unknown'，
          绝不能因为「连不上」就把歌标成无效（前端据此只提示、不自动下架）。

   接口：
     GET /api/invalid/verify?id=1876950732            → 单条
     GET /api/invalid/verify?ids=1876950732,1441450732 → 批量（≤ 20 条，后台批量体检用）
     响应：{ ok:true, data:[{ id, status, name }] }（name 拿不到就不给）
   限速：同一 IP 10 分钟 120 次（一次性体检整页 100 组够用；公开接口，防被刷）。

   【回退办法】这一整份是新增文件：直接删掉 functions/api/invalid/verify.js 即可
   回到「试听不做体检」的状态。前端那边同时删掉 roblox_music.html 的
   VERIFY_URL / verifiedIds / verifyMusicId() / verifyPreview() 三处，
   以及 bindListDelegation 里 btn-play 分支中的 verifyPreview(...) 调用。
   删掉后不影响任何现有功能（试听、上报、下架都照旧）。
   ============================================================ */

import { json, clientIp, createRateLimiter, requireSameOrigin, checkAuth } from '../_utils.js';

/* 音乐 ID 形态：1~32 位字母 / 数字 / 下划线 / 连字符（跟其它接口同一口径） */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/* 一次最多查 20 条（前端全库体检按 20 一批切） */
const MAX_IDS = 20;

/* ============================================================
   ⚠️ 2026-10-17 第二轮修正（站主给了一对反例，推翻了我原来的判据）
   ------------------------------------------------------------
   站主给的两个页面：
     · 无效：https://create.roblox.com/store/asset/78707318606182
     · 正常：https://create.roblox.com/store/asset/73387934873699
   这两个页面的**服务端 HTML 完全一样**（都是 200 / 9734 字节，Next.js 单页应用），
   差异只在浏览器渲染后出现。所以我把 4 个接口在这两个 ID 上都测了一遍，结论：

     接口                         无效 ID        正常 ID
     economy/v2/assets/details    **200（说存在）**  200      ← 旧判据在这里瞎了
     apis.roblox.com/toolbox      404             200
     assetdelivery (完整)         403             200
     assetdelivery (Range 1 字节) 403             206
     thumbnails state             Blocked         Completed

   ★ 旧判据的致命缺陷：`economy/.../details` 对「**存在但已下架 / 未通过审核**」的音频
     仍然回 200。也就是说只认 economy 404 的体检，会把这些「页面明明打不开」的 ID
     全部放过 —— 这正是站主说的「无效 ID 太多」的主因。

   ★ 新判据：拿 **assetdelivery 用 Range 只请求第 1 个字节**，看返回码：
       200 / 206 → 真的能取到音频字节 → **valid（铁证）**
       403       → 资产存在但**拒绝访问**（下架 / 未授权）→ **invalid**
       404       → 资源不存在 → **invalid**
       401       → 需要认证，不能据此判死 → **unknown**
   为什么用 Range: bytes=0-0：音频动辄几 MB，体检不能真下载。实测有效 ID 回 206（1 字节），
   无效 ID 回 403，**不发正文**，又快又省。

   ★ 抽样验证（改判据前先测，避免误杀好歌）：
     · 站内在架 20 条：12 条 200/206、4 条 404、2 条 403、2 条 401
       （401 那 2 条是「需要认证」，不是坏 → 所以 401 必须按 unknown，不能判死）
     · 已下架名单 10 条：6 条 404、4 条 403（正好都是「取不到音频」）
     · 有 1 条在架 ID 是 200/200/200 但缩略图 Blocked（图片审核问题，音频能播）
       → 所以**不掺 thumbnails 状态**判有效/无效，避免误杀。
   ============================================================ */

/* 资产取件接口（新判据的主依据）：加 Range 只取 1 字节拿状态码 */
const ROBLOX_DELIVERY_API = 'https://assetdelivery.roblox.com/v1/asset/?id=';

/* 资产详情接口（只当兜底：拿名字 / delivery 给不出结论时补一刀） */
const ROBLOX_ASSET_API = 'https://economy.roblox.com/v2/assets/';

/* 单条查询的超时：Roblox 正常 300~800ms；放到 8 秒是给「慢但不报错」留余量
   —— 宁可多等一会，也不要把一首好歌误判成 unknown（何况 unknown 只是不判定，没副作用）。
   ⚠️ 本地用 Node 跑这个文件做验证时要加 --use-system-ca：
      Node 自带 CA 不认 Roblox 的证书链，会直接 fetch failed（那是本机环境问题，
      跟 Cloudflare Workers 无关 —— Workers 有自己的 CA 包，能正常连）。 */
const TIMEOUT_MS = 8000;

/* 批量时的并发上限：同一时刻最多 5 个上游请求，
   既不会把 Roblox 打出 429，也不会让一次请求拖太久。 */
const CONCURRENCY = 5;

/* 撞上 429（问太快）时等这么久再试一次；还是 429 就按 unknown 收工。 */
const RETRY_DELAY_MS = 700;

/* 同一 IP 10 分钟 30 次（宝库页一次试听 = 1 次；后台整库体检 100 组 = 5 次） */
/* 2026-10-18 安全修复：额度从 120 收紧到 30（单 IP / 10 分钟）。
   前台访客一次试听只查 1 条，30 次够翻一圈了；后台整库体检是管理员手动触发、分批跑。
   【回退办法】改回 120。 */
const limiter = createRateLimiter(30, 10 * 60 * 1000);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* 发一次请求，超时/网络错误返回 null */
async function fetchAssetDetails(id) {
  try {
    return await fetch(ROBLOX_ASSET_API + encodeURIComponent(id) + '/details', {
      method: 'GET',
      /* 带上 UA：Roblox 对完全没有 UA 的请求更容易回 403 */
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ZhiMist-DeepSeek-V4.1-Flash-verify/1.0 (static site asset check)'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (err) {
    return null;
  }
}

/* 用 Range 只取第 1 个字节，返回 HTTP 状态码；网络异常返回 -1。
   为什么要 Range：音频动辄几 MB，体检绝不能真下载。
   实测：有效 ID → 206（1 字节）；下架/未授权 → 403；不存在 → 404；需认证 → 401。 */
async function fetchDeliveryStatus(id) {
  try {
    const res = await fetch(ROBLOX_DELIVERY_API + encodeURIComponent(id), {
      method: 'GET',
      headers: {
        /* 只要第 0~0 这一个字节：拿得到就说明资产可访问 */
        'Range': 'bytes=0-0',
        'Accept': '*/*',
        'User-Agent': 'ZhiMist-DeepSeek-V4.1-Flash-verify/2.0 (static site asset check)'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    /* 立刻把响应体丢掉（哪怕只回了 1 字节也别留着） */
    try { if (res.body) await res.body.cancel(); } catch (err) {}
    return res.status;
  } catch (err) {
    return -1;
  }
}

/* 查一条。返回 { status, name }；status 只会是 valid / invalid / unknown。
   导出出来是为了能在本地直接跑一遍验证判定口径（见 .verify/verify-invalid-20261017.mjs）。 */
export async function verifyOne(id) {
  let code = await fetchDeliveryStatus(id);

  /* 429（问太快）→ 等 700ms 再试一次。批量体检时这一步很有用：
     不重试的话，被限速的那几个会白白变成 unknown（漏检，不是误判，但没意义）。 */
  if (code === 429) {
    await sleep(RETRY_DELAY_MS);
    code = await fetchDeliveryStatus(id);
  }

  /* ① 能取到音频字节（200/206）→ 铁定有效 */
  if (code === 200 || code === 206) return { status: 'valid', name: '' };

  /* ② 明确不可用：
        403 = 资产存在但拒绝访问（下架 / 未通过审核）—— 这就是站主说的那类「页面打不开」
        404 = 资源不存在 */
  if (code === 403 || code === 404) return { status: 'invalid', name: '' };

  /* ③ 401 = 需要登录/认证才能取；不能据此判死（抽样里 2 条在架的好歌也是 401）
        → 交给下面的 economy 兜底，兜不出结论就 unknown */
  if (code !== 401) {
    /* 其余（超时、5xx、-1）也走兜底 */
  }

  /* ④ 兜底：delivery 给不出结论时，用 economy 补一刀
        · economy 404 → 确实不存在 → invalid
        · economy 200 → 存在但取不到（多半是 401 需认证）→ unknown（宁漏判不误判）
        · 其它 → unknown */
  let res = null;
  try {
    res = await fetchAssetDetails(id);
  } catch (err) {
    res = null;
  }
  if (!res) return { status: 'unknown', name: '' };

  if (res.status === 404) return { status: 'invalid', name: '' };

  if (res.status === 200) {
    /* 顺手把歌名带回去（后台列表里有用）；判定仍是 unknown */
    let name = '';
    try {
      const data = await res.json();
      name = String((data && data.Name) || '').slice(0, 100);
    } catch (err) { /* 拿不到名字不影响判定 */ }
    return { status: 'unknown', name };
  }

  return { status: 'unknown', name: '' };
}

export async function onRequestGet(context) {
  const { request } = context;

  /* 同源校验：只让本站页面调用（公开接口也要防止被别的站当免费代理刷） */
  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  const limit = limiter.check(clientIp(request));
  if (!limit.ok) {
    return json({ ok: false, error: 'too many requests', wait: limit.wait }, 429);
  }

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return json({ ok: false, error: 'bad request' }, 400);
  }

  /* 两种写法都收：?id=xxx 或 ?ids=a,b,c（逗号 / 空白分隔）
     ⚠️ 2026-10-18 安全修复（真漏洞）：
       原来这里两个写法都无条件放行，而 requireSameOrigin 对 GET 直接 return true
       （见 _utils.js 的注释），于是任何脚本都能拿它当「免费的 Roblox 批量查询代理」：
       一次 20 个 ID × 每个最多 2 次上游请求，把 Workers 免费额度打光。
       现在规则：
         · ?id=（单条，前台试听用）→ 公开，正常访客不受影响；
         · ?ids=（批量，只有后台整库体检会用）→ **必须管理员登录**。
       【回退办法】删掉下面这段 checkAuth 分支即可（但那等于把代理重新敞开）。 */
  const wantsBatch = url.searchParams.get('ids') !== null;
  if (wantsBatch) {
    const signedIn = await checkAuth(request, context.env);
    if (!signedIn) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
  }

  const raw = wantsBatch
    ? String(url.searchParams.get('ids'))
    : String(url.searchParams.get('id') || '');

  const ids = [];
  for (const piece of raw.split(/[\s,]+/)) {
    const id = piece.trim();
    if (!ID_PATTERN.test(id) || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_IDS) break;
  }

  if (ids.length === 0) {
    return json({ ok: false, error: 'missing id' }, 400);
  }

  /* 有界并发：把 ids 切成 CONCURRENCY 条一组的批次顺序跑，
     比 Promise.all 一次全发更温柔（Roblox 对突发请求会回 429）。 */
  const data = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const chunk = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(id => verifyOne(id)));
    chunk.forEach((id, k) => {
      data.push({
        id,
        status: results[k].status,
        name: results[k].name || ''
      });
    });
  }

  return json({ ok: true, data });
}
