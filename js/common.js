/* ============================================================
   织雾满穗 · 共享工具  (v2)
   所有页面共用：主题、Toast、弹窗、复制、防抖、版本检查、视觉特效
   ------------------------------------------------------------
   本文件对旧版 API 保持完全向后兼容：
   showToast / openModal / closeModal / copyText / debounce /
   escapeHtml / showNotice / showConfirm / checkPageUpdate
   ============================================================ */
(function () {
  'use strict';

  /* ============================================================
     0. 主题（尽早执行，避免闪烁）
     ============================================================ */
  const THEME_KEY = 'zm_theme';

  /* ------------------------------------------------------------
       手机切主题出问题：存储层加固
       ------------------------------------------------------------
       现象：在手机系统自带浏览器里点小太阳没反应 / 只变一部分 /
       刷新或换页后又变回去。
       根因之一：手机上 localStorage 并不可靠 —— 无痕模式、隐私设置、
       系统清理都会让它读不到或写不进；只写 localStorage 时，写失败被
       try/catch 吞掉，于是就「切了等于没切」。
       改法：localStorage 和 cookie 两边都写、两边都读，谁能用就用谁。
       cookie 用 path=/ 让全站共用，有效期一年。
       【回退办法】把 readStoredTheme 换回上面那 3 行的旧写法、
       writeStoredTheme 整段删掉、toggleTheme 里的 writeStoredTheme 换回
       原来的 localStorage.setItem，即回到加固前的行为；
       备份在 .verify/backup-theme-20261107/common.js。
       ------------------------------------------------------------ */
  function readStoredTheme() {
    /* ① 先看 localStorage（最快，正常情况都走这里） */
    try {
      var v = localStorage.getItem(THEME_KEY);
      if (v === 'dark' || v === 'light') return v;
    } catch (e) {}
    /* ② 读不到就用 cookie 兜底（手机上 localStorage 被禁时靠它） */
    try {
      var m = document.cookie.match(/(?:^|;\s*)zm_theme=(dark|light)(?:;|$)/);
      if (m) return m[1];
    } catch (e) {}
    return null;
  }

  /* 两边都写一遍。任何一边失败都不影响另一边，也不往上报错。
     【回退办法】整个函数删掉，改回 localStorage.setItem 单写。 */
  function writeStoredTheme(t) {
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    try {
      /* max-age 一年；SameSite=Lax 防止跨站带上；不写 Secure，
         否则本地 http 预览时写不进去 */
      document.cookie = THEME_KEY + '=' + t + '; path=/; max-age=31536000; SameSite=Lax';
    } catch (e) {}
  }

  function prefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function applyTheme(theme) {
    const t = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.colorScheme = t;

    const meta = document.querySelector('meta[name="theme-color"]');
    /* 中国色：浏览器状态栏跟随「宣纸 / 墨夜」，不用粉色。
           【回退办法】改回 '#17121a' / '#fdf2f5'。 */
    if (meta) meta.setAttribute('content', t === 'dark' ? '#14110E' : '#F5F0E6');

    /* 切完强制刷一次样式与重排。
           部分手机浏览器（带 GPU 合成层的浮动按钮、弹窗遮罩）只改 CSS 变量时
           不会立刻重画，表现就是「颜色只变了一半」。读一次 offsetHeight 会把
           挂起的样式 / 布局计算立刻跑完，新颜色当场生效。
           【回退办法】删掉下面这个 if 块即可。 */
    if (document.body) {
      void document.body.offsetHeight;
    }

    document.querySelectorAll('.theme-toggle').forEach(btn => {
      /* 书卷层的「设置」钮也挂 .theme-toggle 类，只为复用圆钮样式；
         它的字形（⚙）与提示语是固定的，这里不能把它改写成 🌙 / ☀️。 */
      if (btn.getAttribute('data-settings') === '1') return;
      const isDark = t === 'dark';
      btn.textContent = isDark ? '☀️' : '🌙';
      btn.setAttribute('aria-label', isDark ? '切换到浅色模式' : '切换到深色模式');
      btn.setAttribute('title', isDark ? '切换到浅色模式' : '切换到深色模式');
      btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    });
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    /* 改走 writeStoredTheme —— localStorage 写不进去时还有 cookie
           【回退办法】换回 try { localStorage.setItem(THEME_KEY, next); } catch (e) {} */
    writeStoredTheme(next);
  }

  function initTheme() {
    var stored = readStoredTheme();
    /* 只要任一存储里有用户的选择，就把另一边补齐。
           这样「手机上切过一次」的决定不会因为某一边被清掉而丢失。
           【回退办法】删掉下面这个 if 块。 */
    if (stored) writeStoredTheme(stored);
    applyTheme(stored || (prefersDark() ? 'dark' : 'light'));
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (!readStoredTheme()) applyTheme(prefersDark() ? 'dark' : 'light'); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  initTheme();/* ============================================================
   0.5 这个站到现在花了多少钱
   ------------------------------------------------------------
   页面上【只有首页 hero 那条赞助入口的右边】显示这个数字：
   金额单独一小块，挂在赞助入口右边（这个入口现在是爱发电外链）。
   鸣谢页 thanks.html、赞助弹窗、新人弹窗都不写金额和核对日期 ——
   全站只此一处，免得同一个数字在好几个地方各写一遍、还容易改漏。

   数字只写在这个 SITE_COST 里：页面上用占位元素标出位置（属性名见下面
   fillSiteCost 的选择器），脚本启动时统一填进去。
   以后要改：改下面 amount 这一行，checkedAt 也一起改成你核对当天的日期。

   口径：DeepSeek API 的累计消费（元）。数字来自 DSH 的账单文件，
   是人工核对后填进来的，不会自己涨。
   占位元素里写的那份（index.html 里的金额和核对日期）是【没脚本时的兜底】，
   换数字时也要顺手一起改。
   ============================================================ */
const SITE_COST = {
  amount: '¥323.07',         /* 累计花费（元）—— 只改这一个地方 */
  since: '2026-09-12',      /* 从哪天开始算的 */
  checkedAt: '2026-11-21'   /* 上面这个数字是哪天核对的 */
};

/* 把金额 / 核对日期填进页面里所有占位处
   （现在只有首页 index.html hero 里、赞助入口右边那一块） */
function fillSiteCost(scope) {
  const root = scope || document;
  root.querySelectorAll('[data-site-cost]').forEach(el => {
    el.textContent = SITE_COST.amount;
  });
  root.querySelectorAll('[data-site-cost-date]').forEach(el => {
    el.textContent = SITE_COST.checkedAt;
  });
}

/* ============================================================
   0.6 「一共收到多少赞助」
   ------------------------------------------------------------
   首页「我花了多少钱」后面再加一块「收到的赞助」，
   数字按【D1 + 仓库底档 data/sponsors.json】一起算。
   口径跟 thanks.html 的赞助者名单完全一致：
     · D1：/api/thanks 里 category === '👑 赞助者' 的行，金额存在 platform 字段
       （后台定的口径，例如 '¥10.00'；底档那边才叫 amount）；
     · 底档：data/sponsors.json 的 amount 字段；
     · 按名字去重、同名的以 D1 为准；后台删除赞助者时留下的隐藏标记是另一个类别，
       天然不会被算进来。
   金额只认数字部分，认不出来按 0 计（比如某条金额写「一杯奶茶」就不计）。
   D1 读不到（本地预览 / 接口挂了）就【保留 HTML 里写死的兜底数字】——
   宁可不更新，也不因为只读到半份数据而显示一个偏小的错数。
   ============================================================ */
const SPONSOR_CATEGORY = '👑 赞助者';

/* 从 '¥10.00' / '10元' / '￥5' 这类文本里抠出金额；抠不出来算 0 */
function parseMoney(text) {
  const m = String(text === undefined || text === null ? '' : text).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

/* 金额一律两位小数（¥25.00 / ¥25.50），整数也带两个 0。 */
function formatMoney(num) {
  const v = Math.round(Number(num) * 100) / 100;
  return '¥' + v.toFixed(2);
}

/* 把随手写的一串金额归一成「¥xx.xx」两位小数。
   认得的写法：'10' / '10.5' / '¥10' / '￥10' / '10元' / '10块' / '1,000' / 全角数字。
   **认不出是纯金额就原样返回**（比如备注写「一杯奶茶」，绝不硬改成 ¥0.00 把原话吃掉）。
   页面显示、后台保存、导出都用它，保证口径只有一处。 */
function normalizeMoneyText(text) {
  const raw = String(text === undefined || text === null ? '' : text).trim();
  if (!raw) return '';
  /* 全角数字/小数点先转半角，顺手把全角逗号、句号也归一 */
  const half = raw
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/．/g, '.')
    .replace(/，/g, ',');
  const m = half.match(/^[¥￥$]?\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d+))?\s*(?:元|块钱|块|人民币|RMB|rmb)?$/);
  if (!m) return raw;
  const num = parseFloat(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
  if (!isFinite(num)) return raw;
  return formatMoney(num);
}

/* ============================================================
   时间显示
   ------------------------------------------------------------
   背景（线上量过，不是猜的）：D1 里的 created_at 是用
   `datetime('now','localtime')` 写的，但 Cloudflare 的 SQLite 跑在 UTC 上，
   那串「看着像本地时间」的值其实是 **UTC** —— 实测北京时间 10:50 上报一条，
   库里写 02:50，慢整整 8 小时（凌晨 0-8 点报的连日期都会差一天）。
   接口统一返回**带时区的 ISO**（…Z，见 functions/api/_time.js），
   这里负责把它按**北京时间**显示出来，前台「📋 我上报的」和后台「无效音乐ID管理」共用这一个。
   为什么用固定 +8、不跟浏览器时区：① 中文站就该按北京时间看；
   ② 中国自 1991 年起没有夏令时，UTC+8 全年固定，直接加 8 小时就是准的，也不依赖时区库。
   认得的输入：'YYYY-MM-DD HH:MM:SS'（无时区，当作 UTC）/ 'YYYY-MM-DDTHH:MM:SSZ' /
   'YYYY-MM-DDTHH:MM:SS+08:00'；空的或认不出的返回空串，绝不乱显示。
   style：'short' → 'MM-DD HH:MM'（列表用）／'full' → 带秒／'date' → 只要日期／
          默认 → 'YYYY-MM-DD HH:MM'
   ============================================================ */
function parseServerTime(text) {
  const raw = String(text === undefined || text === null ? '' : text).trim();
  if (!raw) return null;

  let d = null;
  if (/[zZ]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)) {
    d = new Date(raw);                         /* 已经带时区，直接解析 */
  } else {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    /* 不带时区的一律当 UTC（库里就是 UTC 写的）——不补 Z 就会被当成本地时间，正是原来差 8 小时的原因 */
    d = m
      ? new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00') + 'Z')
      : new Date(raw);
  }
  return (d && !isNaN(d.getTime())) ? d : null;
}

function formatBeijingTime(text, style) {
  const d = parseServerTime(text);
  if (!d) return '';
  const bj = new Date(d.getTime() + 8 * 60 * 60 * 1000);   /* UTC+8，全年固定 */
  const p = n => String(n).padStart(2, '0');
  const date = bj.getUTCFullYear() + '-' + p(bj.getUTCMonth() + 1) + '-' + p(bj.getUTCDate());
  const hm = p(bj.getUTCHours()) + ':' + p(bj.getUTCMinutes());
  if (style === 'short') return date.slice(5) + ' ' + hm;
  if (style === 'full') return date + ' ' + hm + ':' + p(bj.getUTCSeconds());
  if (style === 'date') return date;
  return date + ' ' + hm;
}

function sumSponsors(d1People, fileList) {
  const seen = Object.create(null);
  let total = 0;

  function add(person, amountText) {
    const name = String(person && person.name || '').trim();
    if (!name || seen[name]) return;   /* 没名字的丢掉；同名的先来的赢（D1 先入列） */
    seen[name] = true;
    total += parseMoney(amountText);
  }

  (Array.isArray(d1People) ? d1People : []).forEach(p => add(p, p && (p.platform || p.amount)));
  (Array.isArray(fileList) ? fileList : []).forEach(p => add(p, p && (p.amount || p.platform)));
  return total;
}

async function fillSponsorTotal() {
  const els = document.querySelectorAll('[data-sponsor-total]');
  if (els.length === 0) return;

  let groups;
  try {
    const res = await fetch('/api/thanks?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    groups = await res.json();
  } catch (e) {
    return;   /* 拿不到 D1 就保持 HTML 里的兜底数字 */
  }
  if (!Array.isArray(groups)) return;

  let people = [];
  groups.forEach(cat => {
    if (!cat || cat.category !== SPONSOR_CATEGORY) return;
    if (Array.isArray(cat.people)) people = people.concat(cat.people);
  });

  let fileList = [];
  try {
    const fres = await fetch('data/sponsors.json?t=' + Date.now(), { cache: 'no-store' });
    const fdata = await fres.json();
    if (Array.isArray(fdata)) fileList = fdata;
    else if (fdata && Array.isArray(fdata.sponsors)) fileList = fdata.sponsors;
  } catch (e) { /* 底档读不到不影响：D1 那份已经够算 */ }

  const text = formatMoney(sumSponsors(people, fileList));
  els.forEach(el => { el.textContent = text; });
}

/* ============================================================
   0.7 分享本站
   ------------------------------------------------------------
   设计（尽量简单、零成本、不依赖任何第三方 SDK）：
     ① 入口：页面上任何带 data-share 属性的元素都能唤起弹窗（事件委托，只绑一次）；
     ② 弹窗里给四件事：复制「文案 + 链接」、只复制文案、只复制链接、
        系统分享（手机原生菜单，浏览器支持时才显示）；
     ③ 复制走本文件自己的 copyText()（带超时回退），成功 / 失败都给一句 toast；
     ④ 文案里自带站点地址，别人粘贴出去，链接就跟着走。
   不联网、不埋点、不弹第三方窗口；用户取消系统分享不算错误。
   ============================================================ */
const SHARE_SITE = 'https://zhiwumansui.pages.dev';
const SHARE_TITLE = '织雾满穗';
/* 推荐文案（不带网址）——「只复制文案」就是它，逐字可读、不带尾巴 */
const SHARE_TEXT =
  '我发现一个小站「织雾满穗」：Roblox 音乐/音效 ID 宝库，能搜索、能筛选、一键复制，手机也能用，' +
  '还有几个打开就能用的小工具。';

/* 「文案 + 链接」：在推荐语后面换一行接网址，粘出去既有话说又有链接 */
function shareTextWithLink() {
  return SHARE_TEXT + '\n分享给你看看 → ' + SHARE_SITE;
}

function buildShareModal() {
  let modal = document.getElementById('inviteModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'inviteModal';
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'inviteTitle');
  modal.innerHTML = `
    <div class="modal-content zb-invite-modal">
      <h2 id="inviteTitle">🔗 把织雾满穗分享出去</h2>
      <p class="zb-invite-lead">这个小站是业余时间一个人做的。如果它帮到过你，把它发给一个可能用得上的人，就是最好的支持 ❤️</p>
      <div class="zb-invite-label" id="inviteTextLabel">分享文案（复制后粘到 QQ / 微信 / 抖音 / B 站都行）</div>
      <textarea class="zb-invite-text" id="inviteText" rows="4" readonly aria-labelledby="inviteTextLabel"></textarea>
      <div class="zb-invite-actions">
        <button type="button" class="btn btn-primary" id="inviteCopyAll">📋 复制文案 + 链接</button>
        <button type="button" class="btn btn-secondary" id="inviteCopyText">📄 只复制文案</button>
        <button type="button" class="btn btn-secondary" id="inviteCopyLink">🔗 只复制链接</button>
        <button type="button" class="btn btn-secondary" id="inviteNative" hidden>📤 系统分享</button>
      </div>
      <p class="zb-invite-tips">💡 只想要一段话就点「📄 只复制文案」；想带上网址就点「📋 复制文案 + 链接」；
        手机上点「📤 系统分享」可以直接发给微信 / QQ 好友。</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="inviteClose">关闭</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const textEl = document.getElementById('inviteText');
  textEl.value = shareTextWithLink();

  const nativeBtn = document.getElementById('inviteNative');
  if (nativeBtn && navigator.share) nativeBtn.hidden = false;

  document.getElementById('inviteCopyAll').addEventListener('click', async () => {
    const ok = await copyText(textEl.value);
    showToast(ok ? '📋 已复制「文案 + 链接」，粘贴到群里就能分享' : '复制失败，请手动选中上面的文字复制');
  });
  document.getElementById('inviteCopyText').addEventListener('click', async () => {
    const ok = await copyText(SHARE_TEXT);
    showToast(ok ? '📄 已复制文案（不含链接）' : '复制失败，请手动选中上面的文字复制');
  });
  document.getElementById('inviteCopyLink').addEventListener('click', async () => {
    const ok = await copyText(SHARE_SITE);
    showToast(ok ? '🔗 链接已复制' : '复制失败，请手动复制上面的文字');
  });
  if (nativeBtn) {
    nativeBtn.addEventListener('click', async () => {
      try {
        await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: SHARE_SITE });
      } catch (e) { /* 用户点了取消，不用提示 */ }
    });
  }
  document.getElementById('inviteClose').addEventListener('click', () => closeModal('inviteModal'));

  return modal;
}

function openShareModal() {
  buildShareModal();
  openModal('inviteModal');
}

function initShareTriggers() {
  document.addEventListener('click', e => {
    /* 新写法是 [data-invite]；[data-share] 留着兼容可能还缓存在访客浏览器里的旧页面。
       （改名的原因见 css/style.css 里 .zb-invite 那段注释：电脑上的广告拦截插件
        会按 class / 属性里有没有 share 来隐藏元素。）
       2026-11-23：首页那颗按钮已改成「💡 功能建议」，这里保留旧入口兼容旧缓存页面。 */
    const trigger = e.target.closest && e.target.closest('[data-invite], [data-share]');
    if (!trigger) return;
    e.preventDefault();
    openShareModal();
  });
}

/* ============================================================
   0.8 功能建议
   ------------------------------------------------------------
   为什么有这一节（2026-11-23）：
     站主要开始收集玩家对网站功能的任何建议。首页原来那颗
     「🔗 分享本站」按钮改成「💡 功能建议」，点开是这个表单。
   分类口径（与 js/book.js 的 CHAPTERS 同步）：
     · 第几章：第一章 · 雾起 … 第五章 · 投桃；也可以选「整站 / 不确定」；
     · 第一章再多一层「【卡片】」：Roblox ID 宝库 / 临界 · 紧急调度 / 怀旧版 · 时光机；
       其它章节如果页面里有 .section-head，也会列出「第几幕」。
   数据流向：POST /api/suggestions/submit → D1 的 feature_suggestions 表
     → 后台「💡 功能建议」面板。公开页面不显示任何建议。
   隐私：只提交昵称 / 分类 / 正文；IP 只在服务端内存里做限速，不落库。
   【回退办法】删掉本节 + initUI 里的 initSuggestTriggers() + 全局导出里的
     openSuggestModal；再把 index.html 那颗按钮改回 data-invite 即可。
   ============================================================ */
const SUGGEST_CHAPTERS = [
  { key: 'index', label: '第一章 · 雾起' },
  { key: 'roblox_music', label: '第二章 · 拾穗' },
  { key: 'law', label: '第三章 · 立规' },
  { key: 'thanks', label: '第四章 · 结草' },
  { key: 'support', label: '第五章 · 投桃' }
];

/* 第一章那张卡片的顺序/名字从首页 #contentGrid 读，卡片改了不用改这里；
   只有「时光机」这类 card-tag 比标题更好认的，补一个短名字。 */
const SUGGEST_CARD_LABELS = { '时光机': '怀旧版 · 时光机' };

let suggestPlaceSeq = 0;
const suggestDocCache = Object.create(null);

function currentSuggestChapter() {
  const seg = (location.pathname.split('/').pop() || 'index.html')
    .toLowerCase().replace(/\.html?$/i, '');
  return seg || 'index';
}

/* 与 book.js 的 han() 同一口径：第几幕最多到 99，够用 */
function suggestHan(n) {
  const s = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (n <= 10) return s[n];
  if (n < 20) return '十' + s[n - 10];
  return String(n);
}

/* 当前页直接用 document；别的章节去同源拿 HTML 再解析。
   只在打开弹窗 / 切章节时发生，且按章节缓存，不会每次输入都请求。 */
function suggestChapterUrl(key) {
  const isFile = /\.html?$/i.test(location.pathname);
  if (key === 'index') return isFile ? 'index.html' : './';
  return isFile ? key + '.html' : key;
}

async function getSuggestChapterDoc(key) {
  if (key === currentSuggestChapter()) return document;
  if (suggestDocCache[key]) return suggestDocCache[key];

  const res = await fetch(suggestChapterUrl(key), { credentials: 'same-origin' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  suggestDocCache[key] = doc;
  return doc;
}

/* 第一章首页的卡片：标题取 h3；「时光机」用短名字，玩家一眼能对上 */
function collectSuggestCards(doc) {
  const out = [];
  doc.querySelectorAll('#contentGrid .card').forEach(card => {
    const h = card.querySelector('h3');
    if (!h) return;
    const category = String(card.getAttribute('data-category') || '').trim();
    const title = h.textContent.trim();
    if (!title) return;
    out.push(SUGGEST_CARD_LABELS[category] || title);
  });
  return out;
}

/* 章节里的「幕」：与 book.js 的 numberActs() 同一口径；
   当前页的 DOM 已经编过号，直接读 .act-no，别的页面按顺序补。 */
function collectSuggestActs(doc) {
  const out = [];
  doc.querySelectorAll('main .section-head').forEach(head => {
    if (head.closest('.modal') || head.hasAttribute('data-no-act')) return;
    const h = head.querySelector('h1, h2');
    if (!h) return;
    const tag = head.querySelector('.act-no');
    out.push({
      no: tag ? tag.textContent.trim() : ('第' + suggestHan(out.length + 1) + '幕'),
      title: h.textContent.trim()
    });
  });
  return out;
}

async function collectSuggestPlaces(key) {
  if (!key) return { cards: [], acts: [] };
  try {
    const doc = await getSuggestChapterDoc(key);
    return {
      cards: key === 'index' ? collectSuggestCards(doc) : [],
      acts: collectSuggestActs(doc)
    };
  } catch (e) {
    /* 拿不到就当这一章没有分幕，只留「整章 / 不确定」——不挡提交 */
    return { cards: [], acts: [] };
  }
}

function currentSuggestActIndex() {
  try {
    const r = JSON.parse(localStorage.getItem('zm_read') || 'null');
    if (r && r.page === currentSuggestChapter() && Number(r.act) > 0) return Number(r.act);
  } catch (e) {}
  return 0;
}

function updateSuggestWhere() {
  const ch = document.getElementById('suggestChapter');
  const place = document.getElementById('suggestPlace');
  const hint = document.getElementById('suggestWhere');
  if (!ch || !place || !hint) return;

  if (!ch.value) {
    hint.textContent = '📍 这条建议会归到：整站 / 不确定';
    return;
  }
  const chapterText = ch.options[ch.selectedIndex] ? ch.options[ch.selectedIndex].textContent : ch.value;
  hint.textContent = '📍 这条建议会归到：' + chapterText + ' · ' + (place.value || '整章 / 不确定');
}

async function loadSuggestPlaces(prefillAct) {
  const chapterSel = document.getElementById('suggestChapter');
  const placeSel = document.getElementById('suggestPlace');
  if (!chapterSel || !placeSel) return;

  const key = String(chapterSel.value || '');
  const seq = ++suggestPlaceSeq;

  placeSel.innerHTML = '<option value="">读取章节位置…</option>';
  placeSel.disabled = true;

  const groups = await collectSuggestPlaces(key);
  if (seq !== suggestPlaceSeq) return;   /* 用户又切章了，丢弃这次结果 */

  placeSel.innerHTML = '';

  const whole = document.createElement('option');
  whole.value = '';
  whole.textContent = key ? '整章 / 不确定' : '不限（整站）';
  placeSel.appendChild(whole);

  if (groups.cards.length) {
    const og = document.createElement('optgroup');
    og.label = '【卡片】';
    groups.cards.forEach(title => {
      const opt = document.createElement('option');
      opt.value = '【卡片】' + title;
      opt.textContent = '【卡片】' + title;
      og.appendChild(opt);
    });
    placeSel.appendChild(og);
  }

  if (groups.acts.length) {
    const og = document.createElement('optgroup');
    og.label = '章内位置（第几幕）';
    groups.acts.forEach(act => {
      const opt = document.createElement('option');
      opt.value = act.no + ' · ' + act.title;
      opt.textContent = act.no + ' · ' + act.title;
      og.appendChild(opt);
    });
    placeSel.appendChild(og);
  }

  placeSel.disabled = false;

  /* 默认带到「你正在读的那一幕」；只有刚打开弹窗时这么做，
     手动切章节时保持「整章」，别把玩家拽到别的位置。 */
  if (prefillAct && key === currentSuggestChapter()) {
    const idx = currentSuggestActIndex();
    if (idx > 0) {
      const prefix = '第' + suggestHan(idx) + '幕';
      for (const opt of placeSel.options) {
        if (opt.value.indexOf(prefix) === 0) { placeSel.value = opt.value; break; }
      }
    }
  }

  updateSuggestWhere();
}

function setSuggestStatus(text, kind) {
  const el = document.getElementById('suggestStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'zb-suggest-status' + (kind ? ' ' + kind : '');
}

function suggestErrorText(code, status, wait) {
  if (code === 'too many requests') {
    return '发得有点勤，等 ' + (wait || '几分钟') + ' 秒再试。';
  }
  if (code === 'missing name') return '先留一个名字吧，昵称就行。';
  if (code === 'name too long') return '名字最多 40 个字。';
  if (code === 'missing content') return '建议内容还没写。';
  if (code === 'content too long') return '建议最多 500 个字，砍掉一点再发。';
  if (code === 'chapter too long' || code === 'category too long') return '选的位置太长了，刷新页面再试。';
  if (code === 'bad origin') return '来源校验没通过，刷新页面再试。';
  if (code === 'table missing') return '建议箱还没准备好，稍后再试；一直失败就发邮件找站主。';
  if (/turnstile/i.test(code || '')) return '人机验证没通过，刷新页面再试。';
  if (code === 'server error' || status >= 500) return '服务端出错了，稍后再试；一直失败就发邮件找站主。';
  return '提交失败（HTTP ' + status + '），稍后再试。';
}

function buildSuggestModal() {
  let modal = document.getElementById('suggestModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'suggestModal';
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'suggestTitle');
  modal.innerHTML = `
    <div class="modal-content zb-suggest-modal">
      <h2 id="suggestTitle">💡 给织雾满穗提个功能建议</h2>
      <p class="zb-suggest-lead">想要的新功能、用着别扭的地方、希望补的资料 —— 任何想法都可以。站主每个周末统一看。</p>

      <form id="suggestForm" novalidate>
        <div class="zb-suggest-grid">
          <div class="form-group">
            <label for="suggestChapter">分类 · 第几章</label>
            <select id="suggestChapter"></select>
          </div>
          <div class="form-group">
            <label for="suggestPlace">具体位置 <span class="zb-suggest-opt">选填 · 卡片 / 第几幕</span></label>
            <select id="suggestPlace"><option value="">整章 / 不确定</option></select>
          </div>
        </div>

        <p class="zb-suggest-where" id="suggestWhere">📍 这条建议会归到：整站 / 不确定</p>

        <div class="form-group">
          <label for="suggestName">你的名字 <span class="zb-suggest-req">*</span></label>
          <input type="text" id="suggestName" maxlength="40" autocomplete="nickname"
                 placeholder="昵称就行，不用真名">
        </div>

        <div class="form-group">
          <label for="suggestContent">建议内容 <span class="zb-suggest-req">*</span></label>
          <textarea id="suggestContent" maxlength="500" rows="5"
                    placeholder="越具体越好：你希望它怎么用？现在哪里不方便？"></textarea>
          <div class="zb-suggest-count"><span id="suggestCount">0</span> / 500</div>
        </div>

        <p class="zb-suggest-privacy">🔒 只保存你填的昵称和建议内容，不保存 IP，也不会公开。</p>
        <p class="zb-suggest-status" id="suggestStatus" role="status" aria-live="polite"></p>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="suggestCancel">取消</button>
          <button type="submit" class="btn btn-primary" id="suggestSubmit">📨 发送建议</button>
        </div>
      </form>

      <div class="zb-suggest-done" id="suggestDone" hidden>
        <div class="zb-suggest-done-icon" aria-hidden="true">🌸</div>
        <h3>建议收到啦</h3>
        <p id="suggestDoneText">谢谢你的想法。站主每个周末统一看，能做的会排进更新。</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="suggestDoneClose">关闭</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const chapterSel = document.getElementById('suggestChapter');
  chapterSel.innerHTML = '<option value="">整站 / 不确定</option>' +
    SUGGEST_CHAPTERS.map(c => '<option value="' + c.key + '">' + c.label + '</option>').join('');

  chapterSel.addEventListener('change', () => {
    setSuggestStatus('', '');
    loadSuggestPlaces(false);
  });
  document.getElementById('suggestPlace').addEventListener('change', updateSuggestWhere);

  const contentEl = document.getElementById('suggestContent');
  contentEl.addEventListener('input', () => {
    document.getElementById('suggestCount').textContent = String(contentEl.value.length);
  });

  document.getElementById('suggestCancel').addEventListener('click', () => closeModal('suggestModal'));
  document.getElementById('suggestDoneClose').addEventListener('click', () => closeModal('suggestModal'));
  document.getElementById('suggestForm').addEventListener('submit', submitSuggestForm);

  return modal;
}

async function submitSuggestForm(event) {
  event.preventDefault();

  const nameEl = document.getElementById('suggestName');
  const contentEl = document.getElementById('suggestContent');
  const chapterSel = document.getElementById('suggestChapter');
  const placeSel = document.getElementById('suggestPlace');
  const submitBtn = document.getElementById('suggestSubmit');

  const name = nameEl.value.trim();
  const content = contentEl.value.trim();
  const chapterKey = chapterSel.value;
  const chapterMeta = SUGGEST_CHAPTERS.find(c => c.key === chapterKey);
  const chapter = chapterMeta ? chapterMeta.label : '';
  const category = placeSel.value;

  if (!name) {
    setSuggestStatus('先留一个名字吧，昵称就行。', 'err');
    nameEl.focus();
    return;
  }
  if (name.length > 40) {
    setSuggestStatus('名字最多 40 个字。', 'err');
    nameEl.focus();
    return;
  }
  if (!content) {
    setSuggestStatus('建议内容还没写。', 'err');
    contentEl.focus();
    return;
  }
  if (content.length > 500) {
    setSuggestStatus('建议最多 500 个字，砍掉一点再发。', 'err');
    contentEl.focus();
    return;
  }

  submitBtn.disabled = true;
  setSuggestStatus('正在发送…', '');

  try {
    const payload = { name, chapter, category, content };
    const send = (window.ZMTurnstile && typeof window.ZMTurnstile.postJson === 'function')
      ? window.ZMTurnstile.postJson('/api/suggestions/submit', payload, 'suggest')
      : fetch('/api/suggestions/submit', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

    const res = await send;
    const data = await res.json().catch(() => null);

    if (res.ok && data && data.ok) {
      document.getElementById('suggestForm').hidden = true;
      document.getElementById('suggestDone').hidden = false;
      document.getElementById('suggestDoneText').textContent =
        '谢谢 ' + name + ' 的想法。站主每个周末统一看，能做的会排进更新。';

      /* 只清正文，名字留着：同一个人想再提一条时不用重填 */
      contentEl.value = '';
      document.getElementById('suggestCount').textContent = '0';
      setSuggestStatus('', '');
    } else {
      setSuggestStatus('❌ ' + suggestErrorText(data && data.error, res.status, data && data.wait), 'err');
      submitBtn.disabled = false;
    }
  } catch (e) {
    setSuggestStatus('❌ 网络好像断了，稍后再试。', 'err');
    submitBtn.disabled = false;
  }
}

async function openSuggestModal() {
  buildSuggestModal();

  const form = document.getElementById('suggestForm');
  const done = document.getElementById('suggestDone');
  const submitBtn = document.getElementById('suggestSubmit');
  const contentEl = document.getElementById('suggestContent');

  /* 每次打开都回到表单（上一条成功后的「收到啦」不留在下次） */
  form.hidden = false;
  done.hidden = true;
  submitBtn.disabled = false;
  setSuggestStatus('', '');
  document.getElementById('suggestCount').textContent = String(contentEl.value.length);

  const chapterSel = document.getElementById('suggestChapter');
  const here = currentSuggestChapter();
  const matched = SUGGEST_CHAPTERS.find(c => c.key === here);
  chapterSel.value = matched ? matched.key : '';

  openModal('suggestModal');

  /* 先显示弹窗再异步补位置：即使网络慢，玩家也能马上开始填。
     openModal 已经把焦点放到第一个可聚焦项（分类下拉），这里不再抢焦点。 */
  await loadSuggestPlaces(true);
}

function initSuggestTriggers() {
  document.addEventListener('click', e => {
    const trigger = e.target.closest && e.target.closest('[data-suggest]');
    if (!trigger) return;
    e.preventDefault();
    openSuggestModal();
  });
}

/* ============================================================
   1. 基础工具
   ============================================================ */

  /* 显示 Toast 短提示 */
  function showToast(msg, duration = 2500) {
    let el = document.getElementById('globalToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'globalToast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    /* 重新触发动画：先移除再强制重排 */
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), duration);
    return el;
  }

  /* 转义 HTML，防止 XSS（含引号，属性位置也安全）
     ------------------------------------------------------------
     性能说明：老写法是「建一个 div → 设 textContent → 读 innerHTML」，
     每次调用都要真的创建一个 DOM 节点。而宝库页渲染上千条数据时，
     这个函数会被调用上万次，光是造节点就很拖速度。
     改成纯字符串替换后，速度快一个数量级，而且完全不碰 DOM。 */
  const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  const HTML_ESCAPE_RE = /[&<>"']/g;

  function escapeHtml(text) {
    const str = text === undefined || text === null ? '' : String(text);
    /* 绝大多数文本里没有需要转义的字符，测试一次就能直接返回，省掉 replace */
    HTML_ESCAPE_RE.lastIndex = 0;
    if (!HTML_ESCAPE_RE.test(str)) return str;
    return str.replace(HTML_ESCAPE_RE, c => HTML_ESCAPE_MAP[c]);
  }

  /* 防抖函数 */
  function debounce(fn, wait = 300) {
    let timer;
    function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    }
    debounced.cancel = () => { clearTimeout(timer); timer = undefined; };
    return debounced;
  }

  /* ------------------------------------------------------------
     版本号排版：统一成 V1.0.0 这种三段式
     ------------------------------------------------------------
     历史遗留：公告工具早年把版本号存成 "v" + 毫秒时间戳（v1758212345678），
     界面上就是一长串数字，很难看。这个函数负责统一：

       v1758212345678     → V1.0.0   （老的时间戳：没有可读版本，从头编号）
       v2026.09.19-1830   → V1.0.0   （短暂的日期式，同样归零）
       v1.5.0 / V1.5.0    → V1.5.0
       1.5                → V1.5.0
       V2.0-beta          → V2.0-beta（自己写的就保留，只把 v 统一成大写）
     ------------------------------------------------------------ */
  function formatVersion(version) {
    const raw = String(version === undefined || version === null ? '' : version).trim();
    if (!raw) return '';

    const clean = raw.replace(/^[vV]/, '');

    let m = clean.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (m) return 'V' + m[1] + '.' + m[2] + '.' + m[3];

    m = clean.match(/^(\d+)\.(\d+)$/);
    if (m) return 'V' + m[1] + '.' + m[2] + '.0';

    /* 纯数字（含老时间戳）或日期式 → 没有可读版本号，统一从 V1.0.0 起 */
    if (/^\d+$/.test(clean)) return 'V1.0.0';
    if (/^\d{4}\.\d{2}\.\d{2}(-\d+)?$/.test(clean)) return 'V1.0.0';

    return 'V' + clean;
  }

  /* 节流（用于滚动 / 鼠标事件） */
  function throttle(fn, wait = 100) {
    let last = 0;
    let raf = null;
    return function (...args) {
      const now = Date.now();
      if (now - last < wait) {
        if (!raf) {
          raf = requestAnimationFrame(() => {
            raf = null;
            last = Date.now();
            fn.apply(this, args);
          });
        }
        return;
      }
      last = now;
      fn.apply(this, args);
    };
  }

  /* 复制文本到剪贴板（现代 API 失败或卡住时，回退到 execCommand） */
  async function copyText(text) {
    const value = String(text ?? '');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        /* 这里必须加超时：
           部分浏览器在页面失去焦点等情况下，clipboard.writeText() 会一直挂着，
           既不成功也不报错，表现就是「按钮点了没反应」。
           最多等 1200ms，超时就走下面的兼容方案。 */
        const ok = await Promise.race([
          navigator.clipboard.writeText(value).then(() => true),
          new Promise(resolve => setTimeout(() => resolve(null), 1200))
        ]);
        if (ok === true) return true;
      } catch (e) {
        /* 权限被拒 / 非安全上下文，继续走回退方案 */
      }
    }

    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ============================================================
     2. 弹窗系统（含 ESC / 点击遮罩关闭 / 焦点管理）
     ============================================================ */
  const closeTimers = new Map();   /* modalId -> timeout */
  const returnFocus = new Map();   /* modalId -> element */
  const modalStack = [];           /* 打开顺序 */

  function focusables(root) {
    return Array.from(root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null || el === document.activeElement);
  }

  /* 打开弹窗（同时锁住页面滚动） */
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;

    /* 若正处于关闭动画中，取消它 */
    if (closeTimers.has(id)) {
      clearTimeout(closeTimers.get(id));
      closeTimers.delete(id);
    }

    modal.classList.remove('closing');

    if (!modal.classList.contains('show')) {
      returnFocus.set(id, document.activeElement);
      modal.classList.add('show');
      modalStack.push(id);
    }

    if (!modal.hasAttribute('role')) modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    document.body.classList.add('modal-open');

    /* 焦点进入弹窗（下一帧，等动画开始） */
    requestAnimationFrame(() => {
      if (!modal.classList.contains('show')) return;
      const list = focusables(modal);
      const first = list[0];
      if (first && !modal.contains(document.activeElement)) {
        try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
      }
    });
  }

  /* 关闭弹窗（带退出动画） */
  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    if (!modal.classList.contains('show') && !modal.classList.contains('closing')) return;

    modal.classList.add('closing');

    /* 让页面有机会同步清理自己的状态（例如倒计时） */
    document.dispatchEvent(new CustomEvent('zm:modalclose', { detail: { id } }));

    clearTimeout(closeTimers.get(id));
    const timer = setTimeout(() => {
      closeTimers.delete(id);
      modal.classList.remove('show', 'closing');
      const idx = modalStack.indexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);

      if (!document.querySelector('.modal.show')) {
        document.body.classList.remove('modal-open');
      } else {
        document.body.classList.add('modal-open');
      }

      const back = returnFocus.get(id);
      returnFocus.delete(id);
      if (back && typeof back.focus === 'function' && document.contains(back)) {
        try { back.focus({ preventScroll: true }); } catch (e) {}
      }
    }, 220);
    closeTimers.set(id, timer);
  }

  function closeTopModal() {
    if (modalStack.length === 0) return false;
    closeModal(modalStack[modalStack.length - 1]);
    return true;
  }

  /* 全局键盘 / 遮罩交互：只绑定一次 */
  let modalA11yBound = false;
  function bindModalA11y() {
    if (modalA11yBound) return;
    modalA11yBound = true;

    document.addEventListener('keydown', e => {
      const open = document.querySelector('.modal.show');
      if (!open) return;

      if (e.key === 'Escape') {
        /* data-no-esc="true" 的弹窗（例如全站必读公告）：键盘也关不掉 */
        if (open.dataset.noEsc === 'true') return;
        e.preventDefault();
        closeTopModal();
        return;
      }

      if (e.key === 'Tab') {
        const list = focusables(open);
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    /* 【2026-09-27 用户要求】所有弹窗一律不能「点空白处（遮罩）」关闭。
       原来这里有一段 mousedown + click 判断并 closeModal 的逻辑，已整段删除。
       现在关弹窗只能靠弹窗里的按钮；
       需要连 ESC 也关不掉的弹窗，在元素上写 data-no-esc="true"（见上面的 keydown 分支）。 */
  }

  /* ============================================================
     3. 顶部提示条
     ============================================================ */
  function showNotice(msg, duration = 3000) {
    let el = document.getElementById('globalNotice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'globalNotice';
      el.className = 'notice-bar';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    /* 清掉上一次的自动关闭，避免与新提示打架 */
    clearTimeout(el._timer);
    el.classList.add('show');
    el.textContent = msg;
    el._timer = setTimeout(() => el.classList.remove('show'), duration);
    return el;
  }

  /* ============================================================
     4. 确认弹窗（返回 Promise）
     ============================================================ */
  let pendingConfirmResolve = null;

  function showConfirm(title, message, options = {}) {
    return new Promise(resolve => {
      /* 若上一次确认框还没结束，先按“取消”收尾，防止 Promise 永久挂起 */
      if (pendingConfirmResolve) {
        const prev = pendingConfirmResolve;
        pendingConfirmResolve = null;
        prev(false);
      }

      let modal = document.getElementById('globalConfirm');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'globalConfirm';
        modal.className = 'modal';
        modal.innerHTML = `
          <div class="modal-content">
            <h2 id="gcTitle"></h2>
            <p id="gcMessage"></p>
            <div class="modal-actions">
              <button class="btn btn-secondary" id="gcCancel">取消</button>
              <button class="btn btn-primary" id="gcOk">确认</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }

      document.getElementById('gcTitle').textContent = title;
      document.getElementById('gcMessage').textContent = message;

      const okBtn = document.getElementById('gcOk');
      const cancelBtn = document.getElementById('gcCancel');
      okBtn.textContent = options.okText || '确认';
      cancelBtn.textContent = options.cancelText || '取消';
      okBtn.classList.toggle('btn-danger', options.danger === true);
      okBtn.classList.toggle('btn-primary', options.danger !== true);

      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        pendingConfirmResolve = null;
        closeModal('globalConfirm');
        resolve(value);
      };

      pendingConfirmResolve = finish;
      okBtn.onclick = () => finish(true);
      cancelBtn.onclick = () => finish(false);

      openModal('globalConfirm');

      /* ESC / 点遮罩也算取消 */
      const onClose = e => {
        if (e.detail.id !== 'globalConfirm') return;
        document.removeEventListener('zm:modalclose', onClose);
        finish(false);
      };
      document.addEventListener('zm:modalclose', onClose);
    });
  }

  /* ============================================================
     5. 页面装修：氛围层、主题开关、回到顶部、进度条、揭示动画
     ============================================================ */
  const FX_ENABLED = () => document.documentElement.getAttribute('data-fx') !== 'off';

  function hasSharedStyles() {
    return !!document.querySelector('link[href*="style.css"]');
  }

  /* ------------------------------------------------------------
     精简模式（lite）
     ------------------------------------------------------------
     目的：在手机、低配设备、省流量模式下自动「关掉好看但不划算的特效」，
     换来更顺滑的滚动和更快的打开速度。判断依据：
       · 屏幕宽度 ≤ 768px（先按手机处理，稳妥）
       · 系统开了「减少动态效果」
       · CPU 核心数 ≤ 4 或内存 ≤ 4GB（navigator 只在部分浏览器提供）
       · 开了省流量模式
     ------------------------------------------------------------ */
  function isLiteMode() {
    if (!window.matchMedia) return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    if (window.matchMedia('(max-width: 768px)').matches) return true;

    const cores = navigator.hardwareConcurrency || 0;
    const memory = navigator.deviceMemory || 0;
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && conn.saveData) return true;
    if (cores && cores <= 4) return true;
    if (memory && memory <= 4) return true;

    return false;
  }

  function applyLiteMode() {
    /* 用户在「设置」里手动挑过动效档位就听他的（book.js 会写 __ZM_FX_LOCK）；
       没挑过才按设备自动降级 —— 否则手机上一选「完整」又被打回精简。 */
    if (window.__ZM_FX_LOCK) {
      document.documentElement.classList.toggle('lite', window.__ZM_FX_LOCK !== 'full');
      return;
    }
    if (isLiteMode()) document.documentElement.classList.add('lite');
  }

  /* ------------------------------------------------------------
     小粒子背景
     ------------------------------------------------------------
     以前这里是一团「跟着鼠标跑的光」，用得不多、还一直占着一块合成层。
     现在换成十几个慢慢飘的小光点：
       · 纯 CSS 动画，只改 transform / opacity → 全部由显卡处理，不重绘；
       · 元素非常小（2~4px），显存占用可以忽略；
       · 精简模式下完全不生成；
       · 标签页切到后台时浏览器会自动暂停动画，不费电。
     ------------------------------------------------------------ */
  const PARTICLE_COUNT = 16;

  function injectParticles() {
    if (!FX_ENABLED() || !hasSharedStyles()) return;
    if (document.querySelector('.particles')) return;
    if (document.documentElement.classList.contains('lite')) return;

    const box = document.createElement('div');
    box.className = 'particles';
    box.setAttribute('aria-hidden', 'true');

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const dot = document.createElement('i');

      /* 位置、大小、速度都错开，看起来才自然；用取模保证每次刷新都一样，
         不会出现「这次粒子全挤在一边」的情况 */
      const left = (i * 37 + 11) % 100;
      const top = (i * 53 + 7) % 100;
      const size = 4 + (i % 3);                    /* 4 / 5 / 6 px */
      const dur = 16 + (i % 5) * 5;                /* 16 ~ 36 秒 */
      const delay = -(i * 2.7).toFixed(1);         /* 负延迟：一开始就散开 */
      /* 透明度不能太低：之前用 0.25~0.61，再乘上颜色自身的透明度，
         实际只剩一成多，在浅粉背景上基本看不见（实测对比度仅 1.8:1）。
         现在颜色是不透明的，柔不柔就靠这个值，实测对比度 3.4~5.5:1。 */
      const opacity = 0.75 + (i % 4) * 0.09;       /* 0.75 / 0.84 / 0.93 / 1.00 */

      dot.style.left = left + '%';
      dot.style.top = top + '%';
      dot.style.width = size + 'px';
      dot.style.height = size + 'px';
      dot.style.opacity = String(opacity.toFixed(2));
      dot.style.animationDuration = dur + 's';
      dot.style.animationDelay = delay + 's';

      box.appendChild(dot);
    }

    document.body.appendChild(box);
  }

  function injectAtmosphere() {
    if (!FX_ENABLED() || !hasSharedStyles()) return;

    /* 背景：一块静态的柔和渐变。
       以前这里还有三个「一直在飘」的大色斑 —— 那是三块接近半屏大小的合成层，
       每帧都要交给显卡合成，收益（几乎看不出来的缓慢移动）远小于代价，已经去掉。 */
    if (!document.querySelector('.aurora-bg')) {
      const aurora = document.createElement('div');
      aurora.className = 'aurora-bg';
      aurora.setAttribute('aria-hidden', 'true');
      document.body.appendChild(aurora);
    }

    injectParticles();
  }

  function injectThemeToggle() {
    /* 已经有就不要重复注入 */
    if (document.querySelector('.theme-toggle')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.addEventListener('click', toggleTheme);

    /* 1) 常规页面：挂在导航栏里 */
    const nav = document.querySelector('.navbar .nav-links');
    if (nav) {
      const li = document.createElement('li');
      li.appendChild(btn);
      nav.appendChild(li);
      applyTheme(currentTheme());
      return;
    }

    /* 2) 后台页：挂在顶栏操作区 */
    const adminActions = document.querySelector('.admin-topbar .actions');
    if (adminActions) {
      adminActions.appendChild(btn);
      applyTheme(currentTheme());
      return;
    }

    /* 3) 指定插槽 */
    const slot = document.querySelector('[data-theme-slot]');
    if (slot) {
      slot.appendChild(btn);
      applyTheme(currentTheme());
    }
  }

  function injectBackToTop() {
    if (document.querySelector('.back-to-top')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'back-to-top';
    btn.setAttribute('aria-label', '回到顶部');
    btn.setAttribute('title', '回到顶部');
    btn.textContent = '↑';
    btn.addEventListener('click', () => {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
    document.body.appendChild(btn);
    return btn;
  }

  function injectScrollProgress() {
    if (document.querySelector('.scroll-progress')) return null;
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    return bar;
  }

  function initReveal() {
    const items = document.querySelectorAll('.reveal');
    if (items.length === 0) return;

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      items.forEach(el => el.classList.add('is-visible'));
      return;
    }

    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const delay = Number(el.dataset.revealDelay || 0);
        setTimeout(() => el.classList.add('is-visible'), delay);
        obs.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    items.forEach(el => io.observe(el));
  }

  /* 按钮水波纹 */
  function initRipple() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    const SELECTOR = '.btn, .btn-more, .visit-source-btn, .theme-toggle, .back-to-top';
    document.addEventListener('pointerdown', e => {
      const target = e.target.closest && e.target.closest(SELECTOR);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const size = Math.max(rect.width, rect.height);
      const span = document.createElement('span');
      span.className = 'ripple';
      span.style.width = span.style.height = size + 'px';
      span.style.left = (e.clientX - rect.left - size / 2) + 'px';
      span.style.top = (e.clientY - rect.top - size / 2) + 'px';

      const prevPosition = getComputedStyle(target).position;
      if (prevPosition === 'static') target.style.position = 'relative';
      target.appendChild(span);
      setTimeout(() => span.remove(), 650);
    }, { passive: true });
  }

  /* 导航栏滚动阴影 + 回到顶部显隐 + 进度条 */
  function initScrollUI() {
    const bar = injectScrollProgress();
    const topBtn = injectBackToTop();
    const navbar = document.querySelector('.navbar');

    let lastPct = -1;
    let lastScrolled = null;
    let lastTopShown = null;

    const onScroll = throttle(() => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;

      /* 每一项都先比较再写：避免「值没变还去改样式」白白触发一次样式重算 */
      if (navbar) {
        const scrolled = y > 8;
        if (scrolled !== lastScrolled) {
          navbar.classList.toggle('scrolled', scrolled);
          lastScrolled = scrolled;
        }
      }

      if (topBtn) {
        const shown = y > 360;
        if (shown !== lastTopShown) {
          topBtn.classList.toggle('show', shown);
          lastTopShown = shown;
        }
      }

      if (bar) {
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const pct = docHeight > 0 ? Math.min(100, Math.max(0, (y / docHeight) * 100)) : 0;
        /* 用 scaleX 代替 width：改 width 要重新排版，scaleX 只是图形变换。
           再取整到 0.5%，省掉大量几乎看不见的微小更新。 */
        const rounded = Math.round(pct * 2) / 2;
        if (rounded !== lastPct) {
          bar.style.transform = 'scaleX(' + (rounded / 100) + ')';
          lastPct = rounded;
        }
      }
    }, 60);

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
  }

  /* 页面离场过渡（仅同源内部链接） */
  function initPageTransition() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href) return;
      if (a.target && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;
      if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return;

      let url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;

      e.preventDefault();
      /* 2026-11-06 性能：离场过渡从 0.22s / 等待 200ms 压到 0.14s / 等待 80ms。
         实测这 200ms 是**每次站内点击都要先等**的固定开销（点击→开始导航 = 204ms），
         在本来就要等网络的情况下纯属雪上加霜；80ms 仍然看得到淡出，但不会拖慢跳转。
         【回退办法】把 0.14s 改回 0.22s、80 改回 200。 */
      document.body.style.transition = 'opacity 0.14s ease, transform 0.14s ease';
      document.body.style.opacity = '0';
      document.body.style.transform = 'translateY(-6px)';

      let navigated = false;
      const go = () => {
        if (navigated) return;
        navigated = true;
        location.href = url.href;
      };
      setTimeout(go, 80);

      /* 安全兜底：若跳转因故未发生（例如目标不存在被拦截），恢复页面可见 */
      setTimeout(() => {
        if (navigated && document.visibilityState === 'visible') {
          document.body.style.opacity = '';
          document.body.style.transform = '';
        }
      }, 1400);
    });
  }

  /* ============================================================
     5.4b 本地双击（file://）兜底：干净 URL → .html
     ------------------------------------------------------------
     2026-11-06：站内链接从 `xxx.html` 改成 Cloudflare Pages 的干净 URL（xxx），
     换来的是每次点击少一次 308 往返。但这样一来，**双击 index.html 用 file://
     打开时**，`./`、`thanks` 这些地址在磁盘上并不存在，纯本地只读浏览会点不动。
     这里只在 file: 协议下把 href 还原成对应的 .html；线上 http(s) 完全不执行。
     【回退办法】删掉 initLocalFileLinks 函数及 initUI 里那一行调用即可。
     ============================================================ */
  function initLocalFileLinks() {
    if (location.protocol !== 'file:') return;
    const map = {
      './': 'index.html',
      'roblox_music': 'roblox_music.html',
      'thanks': 'thanks.html',
      'law': 'law.html',
      'admin': 'admin.html',
      'emergency/': 'emergency/index.html',
      'legacy/2026-08-25/': 'legacy/2026-08-25/index.html'
    };
    /* 2026-11-07：建议 / 反馈两页已整块删除，这里对应的两条本地路径映射一并去掉。 */
    document.querySelectorAll('a[href]').forEach(a => {
      const h = a.getAttribute('href');
      if (Object.prototype.hasOwnProperty.call(map, h)) a.setAttribute('href', map[h]);
    });
  }

  /* ============================================================
     5.5 （已删除）全站必读公告弹窗
     ------------------------------------------------------------
     2026-11-21：首页「📢 公告」与对应的必读公告弹窗一起下线，
     原位置改成静态的「关于我」；访客侧不再有这份公告的任何入口。
     【回退办法】从 git 上一个版本取回本节 + index.html 的公告条即可。
     ============================================================ */

    /* 统一初始化 */function initUI() {
  applyLiteMode();
  fillSiteCost();
  fillSponsorTotal();     /* 「收到的赞助」：按 D1 + 底档现算（0.6 节） */
  initShareTriggers();    /* 旧版 [data-invite] 分享入口（兼容缓存页面） */
  initSuggestTriggers();  /* 首页「💡 功能建议」入口（0.8 节） */
    bindModalA11y();
    injectAtmosphere();
    injectThemeToggle();

  /* 2026-10-18：页脚年份统一兜底。
     原来只有 index / thanks / roblox 三页会自己回填，law 与 admin 是写死的 2026，
     到 2027 年就会出现「首页 2027、法律页 2026」。【回退办法】删掉这 4 行。 */
  try {
    document.querySelectorAll('#year, #footerYear').forEach(el => {
      el.textContent = new Date().getFullYear();
    });
  } catch (e) {}
    initScrollUI();
    initRipple();
    initReveal();
    initLocalFileLinks();   /* 仅 file:// 下生效：把干净 URL 还原成 .html，保住本地双击浏览 */
    initPageTransition();

    /* 2026-10-05：原来这里还会调 checkFeedbackDecision() 去查「我提过的反馈有没有被处理」。
       反馈功能整页下线（feedback.html 已删、/api/feedback/* 已删），回执弹窗一并删除。 */

    /* 2026-10-26 站主要求：把「反馈结果」弹窗删除。
       所以这里不再调用 checkReportNotices，上报结果只在上报者自己的「📌 我上报的」里显示。
       （checkReportNotices / showReportNotices 两个函数连同 CSS 已删；/api/notices/mine 保留但不再被调用。）
       【回退办法】把下面这一行放回来，并从 git 历史恢复 common.js 的 10.5 节：
         setTimeout(checkReportNotices, 1200); */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }

  /* ============================================================
     6. 版本更新检查（图片弹窗版）
     ============================================================ */
  /* 取某个页面的更新公告。
     2026-09-29：公告不再走 D1 / 后台 —— 后台的「更新管理」已下线，
     改成仓库里的静态文件 data/updates.json（AI 完成改动后直接写这个文件）。
     文件读不到（旧缓存 / 还没部署上）就退回老接口 /api/updates，保证公告不会因此消失。 */
  async function loadPageUpdate(pageKey, controller) {
  /* 2026-10-18 性能：原来每次导航都 fetch 一次 updates.json（还带 ?t= 时间戳，必不命中缓存）。
     现在 60 秒内只查一次 —— 公告晚 60 秒对访客毫无影响（还要跟本地版本号比对才弹）。
     【回退办法】删掉下面这段节流即可。 */
  try {
    /* 2026-10-24 修：原来是全站共用一个 zm_upd_t，导致「首页弹过之后，
       60 秒内其它页面全被跳过」。现在按页面分开记。 */
    const throttleKey = 'zm_upd_t_' + pageKey;
    const lastUpdAt = Number(sessionStorage.getItem(throttleKey)) || 0;
    if (Date.now() - lastUpdAt < 60000) return null;
    sessionStorage.setItem(throttleKey, String(Date.now()));
  } catch (e) {}
    const signal = controller ? controller.signal : undefined;

    try {
      const res = await fetch('data/updates.json?t=' + Date.now(), { cache: 'no-store', signal });
      if (res.ok) {
        const file = await res.json();
        const rec = file && file[pageKey];
        if (rec && rec.version) return rec;
      }
    } catch (e) { /* 文件没读到就走下面的老接口 */ }

    try {
      const res = await fetch(`/api/updates?page=${encodeURIComponent(pageKey)}&t=${Date.now()}`, {
        cache: 'no-store',
        signal
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.ok || !data.data) return null;
      return data.data;
    } catch (e) {
      return null;
    }
  }

  async function checkPageUpdate(pageKey) {
    const storageKey = `pageVersion_${pageKey}`;

    let version, date, updates;

    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;

      const rec = await loadPageUpdate(pageKey, controller);
      if (timer) clearTimeout(timer);

      if (!rec) return;
      version = rec.version;
      date = rec.date;
      updates = rec.updates;
    } catch (e) {
      return;
    }

    let stored = null;
    try { stored = localStorage.getItem(storageKey); } catch (e) {}
    if (stored === version) return;

    let cfg = null;
    if (Array.isArray(updates) && updates.length > 0) {
      const first = updates[0];
      if (typeof first === 'string') {
        try {
          const parsed = JSON.parse(first);
          if (parsed && typeof parsed === 'object' && parsed.theme) cfg = parsed;
        } catch (e) {}
      }
    }

    if (!cfg) {
      showOldTextModal(version, date, updates, storageKey);
      return;
    }

    /* 等弹窗样式加载好再弹，避免"先没样式、后跳成正常"的闪一下 */
    await injectUpdateImageCSS();

    if (window.innerWidth < 640) {
      showSimpleUpdateModal(cfg, version, storageKey);
    } else {
      showCanvasUpdateModal(cfg, version, storageKey);
    }
  }

  /* 安全写入 localStorage（隐私模式 / 配额满时不抛错） */
  function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  /* ============================================================
     7. 手机端：简化纵向弹窗
     ============================================================ */
  function showSimpleUpdateModal(cfg, version, storageKey) {
    const modalId = 'updateModal';
    const old = document.getElementById(modalId);
    if (old) old.remove();

    let lines = String(cfg.lines || '')
      .split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) lines.push('本次更新内容');
    const display = lines.slice(0, 8);

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal update-image-modal';
    modal.innerHTML = `
      <div class="modal-content update-simple-content ${escapeHtml(cfg.theme || 'theme-pink')}">
        <div class="update-simple-header">
          <span class="update-simple-badge">🎉 版本更新</span>
          <button class="update-image-close" id="updateCloseBtn" aria-label="关闭">✕</button>
        </div>
        <div class="update-simple-title">${escapeHtml(cfg.title || '日常更新')}</div>
        <div class="update-simple-version">${escapeHtml(formatVersion(cfg.version || version))}</div>
        <div class="update-simple-body">
          ${display.map(l => `<div class="update-simple-line">${escapeHtml(l)}</div>`).join('')}
        </div>
        <div class="update-simple-footer">
          <button class="update-image-ok" id="updateOkBtn">我知道了</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    openModal(modalId);

    const finish = () => {
      safeSetItem(storageKey, version);
      closeModal(modalId);
    };
    const okBtn = document.getElementById('updateOkBtn');
    const closeBtn = document.getElementById('updateCloseBtn');
    if (okBtn) okBtn.onclick = finish;
    if (closeBtn) closeBtn.onclick = finish;

    /* ESC / 遮罩关闭同样视为已读 */
    const onClose = e => {
      if (e.detail.id !== modalId) return;
      document.removeEventListener('zm:modalclose', onClose);
      safeSetItem(storageKey, version);
    };
    document.addEventListener('zm:modalclose', onClose);
  }

  /* ============================================================
     8. 桌面 / 平板：canvas 图片式弹窗
     ============================================================ */

  /* 更新弹窗大标题的「一行塞得下」自适应（2026-10-07 站主反馈后新增）
     ------------------------------------------------------------
     背景：站主说 4 个字的标题（「问题上报」）很好看，超过 4 个字就换行、变难看。
     做法不猜字数，而是**量出来再缩**，任何标题长度、任何屏幕宽度都成立：
       ① 先只收字距：5px → 1px（中文 4~8 字时，字距就是罪魁祸首，字号几乎不用动）；
       ② 还不够就收字号：30px → 16px（每档 1px）；
       ③ 都到下限还放不下（比如十几个字），才允许折行，并用 text-wrap: balance
          让两行长度接近，比「第一行满满、第二行一个孤字」好看得多。
     量的是元素自身坐标系（scrollWidth vs clientWidth），外层 .canvas-scaler 的
     scale() 缩放不影响判断。预算宽度 = CSS 里 .left-block 的 max-width（420px）。
     ⚠️ 必须在元素**已经上屏**之后调用：还没显示时 clientWidth 是 0，什么都量不出来。 */
  function fitUpdateTitle(el, base) {
    if (!el) return;
    const text = String(el.textContent || '').trim();
    if (!text) return;

    const BASE_SIZE = (base && base.size) || 30;   /* 跟 css/update-modal.css 里 .title 对齐 */
    const BASE_TRACK = (base && base.track) || 5;
    const MIN_SIZE = 16;
    const MIN_TRACK = 1;

    /* 每次从基准值重新量：不然上一轮缩过的值会叠上来。
       ⚠️ 顺序很重要：Chrome 里 white-space 是**简写**（= white-space-collapse + text-wrap-mode），
       `el.style.textWrap = ''` 会把简写里的 text-wrap-mode 一起清掉 —— 写成
       「先 whiteSpace='nowrap' 再 textWrap=''」的话，nowrap 会被抹掉、文字照样折行，
       于是量出来的宽度永远「放得下」，缩放整个失效（2026-10-07 实测踩了这个坑）。
       正确顺序：先清 text-wrap，最后设 white-space。 */
    el.style.textWrap = '';
    el.style.fontSize = BASE_SIZE + 'px';
    el.style.letterSpacing = BASE_TRACK + 'px';
    el.style.whiteSpace = 'nowrap';

    /* 预算宽度 = 左块能给的最大宽度（CSS 的 max-width）；拿不到就用它当前的客户区 */
    const parent = el.parentElement;
    const budget = Math.max(
      el.clientWidth || 0,
      Math.min((parent && parent.clientWidth) || 0, 420)
    );
    if (budget <= 0) return;   /* 还没上屏（display:none）→ 交给下一次调用 */

    /* 量文字真实宽度：**不能只看 scrollWidth** —— 元素是 overflow: visible 时，
       Chrome 的 scrollWidth 会被 clientWidth 卡住（文字明明超了也只报容器宽度），
       于是「装不下」判断永远为真、缩放白做（2026-10-07 实测踩到）。
       用 Range 直接量这串文字的宽度，nowrap 时就是它真正需要的宽度。
       留 4px 余量：Range 的包围盒不含最后一个字的字距，贴着边量容易差几个像素。 */
    const SAFETY = 4;
    const range = document.createRange();
    const textWidth = () => {
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return r.width || 0;
    };
    const fits = () => textWidth() <= budget - SAFETY;

    /* ① 收字距 */
    let track = BASE_TRACK;
    while (!fits() && track > MIN_TRACK) {
      track -= 1;
      el.style.letterSpacing = track + 'px';
    }

    /* ② 收字号 */
    let size = BASE_SIZE;
    while (!fits() && size > MIN_SIZE) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }

    /* ③ 实在放不下：允许折行，并且让两行尽量一样长（text-wrap 必须写在 white-space 后面才生效） */
    const wrapped = !fits();
    if (wrapped) {
      el.style.whiteSpace = 'normal';
      el.style.textWrap = 'balance';
      el.style.letterSpacing = Math.min(track, 3) + 'px';
    }

    /* 记下来给用例/调试看：缩到多少、是不是折了行 */
    el.dataset.fitSize = String(size);
    el.dataset.fitTrack = String(track);
    el.dataset.fitLines = wrapped ? '2' : '1';
    el.dataset.fitWidth = String(Math.round(textWidth()));
    el.dataset.fitBudget = String(Math.round(budget));
  }

  function showCanvasUpdateModal(cfg, version, storageKey) {
    const modalId = 'updateModal';
    const old = document.getElementById(modalId);
    if (old) old.remove();

    const FALLBACK_LINES = [
      '🎨 更新弹窗全面升级',
      '✨ 5 种主题色可选'
    ];
    let lines = String(cfg.lines || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length === 0 && (cfg.line1 || cfg.line2)) {
      if (cfg.line1) lines.push(String(cfg.line1).trim());
      if (cfg.line2) lines.push(String(cfg.line2).trim());
    }
    if (lines.length === 0) lines = FALLBACK_LINES.slice();

    const display = lines.slice(0, 6);
    const rightSize = display.length >= 6 ? 14
                    : display.length === 5 ? 15
                    : display.length === 4 ? 16
                    : display.length === 3 ? 18
                    : 20;

    const STRIP_TEXT = '织雾满穗 · ZHIWU · 织雾满穗 · ZHIWU · 织雾满穗 · ZHIWU · 织雾满穗 · ZHIWU';
    const CANVAS_W = 960;
    const CANVAS_H = 340;

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal update-image-modal';
    modal.innerHTML = `
      <div class="modal-content update-image-content">
        <div class="update-image-header">
          <span class="update-image-title">🎉 版本更新</span>
          <button class="update-image-close" id="updateCloseBtn" aria-label="关闭">✕</button>
        </div>
        <div class="update-image-inner">
          <div class="canvas-scaler">
            <div class="update-canvas ${escapeHtml(cfg.theme || 'theme-pink')}">
              <div class="light-band"></div>
              <div class="glow glow-left"></div>
              <div class="glow glow-right"></div>
              <div class="canvas-frame">
                <div class="frame-dot left"></div>
                <div class="frame-dot right"></div>
              </div>
              <div class="strip strip-top">${STRIP_TEXT}</div>
              <div class="wheat-deco left">🌾</div>
              <div class="wheat-deco right">🌾</div>
              <div class="sparkle s1"></div>
              <div class="sparkle s2"></div>
              <div class="sparkle s3"></div>
              <div class="sparkle s4"></div>
              <div class="sparkle s5"></div>
              <div class="sparkle s6"></div>
              <div class="sparkle s7"></div>
              <div class="sparkle s8"></div>
              <div class="sparkle s9"></div>
              <div class="sparkle s10"></div>
              <div class="canvas-inner">
                <div class="left-block">
                  <div class="title"></div>
                  <div class="title-rule"></div>
                  <div class="version-pill"></div>
                </div>
                <div class="divider"></div>
                <div class="logo-center">
                  <div class="logo-ring"></div>
                  <div class="logo-circle"></div>
                </div>
                <div class="divider"></div>
                <div class="right-block"></div>
              </div>
              <div class="strip strip-bottom">${STRIP_TEXT}</div>
            </div>
          </div>
        </div>
        <div class="update-image-footer">
          <button class="update-image-ok" id="updateOkBtn">我知道了</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const titleEl = modal.querySelector('.left-block .title');
    const pillEl = modal.querySelector('.left-block .version-pill');
    const logoEl = modal.querySelector('.logo-circle');
    const rightEl = modal.querySelector('.right-block');
    if (titleEl) titleEl.textContent = cfg.title || '日常更新';
    if (pillEl) pillEl.textContent = formatVersion(cfg.version || '');
    if (logoEl) logoEl.textContent = cfg.logo || '穗';

    display.forEach(line => {
      const div = document.createElement('div');
      div.className = 'right-line';
      div.style.fontSize = rightSize + 'px';
      div.textContent = line;
      rightEl.appendChild(div);
    });

    /* 2026-10-07 站主反馈：「更新弹窗的大标题，如『上报更顺手了』在 4 个字的情况下很美观，
       但是大于 4 个字，它就会换行，就变得很难看」。
       原因：标题挤在左边那一块里（30px + 5px 字距），字一多就超出块宽被折行。
       办法：**先上屏、再量、再缩**（不猜字数）—— 字距 5px→1px，还不够就 30px→16px；
       实在放不下才允许换行，并且用 text-wrap: balance 让两行长度尽量一样。
       量的是元素自身坐标系（scrollWidth vs clientWidth），外层 .canvas-scaler 的
       scale() 缩放到多小都不影响判断；预算宽度 = CSS 里 .left-block 的 max-width。
       ⚠️ 必须在 openModal() 之后量：元素还没显示时 clientWidth 是 0，量不出东西（踩过）。 */
    /* 先记下基准值（CSS 里写的），缩放后要还原 */
    const titleBase = titleEl
      ? { size: parseFloat(getComputedStyle(titleEl).fontSize) || 30, track: parseFloat(getComputedStyle(titleEl).letterSpacing) || 5 }
      : null;

    openModal(modalId);

    const fitTitle = () => { if (titleEl) fitUpdateTitle(titleEl, titleBase); };
    fitTitle();
    requestAnimationFrame(fitTitle);

    /* 自适应缩放：以顶部中心为原点，保证缩放后依然居中 */
    const fitCanvas = () => {
      const inner = modal.querySelector('.update-image-inner');
      const scaler = modal.querySelector('.canvas-scaler');
      if (!inner || !scaler) return;

      const availW = inner.clientWidth - 32;
      if (availW <= 0) return;

      const scale = Math.min(1, availW / CANVAS_W);
      scaler.style.width = CANVAS_W + 'px';
      scaler.style.height = CANVAS_H + 'px';
      scaler.style.transformOrigin = 'top center';
      scaler.style.transform = `scale(${scale})`;
      scaler.style.marginLeft = 'auto';
      scaler.style.marginRight = 'auto';
      inner.style.height = Math.round(CANVAS_H * scale + 32) + 'px';

      /* ⚠️ 标题的量尺必须放在这里：canvas 宽度是**这一步**才定下来的，
         在那之前左块可能还是「未约束」的宽度，量出来会以为怎么都放得下（2026-10-07 踩过）。
         每次缩放（含窗口 resize）都重新量一次，任何宽度下都对。 */
      fitTitle();
    };

    requestAnimationFrame(fitCanvas);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener('resize', fitCanvas);
    };

    const finish = () => {
      safeSetItem(storageKey, version);
      cleanup();
      closeModal(modalId);
    };

    const okBtn = document.getElementById('updateOkBtn');
    const closeBtn = document.getElementById('updateCloseBtn');
    if (okBtn) okBtn.onclick = finish;
    if (closeBtn) closeBtn.onclick = finish;

    const onClose = e => {
      if (e.detail.id !== modalId) return;
      document.removeEventListener('zm:modalclose', onClose);
      cleanup();
      safeSetItem(storageKey, version);
    };
    document.addEventListener('zm:modalclose', onClose);
  }

  /* ============================================================
     9. 旧格式文字弹窗（兼容老数据用）
     ============================================================ */
  function showOldTextModal(version, date, updates, storageKey) {
    const modalId = 'updateModal';
    let modal = document.getElementById(modalId);

    /* 复用节点时必须确认它确实是“文字版”结构，否则重建 */
    if (modal && !modal.querySelector('#updateBody')) {
      modal.remove();
      modal = null;
    }

    if (!modal) {
      modal = document.createElement('div');
      modal.id = modalId;
      modal.className = 'modal update-modal';
      modal.innerHTML = `
        <div class="modal-content">
          <div class="update-header">
            <h2>
              🎉 版本更新
              <span class="update-version" id="updateVersion"></span>
              <span class="update-date" id="updateDate"></span>
            </h2>
          </div>
          <div class="update-body" id="updateBody"></div>
          <div class="update-footer">
            <div class="update-thanks">感谢你的使用 ❤️</div>
            <button class="btn btn-primary" id="updateOkBtn">我已知晓</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const versionEl = document.getElementById('updateVersion');
    const dateEl = document.getElementById('updateDate');
    const bodyEl = document.getElementById('updateBody');
    const okBtn = document.getElementById('updateOkBtn');

    if (versionEl) versionEl.textContent = version;
    if (dateEl) dateEl.textContent = '📅 ' + date;
    if (bodyEl) {
      bodyEl.innerHTML = (updates || [])
        .map(t => `<div class="update-item">• ${escapeHtml(t)}</div>`)
        .join('');
    }

    openModal(modalId);
    if (okBtn) {
      okBtn.onclick = () => {
        safeSetItem(storageKey, version);
        closeModal(modalId);
      };
    }

    const onClose = e => {
      if (e.detail.id !== modalId) return;
      document.removeEventListener('zm:modalclose', onClose);
      safeSetItem(storageKey, version);
    };
    document.addEventListener('zm:modalclose', onClose);
  }

  /* ============================================================
     10. 按需加载「版本更新弹窗」的样式
     ------------------------------------------------------------
     这份样式单独放在 css/update-modal.css，只在真的要弹公告时才加载，
     平时访问页面完全不会下载它。
     注意：既然是网络加载，就一定要等它到位再弹窗，
     否则会先闪出一个"没有样式的弹窗"再跳成正常样子。
     ============================================================ */
  let updateCssPromise = null;

  function injectUpdateImageCSS() {
    if (updateCssPromise) return updateCssPromise;

    updateCssPromise = new Promise(resolve => {
      const link = document.createElement('link');
      link.id = 'updateImageCSS';
      link.rel = 'stylesheet';
      link.href = 'css/update-modal.css';

      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };

      link.onload = finish;
      link.onerror = finish;
      /* 兜底：网络太慢或加载失败时也不能一直卡着不弹窗 */
      setTimeout(finish, 2500);

      document.head.appendChild(link);
    });

    return updateCssPromise;
  }

  /* ============================================================
     10.5 浏览器身份
     ------------------------------------------------------------
     · getClientId()：给每个浏览器生成一串随机身份存在本地。
       它不是账号、不含任何个人信息，现在只有一处用到：
         宝库页的「无效处理」上报 —— 带着它去重（同一个人报同一条只算一份），
         撤销时也只允许撤销自己那一份（见 functions/api/invalid/*）。
     · 2026-10-05：原来这里还有一整套「反馈处理回执」
       （FEEDBACK_SEEN_KEY / TYPE_PAGE / currentPageKey / readSeen / writeSeen /
        showDecisionModal / checkFeedbackDecision）。反馈功能整页下线，
       这些函数全都没有调用点了，一并删除，只留下 getClientId()。
     ============================================================ */

  const CLIENT_ID_KEY = 'zm_client_id';
  function getClientId() {
    let id = null;
    try { id = localStorage.getItem(CLIENT_ID_KEY); } catch (e) {}

    if (id && /^[a-z0-9]{16,40}$/.test(id)) return id;

    /* 用 crypto 生成 32 位十六进制；极老的浏览器退回 Math.random */
    let next = '';
    try {
      const buf = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(buf);
      next = Array.prototype.map.call(buf, b => ('0' + b.toString(16)).slice(-2)).join('');
    } catch (e) {
      next = '';
      for (let i = 0; i < 32; i++) next += Math.floor(Math.random() * 16).toString(16);
    }

    try { localStorage.setItem(CLIENT_ID_KEY, next); } catch (e) {}
    return next;
  }

  /* ============================================================
     10.5 「你的上报有结果了」弹窗（2026-10-26 已删除）
     ------------------------------------------------------------
     站主原话：「首先将反馈结果的那个弹窗删除了」。
     所以原来这里的 checkReportNotices / showReportNotices / noticeLine 整段删除，
     上报结果只在上报者自己的「📌 我上报的」隔离区里显示。
     【回退办法】从 git 历史恢复本段（git show HEAD~:js/common.js），
       并把 initUI 里被注释掉的那行 setTimeout(checkReportNotices, 1200) 放回来。
     ============================================================ */

  /* ============================================================
     11. 导出到全局
     ------------------------------------------------------------
     只导出「页面脚本真的会用到」的这几个。其余函数（限速、主题切换、
     各类更新弹窗的渲染函数等）都只在内部使用，不必挂到 window 上，
     免得全局命名空间被一堆没人用的名字占满。
     ============================================================ */
  Object.assign(window, {
    showToast,        // 底部短提示
    showNotice,       // 顶部提示条
    showConfirm,      // 确认弹窗（返回 Promise）
    openShareModal,   // 打开「分享本站」弹窗（旧入口已下线，函数留着备用）
    openSuggestModal, // 打开「功能建议」弹窗（首页 💡 按钮用）
    openModal,        // 打开弹窗
    closeModal,       // 关闭弹窗
    copyText,         // 复制到剪贴板
    debounce,         // 防抖
    escapeHtml,       // 转义，防 XSS
    formatVersion,    // 把版本号排成好看的样子
    checkPageUpdate,  // 检查该页面是否有新版本公告
    getClientId,      // 本浏览器的随机身份（宝库页「无效处理」上报的去重 / 撤销靠它）
    formatMoney,      // 数字 → '¥xx.xx'（一律两位小数）
    normalizeMoneyText, // 随手写的金额 → '¥xx.xx'（认不出是金额就原样返回）
    formatBeijingTime   // 库里/接口的时间 → 北京时间文本（'short' / 'full' / 'date' / 默认）
  });
})();
/* ============================================================
   2026-10-24 · 指针光晕 + 点击涟漪（科幻交互层的前端部分）
   ------------------------------------------------------------
   只在「有精确指针 + 没开减少动效」的环境下运行：
     · 手机 / 触屏：直接 return，不占一点 CPU；
     · rAF 节流：指针移动一帧最多写一次 CSS 变量。
   光晕本体在 css/style.css 的「科幻交互层」里，这里只负责喂坐标。
   【回退办法】删掉本 IIFE（从 /* ===== 到最后的 })();）即可。
   ============================================================ */
(function () {
  if (!window.matchMedia) return;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || calm) return;
  /* 2026-10-24 性能：指针光晕已经关掉（CSS display:none），这里也没必要每帧写变量。 */
  return;

  var root = document.documentElement;
  var body = document.body;
  var raf = 0;
  var px = 0, py = 0;

  function paint() {
    raf = 0;
    root.style.setProperty('--zm-px', px + 'px');
    root.style.setProperty('--zm-py', py + 'px');
  }

  document.addEventListener('pointermove', function (e) {
    px = e.clientX;
    py = e.clientY;
    if (!raf) raf = window.requestAnimationFrame(paint);
    if (!body.classList.contains('zm-pointer-active')) {
      body.classList.add('zm-pointer-active');
    }
  }, { passive: true });

  /* 点击涟漪：在指针处炸开一圈光，600ms 后自己删掉（不留 DOM）。 */
  /* 2026-10-24 性能：点击涟漪每次点击都建一个 DOM + 跑动画，长期用会越来越卡，
     这里关掉（站主要求优化性能）。想恢复就取消下面的注释。 */
  /*
  document.addEventListener('pointerdown', function (e) {
    var r = document.createElement('span');
    r.className = 'zm-ripple';
    r.style.left = e.clientX + 'px';
    r.style.top = e.clientY + 'px';
    document.body.appendChild(r);
    window.setTimeout(function () { if (r && r.parentNode) r.parentNode.removeChild(r); }, 650);
  }, { passive: true });
  */
})();

