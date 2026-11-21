/* ============================================================
   织雾满穗 · 无效 ID 上报的「自动审核」
   ------------------------------------------------------------
   触发：functions/api/invalid/report.js 收下无效上报后，用
        context.waitUntil(...) 在后台跑一次，不拖慢访客的提交。
   规矩（2026-11-21 站主定）：
     · 只有**明确**的才自动结案；
     · 明确能播放（assetdelivery 200/206）→ 这条反馈不成立，标 noted；
     · 明确无效（delivery 404 + economy 404，或 delivery 403 + economy 200）
       → 自动走「确认无效并下架」（可在后台「已下架」里恢复）；
     · 其余全部 unknown → 原样留在「🚫 待处理上报」，等站长周末人工看。
   为什么这么保守：自动下架是破坏性操作。上游被限速、网络抖动、Roblox
   抽风时，宁可漏判（留给人看），也不能把好歌批量误杀。
   安全阀：先拿 CONTROL_IDS 里长期在架的几首歌探一次路；探不通（不是 200/206）
   就只做「明确有效」的判定，403 这类需要二次确认的一律按 unknown。
   ============================================================ */

import { fetchDeliveryStatus, fetchAssetDetails } from './verify.js';
import { removeIds, dismissIds } from './_actions.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/* 跟 report.js 的单次上限保持一致（一次最多 20 条） */
const MAX_IDS = 20;

/* 同一时刻最多问 Roblox 3 个 ID，避免触发 429 */
const CONCURRENCY = 3;

/* 探路用的「对照组」：站内确实能播的两首（2026-11-21 线上 /api/invalid/verify 实测 valid）。
   只要有任意一首还能取到字节，就认为当前上游链路是通的。
   换成别的 ID 也行，但必须是**确实能播**的，否则自动审核会一直降级。 */
const CONTROL_IDS = ['76421239273915', '97927847298766'];

/* 探路结果缓存 5 分钟：一次上报最多多花 1~2 个请求，不用每条都探 */
const CONTROL_TTL_MS = 5 * 60 * 1000;
let controlCache = { at: 0, ok: false };

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function controlHealthy() {
  if (Date.now() - controlCache.at < CONTROL_TTL_MS) return controlCache.ok;
  let ok = false;
  for (const id of CONTROL_IDS) {
    let code = await fetchDeliveryStatus(id);
    if (code === 429) {
      await sleep(700);
      code = await fetchDeliveryStatus(id);
    }
    if (code === 200 || code === 206) { ok = true; break; }
  }
  controlCache = { at: Date.now(), ok };
  return ok;
}

/* 判一条：只用「两个独立接口都指向同一结论」的证据，其它都算 unknown。 */
async function judgeOne(id, trustUpstream) {
  let code = await fetchDeliveryStatus(id);
  if (code === 429) {
    await sleep(700);
    code = await fetchDeliveryStatus(id);
  }

  /* 直接取到音频字节：这是铁证，不依赖对照组 */
  if (code === 200 || code === 206) return { id, status: 'valid' };

  /* 404：再用 economy 确认一次，两边都说不存在才算「明确无效」 */
  if (code === 404) {
    if (!trustUpstream) return { id, status: 'unknown' };
    const det = await fetchAssetDetails(id);
    if (det && det.status === 404) return { id, status: 'invalid' };
    return { id, status: 'unknown' };
  }

  /* 403：资产存在但取不到音频（下架 / 未授权），必须 economy 说 200 才落锤 */
  if (code === 403) {
    if (!trustUpstream) return { id, status: 'unknown' };
    const det = await fetchAssetDetails(id);
    if (det && det.status === 200) return { id, status: 'invalid' };
    return { id, status: 'unknown' };
  }

  /* 401 需认证 / 5xx / 超时 / 其它：一律不猜 */
  return { id, status: 'unknown' };
}

/* 主入口：ids 是本次真正以 type='invalid' 提交上来的音乐 ID。
   返回统计方便日志里看；调用方不需要等它。 */
export async function autoAuditInvalidReports(env, rawIds) {
  const ids = [];
  for (const v of (Array.isArray(rawIds) ? rawIds : [])) {
    const id = String(v === undefined || v === null ? '' : v).trim();
    if (ID_PATTERN.test(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_IDS) break;
  }
  if (ids.length === 0) return { checked: 0, valid: 0, invalid: 0, unknown: 0 };

  const trustUpstream = await controlHealthy();

  const valid = [];
  const invalid = [];
  let unknown = 0;

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const chunk = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(id => judgeOne(id, trustUpstream)));
    for (const r of results) {
      if (r.status === 'valid') valid.push(r.id);
      else if (r.status === 'invalid') invalid.push(r.id);
      else unknown++;
    }
  }

  /* 先下架，再驳回归档。两个动作各自失败都不影响另一批。 */
  if (invalid.length > 0) {
    try {
      await removeIds(env, invalid);
    } catch (err) {
      console.error('[invalid/audit] 自动下架失败', err);
      unknown += invalid.length;   /* 没下架成的，实际仍留在待处理 */
    }
  }
  if (valid.length > 0) {
    try {
      await dismissIds(env, valid, 'invalid');
    } catch (err) {
      console.error('[invalid/audit] 自动驳回失败', err);
    }
  }

  const summary = {
    checked: ids.length,
    valid: valid.length,
    invalid: invalid.length,
    unknown
  };
  console.log('[invalid/audit]', JSON.stringify(summary), 'trustUpstream=' + trustUpstream);
  return summary;
}
