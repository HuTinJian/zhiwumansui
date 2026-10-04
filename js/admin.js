/* ============================================================
   织雾满穗 · 后台管理
   反馈管理、卡片管理（歌曲 / 隔离区）、
   鸣谢名单（👑 赞助者 + 🎮 Roblox ID 宝库）、数据统计
   ------------------------------------------------------------
   2026-10-01 用户要求：
     · 每个列表面板都配上「📊 数据统计」，卡片内容各归各位
       （「开发者隔离区」那张卡从歌曲管理搬到隔离区自己那儿，
        歌曲管理这边换成「D1 歌曲数量」）；
     · 标题后面那些灰色数字徽章全部删掉（数字只看统计卡）；
     · 「📥 导入」改名「➕ 添加歌曲 / ➕ 添加隔离歌曲」，跟鸣谢名单的叫法对齐。
   ============================================================ */

/* 缓存反馈列表，用于展开查看隔离区时定位 */
let feedbackCache = [];

/* 给统计卡安全赋值：元素不在页面上（比如以后又删了某张卡）就安静跳过，
   不会像 countEl.textContent 那样直接把整个函数崩掉 */
function setStatText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/* ============================================================
   分页（2026-10-01 站主要求）
   ------------------------------------------------------------
   歌曲管理 / 开发者隔离区 / 鸣谢名单那两栏，都按「100 组/页」分页，
   样式跟宝库页（roblox_music.html）那套一模一样 —— 宝库页那边是
   .pager + pagerNumbers()，这里照搬过来，只是换成后台这几个列表用。
   ============================================================ */
const ADMIN_PAGE_SIZE = 100;

function clampPage(page, total) {
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  return Math.min(Math.max(1, page), pages);
}

/* 页码按钮：页数少就全列，页数多只列当前页附近；窄屏只留首/当前/末 */
function adminPagerNumbers(page, pages) {
  const span = window.innerWidth < 520 ? 0 : 1;

  if (pages <= span * 2 + 5) {
    const all = [];
    for (let i = 1; i <= pages; i++) all.push(i);
    return all;
  }

  const list = [1];
  const from = Math.max(2, page - span);
  const to = Math.min(pages - 1, page + span);
  if (from > 2) list.push('…');
  for (let p = from; p <= to; p++) list.push(p);
  if (to < pages - 1) list.push('…');
  list.push(pages);

  return list.filter((n, i, arr) => {
    if (n !== '…') return true;
    const prev = arr[i - 1];
    const next = arr[i + 1];
    return typeof prev === 'number' && typeof next === 'number' && next - prev > 1;
  });
}

/* 画分页器。box：容器；total：总条数；page：当前页；unit：单位（条 / 人）；
   onGo：点了某页要干什么。总条数不到一页就整个藏起来（跟宝库页一致）。 */
function renderAdminPager(box, total, page, unit, onGo) {
  if (!box) return;
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const show = total > ADMIN_PAGE_SIZE;

  box.hidden = !show;
  box.innerHTML = '';
  if (!show) return;

  const mk = (label, target, opts) => {
    const o = opts || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    if (o.disabled) btn.disabled = true;
    if (o.current) { btn.classList.add('current'); btn.setAttribute('aria-current', 'page'); }
    if (o.edge) btn.classList.add('pager-edge');
    if (o.aria) btn.setAttribute('aria-label', o.aria);
    btn.addEventListener('click', () => { if (!btn.disabled) onGo(target); });
    return btn;
  };

  box.appendChild(mk('«', 1, { disabled: page === 1, aria: '第一页', edge: true }));
  box.appendChild(mk('‹', page - 1, { disabled: page === 1, aria: '上一页' }));

  adminPagerNumbers(page, pages).forEach(n => {
    if (n === '…') {
      const gap = document.createElement('span');
      gap.className = 'pager-gap';
      gap.textContent = '…';
      box.appendChild(gap);
    } else {
      box.appendChild(mk(String(n), n, { current: n === page, disabled: n === page }));
    }
  });

  box.appendChild(mk('›', page + 1, { disabled: page === pages, aria: '下一页' }));
  box.appendChild(mk('»', pages, { disabled: page === pages, aria: '最后一页', edge: true }));

  const info = document.createElement('span');
  info.className = 'pager-info';
  info.textContent = '第 ' + page + ' / ' + pages + ' 页 · 每页 ' + ADMIN_PAGE_SIZE + ' ' + unit +
    ' · 共 ' + total.toLocaleString('en-US') + ' ' + unit;
  box.appendChild(info);
}

/* 翻页后把列表滚回可视区顶部，不用自己找 */
function scrollListIntoView(el) {
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/* ========== 初始化 ========== */
(async function init() {
  const ok = await requireAuth();
  if (!ok) return;

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await logout();
    window.location.href = 'index.html';
  });

  /* 一级标签切换 */
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(tab.dataset.panel);
      if (!panel) return;
      panel.classList.add('active');

      /* 面板里如果嵌了工具页面，这时候才真正去加载它
         （打开后台时不加载，省掉几万字符的解析和一次网络请求）。
         这个函数是通用的，没有面板名单，也不写死任何 id：
         它只唤醒「当前可见的那条链」上的 iframe。
         2026-09-29：合并工具搬去桌面本地版之后，后台里已经没有 iframe 了，
         这句留着没坏处 —— 以后要嵌工具页，它照样按「用到才加载」的规矩工作。 */
      if (typeof window.__zmLoadPanelIframes === 'function') {
        window.__zmLoadPanelIframes(panel);
      }

      /* 数据统计面板：切过去时才去拉数据 */
      if (tab.dataset.panel === 'panel-stats' && typeof window.loadStatsPanel === 'function') {
        window.loadStatsPanel();
      }

      /* ❤️ 鸣谢名单面板：切过去时才去拉赞助者
         （ensureSponsors 只在第一次真正拉一次，之后靠「🔄 刷新」或增删后自动刷新） */
      if (tab.dataset.panel === 'panel-thanks' && typeof window.ensureSponsors === 'function') {
        window.ensureSponsors();
      }
    });
  });

  loadFeedback();
  loadRobloxStats();
  loadSongs();
  loadThanks();
  // 注：2026-09-29 起后台没有「更新管理」了（公告改由 AI 写 data/updates.json），
  // 所以这里也不需要为任何更新面板做初始化。

  /* 导入隔离区弹窗 */
  document.getElementById('openImportQuarantineBtn').onclick = () => {
    document.getElementById('importQuarantineText').value = '';
    document.getElementById('importQuarantineStatus').textContent = '';
    document.getElementById('importQuarantineStatus').className = 'import-status';
    openModal('importQuarantineModal');
  };
  document.getElementById('cancelImportQuarantine').onclick = () => closeModal('importQuarantineModal');
  document.getElementById('confirmImportQuarantine').onclick = handleImportQuarantine;

  /* 歌曲管理按钮（2026-09-29 用户要求把「➕ 添加歌曲」和「📤 导出」两个按钮拿掉，
     只服务于它们的弹窗和处理函数也一并删了；「📥 导入」是在 admin.html 的内联脚本里
     单独绑的，跟这里无关）。所以这一块现在只剩「🧹 清空」一条绑定。 */
  document.getElementById('clearSongsBtn').onclick = handleClearSongs;

  /* 📤 导出按钮（2026-09-29 用户要求：「卡片管理」和「鸣谢名单」各加一键导出） */
  const exportSongsBtn = document.getElementById('exportSongsBtn');
  if (exportSongsBtn) exportSongsBtn.onclick = handleExportSongs;
  const exportThanksBtn = document.getElementById('exportThanksBtn');
  if (exportThanksBtn) exportThanksBtn.onclick = handleExportThanks;
  const exportSponsorsBtn = document.getElementById('exportSponsorsBtn');
  if (exportSponsorsBtn) exportSponsorsBtn.onclick = handleExportSponsors;
  const exportQuarantineBtn = document.getElementById('exportQuarantineBtn');
  if (exportQuarantineBtn) exportQuarantineBtn.onclick = handleExportQuarantine;

  /* 👑 赞助者：「➕ 添加赞助者」弹窗（行的「✏️ 编辑」复用同一个弹窗）、🔄 刷新 */
  document.getElementById('openAddSponsorBtn').onclick = openAddSponsorModal;
  document.getElementById('cancelAddSponsor').onclick = () => {
    closeModal('addSponsorModal');
    resetSponsorForm();
  };
  document.getElementById('confirmAddSponsor').onclick = handleAddSponsor;
  /* 2026-09-26：原来这里还给「🔄 刷新」按钮绑了 loadSponsors，
     用户要求把那个按钮去掉（与「🎮 Roblox ID 宝库」面板一致），绑定一并移除。 */

  /* 切到「👑 赞助者」子标签时才去拉一次（ensureSponsors 自带「只拉一次」的闸，
     所以和一级标签那层的懒加载不会重复请求） */
  const sponsorTabBtn = document.querySelector('[data-subpanel="sponsor-panel"]');
  if (sponsorTabBtn) sponsorTabBtn.addEventListener('click', ensureSponsors);

  /* 添加鸣谢弹窗 */
  const addThanksTrigger = document.getElementById('addThanksSelectTrigger');
  const addThanksDropdown = document.getElementById('addThanksSelectDropdown');

  /* 自定义下拉不是原生控件，aria 状态要自己维护 */
  addThanksTrigger.setAttribute('aria-haspopup', 'listbox');
  addThanksTrigger.setAttribute('aria-expanded', 'false');
  addThanksDropdown.setAttribute('role', 'listbox');

  function setAddThanksOpen(open) {
    addThanksTrigger.classList.toggle('open', open);
    addThanksDropdown.classList.toggle('open', open);
    addThanksTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function selectAddThanksOption(opt) {
    addThanksDropdown.querySelectorAll('.select-option').forEach(o => {
      o.classList.remove('active');
      o.setAttribute('aria-selected', 'false');
    });
    opt.classList.add('active');
    opt.setAttribute('aria-selected', 'true');

    /* 2026-10-04：类别支持自定义 —— 选中「✏️ 自定义类别…」时
       露出下面的输入框，让管理员自己起名字。 */
    const isCustom = opt.dataset.value === '__custom__';
    const customEl = document.getElementById('addThanksCustomCat');
    if (customEl) {
      customEl.hidden = !isCustom;
      if (isCustom) customEl.value = '';
    }

    document.getElementById('addThanksSelectedCat').textContent = isCustom ? '自定义类别' : opt.textContent;
    addThanksTrigger.classList.add('selected');
    setAddThanksOpen(false);
    if (isCustom && customEl) customEl.focus();
    else addThanksTrigger.focus();
    refreshThanksNote();   /* 类别定了，名字也填了的话，顺手把描述补上 */
  }

  /* 自定义类别输入框：边打边同步到下拉按钮上显示的文字，并刷新自动描述 */
  const addThanksCustomCat = document.getElementById('addThanksCustomCat');
  if (addThanksCustomCat) {
    addThanksCustomCat.addEventListener('input', () => {
      const v = addThanksCustomCat.value.trim();
      document.getElementById('addThanksSelectedCat').textContent = v || '自定义类别';
      refreshThanksNote();
    });
  }

  /* 把 D1 里已经存在的鸣谢类别补进下拉（2026-10-04）：
     自建过的类别下次直接选，不用重打；预设三项和「自定义」永远保留。
     这个函数放在 IIFE 里，是因为它要用上面的 selectAddThanksOption 来绑事件；
     外面 loadThanks() 拿到数据后通过 window.syncThanksCategoryOptions 调用。 */
  window.syncThanksCategoryOptions = function (groups) {
    if (!addThanksDropdown) return;

    const known = Object.create(null);
    addThanksDropdown.querySelectorAll('.select-option').forEach(o => {
      if (o.dataset.value === '__custom__') return;
      known[String(o.dataset.value || o.textContent || '').trim()] = true;
    });

    const customOpt = addThanksDropdown.querySelector('.select-option[data-value="__custom__"]');

    (Array.isArray(groups) ? groups : []).forEach(cat => {
      const name = String(cat && cat.category || '').trim();
      /* 赞助者、以及早就废掉的「已删除赞助者」隐藏标记：都不算鸣谢名单的类别 */
      if (!name || name === SPONSOR_CATEGORY || name === SPONSOR_HIDDEN_CATEGORY) return;
      if (known[name]) return;
      known[name] = true;

      const opt = document.createElement('div');
      opt.className = 'select-option';
      opt.dataset.value = name;
      opt.textContent = name;
      opt.tabIndex = 0;
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', 'false');
      opt.addEventListener('click', () => selectAddThanksOption(opt));
      opt.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          selectAddThanksOption(opt);
        }
      });
      addThanksDropdown.insertBefore(opt, customOpt || null);
    });
  };

  document.getElementById('openAddThanksBtn').onclick = () => {
    /* 先清干净（顺便退出「编辑鸣谢」模式），再开弹窗 */
    resetThanksForm();
    setAddThanksOpen(false);
    openModal('addThanksModal');
  };
  document.getElementById('cancelAddThanks').onclick = () => {
    closeModal('addThanksModal');
    resetThanksForm();
  };
  document.getElementById('confirmAddThanks').onclick = handleAddThanks;

  addThanksTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    setAddThanksOpen(!addThanksDropdown.classList.contains('open'));
  });

  addThanksDropdown.querySelectorAll('.select-option').forEach(opt => {
    opt.tabIndex = 0;
    opt.setAttribute('role', 'option');
    opt.setAttribute('aria-selected', opt.classList.contains('active') ? 'true' : 'false');
    opt.addEventListener('click', () => selectAddThanksOption(opt));
    opt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        selectAddThanksOption(opt);
      }
    });
  });

  /* 点空白处收起下拉 */
  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('addThanksSelectWrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      setAddThanksOpen(false);
    }
  });

  /* ============================================================
     ✍️ 描述留空 → 自动代写（2026-09-29 用户要求，两个加人弹窗都这样）
     ------------------------------------------------------------
     lastAutoNote 记住「上一次是我自动填的那句」：
       · 描述框是空的 → 填建议句；
       · 里面还是我上次填的那句 → 跟着新名字/类别/平台更新；
       · 管理员自己改过（值不等于 lastAutoNote）→ 一个字都不碰。
     触发点：选完类别、名字框失焦、平台框失焦。提交时还有一次兜底。
     ============================================================ */
  let lastAutoNote = '';

  function autoFillNote(inputId, builder) {
    const el = document.getElementById(inputId);
    if (!el) return;
    const cur = el.value.trim();
    if (cur && cur !== lastAutoNote) return;   /* 管理员自己写的，别覆盖 */
    const note = builder();
    if (!note) return;
    el.value = note;
    lastAutoNote = note;
  }

  /* 添加鸣谢：类别 + 名字都有了才写（名字参与挑句子，两个人不会撞同一句）。
     类别统一走 currentThanksCategory()：自定义类别取输入框里的字。 */
  function refreshThanksNote() {
    const cat = currentThanksCategory();
    const name = document.getElementById('addThanksName').value.trim();
    if (!name || !cat) return;
    const platform = document.getElementById('addThanksPlatform').value.trim();
    autoFillNote('addThanksMessage', () => buildSmartThanksNote(cat, name, platform));
  }

  /* 添加赞助者：编辑模式不动（那时候留空就是留空，是管理员的选择） */
  function refreshSponsorNote() {
    if (editingSponsorId) return;
    const name = document.getElementById('addSponsorName').value.trim();
    if (!name) return;
    autoFillNote('addSponsorMessage', () => buildSmartSponsorNote(name));
  }

  ['addThanksName', 'addThanksPlatform'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', refreshThanksNote);
  });
  const sponsorNameEl = document.getElementById('addSponsorName');
  if (sponsorNameEl) sponsorNameEl.addEventListener('change', refreshSponsorNote);
})();

/* ============================================================
   反馈管理
   ============================================================ */
async function loadFeedback() {
  const container = document.getElementById('feedbackList');
  /* 2026-10-01：标题后面那个数字徽章（feedbackCount）已按用户要求删除，
     这里不再去写它；反馈条数本来在列表里一眼就能数。 */
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/feedback/list', { credentials: 'include' });
    if (!res.ok) {
      container.innerHTML = '<div class="empty-state">加载失败（HTTP ' + res.status + '）· 登录可能已过期，请重新登录</div>';
      return;
    }
    const data = await res.json();
    if (data && data.ok === false) {
      container.innerHTML = '<div class="empty-state">加载失败：' + escapeHtml(data.error || '未知错误') + '</div>';
      return;
    }

    /* 后端返回 { ok:true, data:[...], total }；同时兼容早期的裸数组格式 */
    const list = Array.isArray(data)
      ? data
      : (data && Array.isArray(data.data) ? data.data : null);

    if (list === null) {
      container.innerHTML = '<div class="empty-state">暂无反馈</div>';
      return;
    }

    feedbackCache = list;

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无反馈</div>';
      return;
    }

    container.innerHTML = '';
    list.forEach(item => {
      const el = document.createElement('div');
      el.className = 'list-item';

      const hasQ = item.upload_quarantine === 1 && Array.isArray(item.quarantine_ids) && item.quarantine_ids.length > 0;
      const qCount = hasQ ? item.quarantine_ids.length : 0;
      const itemId = Number(item.id) || 0;

      /* 处理状态徽标 */
      const statusTag = item.status === 'approved'
        ? '<span class="type-tag green" style="margin-left:6px;">✅ 已受理</span>'
        : (item.status === 'rejected'
          ? '<span class="type-tag red" style="margin-left:6px;">🚫 已拒绝</span>'
          : '<span class="type-tag" style="margin-left:6px;">⏳ 待处理</span>');

      /* 有没有可回传的浏览器身份：老数据没有，就说明回执送不到 */
      const idHint = item.client_id
        ? ' · 🔑 ' + escapeHtml(String(item.client_id).slice(0, 8)) + '…'
        : ' · ⚠️ 旧数据无身份（回执送不到）';

      el.innerHTML = `
        <div class="row1">
          <span class="name">${escapeHtml(item.name || '（未填称呼）')}</span>
          <span>
            <span class="type-tag">${escapeHtml(item.type)}</span>
            ${statusTag}
            ${hasQ ? '<span class="type-tag blue" style="margin-left:6px;">📦 ' + qCount + ' 个隔离区 ID</span>' : ''}
          </span>
        </div>
        <div class="meta">
          🕒 ${escapeHtml(item.created_at)}${idHint}
          ${item.decided_at ? ' · 处理于 ' + escapeHtml(item.decided_at) : ''}
          ${item.want_thanks === 1 ? ' · ❤️ 愿意加入鸣谢' : ''}
        </div>
        <div class="message">${escapeHtml(item.message)}</div>
        <div class="fb-decide">
          <input type="text" class="fb-reply" data-id="${itemId}" maxlength="200"
                 placeholder="给访客的一句话说明（选填，会显示在他下次打开对应页面时的回执弹窗里）">
        </div>
        <div class="actions">
          ${hasQ ? '<button class="btn-expand" data-id="' + itemId + '">📦 展开隔离区</button>' : ''}
          ${item.want_thanks === 1 && item.status !== 'approved' ? '<button class="btn-approve" data-id="' + itemId + '">❤️ 加入鸣谢</button>' : ''}
          <button class="btn-accept" data-id="${itemId}"${item.status === 'approved' ? ' disabled' : ''}>✅ 受理</button>
          <button class="btn-reject" data-id="${itemId}"${item.status === 'rejected' ? ' disabled' : ''}>🚫 拒绝</button>
          <button class="btn-reset" data-id="${itemId}"${item.status === 'pending' ? ' disabled' : ''}>↩️ 退回待处理</button>
          <button class="btn-delete" data-id="${itemId}">🗑️ 删除</button>
        </div>
        ${hasQ ? '<div class="fb-quarantine" id="fbQ-' + itemId + '"></div>' : ''}
      `;
      container.appendChild(el);
    });

    /* 已填过的说明用 JS 回填，避免把用户输入拼进 HTML 属性里 */
    container.querySelectorAll('.fb-reply').forEach(inp => {
      const item = list.find(i => String(i.id) === inp.dataset.id);
      if (item && item.reply) inp.value = item.reply;
    });

    container.querySelectorAll('.btn-approve').forEach(btn => {
      btn.addEventListener('click', () => approveToThanks(Number(btn.dataset.id)));
    });
    container.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteFeedback(Number(btn.dataset.id)));
    });
    container.querySelectorAll('.btn-expand').forEach(btn => {
      btn.addEventListener('click', () => toggleFeedbackQuarantine(Number(btn.dataset.id), btn));
    });
    container.querySelectorAll('.btn-accept').forEach(btn => {
      btn.addEventListener('click', () => decideFeedback(Number(btn.dataset.id), 'approved'));
    });
    container.querySelectorAll('.btn-reject').forEach(btn => {
      btn.addEventListener('click', () => decideFeedback(Number(btn.dataset.id), 'rejected'));
    });
    container.querySelectorAll('.btn-reset').forEach(btn => {
      btn.addEventListener('click', () => decideFeedback(Number(btn.dataset.id), 'pending'));
    });
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

/* 受理 / 拒绝 / 退回一条反馈。
   写在输入框里的说明会一起存下来，访客下次打开他当初选择的那个页面时，
   会看到一个回执弹窗，里面就带着这句话。 */
async function decideFeedback(id, status) {
  const item = feedbackCache.find(i => Number(i.id) === id);
  const input = document.querySelector('.fb-reply[data-id="' + id + '"]');
  const reply = input ? input.value.trim() : '';

  const label = status === 'approved' ? '受理' : (status === 'rejected' ? '拒绝' : '退回待处理');

  /* 老数据没有浏览器身份，回执送不到 —— 先跟管理员确认一下 */
  if (status !== 'pending' && (!item || !item.client_id)) {
    const go = await showConfirm(
      '这条反馈没有浏览器身份',
      '它是「回执功能」上线之前提交的老数据，处理结果没法自动通知到对方。仍然要标记为「' + label + '」吗？'
    );
    if (!go) return;
  }

  try {
    const res = await fetch('/api/feedback/status', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, status: status, reply: reply })
    });
    const data = await res.json();

    if (data && data.ok) {
      if (status === 'approved') showToast('✅ 已受理，访客下次打开对应页面会看到提示');
      else if (status === 'rejected') showToast('🚫 已拒绝，访客下次打开对应页面会看到提示');
      else showToast('↩️ 已退回待处理');
      loadFeedback();
    } else {
      showToast('操作失败：' + ((data && data.error) || ('HTTP ' + res.status)));
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* 展开/收起某条反馈的隔离区 */
function toggleFeedbackQuarantine(feedbackId, btn) {
  const panel = document.getElementById('fbQ-' + feedbackId);
  if (!panel) return;

  if (panel.classList.contains('show')) {
    panel.classList.remove('show');
    btn.textContent = '📦 展开隔离区';
    return;
  }

  if (!panel.dataset.rendered) {
    const item = feedbackCache.find(i => i.id === feedbackId);
    if (!item || !Array.isArray(item.quarantine_ids)) return;

    const listHtml = item.quarantine_ids.map((q, i) => `
      <label class="fb-q-item">
        <input type="checkbox" data-index="${i}" data-id="${escapeHtml(q.id)}">
        <span class="q-name">${escapeHtml(q.name || '未知歌名')}</span>
        <span class="q-id">${escapeHtml(q.id)}</span>
        <span class="q-cat">${escapeHtml(q.category || '未分类')}</span>
      </label>
    `).join('');

    panel.innerHTML = `
      <div class="q-head">
        <span class="q-info">共 <strong>${item.quarantine_ids.length}</strong> 个 ID，勾选后点击导入</span>
        <div class="q-actions">
          <button class="btn-sel-all">全选</button>
          <button class="btn-sel-none">取消</button>
          <button class="btn-import-sel" data-id="${feedbackId}">✅ 导入选中</button>
        </div>
      </div>
      <div class="q-list">${listHtml}</div>
    `;

    panel.querySelector('.btn-sel-all').onclick = () => {
      panel.querySelectorAll('.fb-q-item input').forEach(cb => cb.checked = true);
    };
    panel.querySelector('.btn-sel-none').onclick = () => {
      panel.querySelectorAll('.fb-q-item input').forEach(cb => cb.checked = false);
    };
    panel.querySelector('.btn-import-sel').onclick = () => {
      const ids = Array.from(panel.querySelectorAll('.fb-q-item input:checked'))
        .map(cb => cb.dataset.id);
      importSelectedQuarantine(feedbackId, ids);
    };

    panel.dataset.rendered = '1';
  }

  panel.classList.add('show');
  btn.textContent = '📦 收起隔离区';
}

/* 从反馈导入选中的隔离区 ID */
async function importSelectedQuarantine(feedbackId, ids) {
  if (ids.length === 0) {
    showToast('请至少勾选一个 ID');
    return;
  }

  const confirmed = await showConfirm(
    '导入隔离区',
    `确定将选中的 ${ids.length} 个 ID 导入到开发者隔离区吗？\n\n导入后宝库页将不再显示这些 ID。`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/feedback/import-quarantine', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackId, ids })
    });
    const data = await res.json();

    if (data.ok) {
      showToast(`✅ 已导入 ${data.added} 个，跳过 ${data.skipped} 个`);
      loadRobloxStats();
      loadFeedback();
    } else {
      showToast('导入失败：' + (data.error || '未知错误'));
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* ============================================================
   ❤️ 加入鸣谢：自动写描述
   ------------------------------------------------------------
   以前描述是写死的一句「反馈了「卡片1」相关问题」。
   现在先把这条反馈读一遍，再拼一句像人写的话：
     ① 他在哪个页面提的（类型 → 页面名）
     ② 他实际做了什么（交了隔离区 ID / 正文里有音乐 ID / 关键词归类）
   纯前端规则判断，不联网、不动接口；长度上限跟服务端对齐（200 字）。
   ============================================================ */
function buildSmartThanksMessage(item) {
  const type = String(item.type || '').trim();
  const msg = String(item.message || '').replace(/\s+/g, ' ').trim();
  /* 隔离区：他勾了「上传隔离区 ID」且真带了数据才算 */
  const quarantineCount = (item.upload_quarantine === 1 && Array.isArray(item.quarantine_ids))
    ? item.quarantine_ids.length : 0;
  /* 正文里 10 位以上的纯数字，算他补了几首音乐 ID */
  const idCount = (msg.match(/\d{10,}/g) || []).length;

  const whereMap = {
    '卡片1': '在「🎵 Roblox ID 宝库」',
    '主页': '在首页',
    '反馈': '在反馈页'
  };
  const where = whereMap[type] || '';

  /* 先放「硬证据」（隔离区 ID / 音乐 ID），再用正文关键词补一条，最多两条，
     免得描述又臭又长 —— 它是给访客看的公开文案。 */
  const deeds = [];
  if (quarantineCount > 0) deeds.push('提交了 ' + quarantineCount + ' 个待复核的隔离区 ID');
  if (idCount > 0) deeds.push('补充了 ' + idCount + ' 个音乐 ID');

  const keywordRules = [
    [/失效|听不了|播不了|放不了|打不开|没了|下架|搜不到/, '帮着排出了失效的歌'],
    [/新歌|补充|投稿|添加|加上|收录|推荐/, '推荐了新歌'],
    [/分类|标签|归类|分组/, '提了分类整理的建议'],
    [/搜索|筛选|排序|查找/, '提了搜索、筛选的建议'],
    [/卡顿|很卡|加载慢|闪退|崩溃|白屏|报错|出错/, '反馈了页面体验问题'],
    [/手机|移动端|安卓|苹果|iOS|触屏/, '反馈了手机端体验'],
    [/建议|想法|希望|能不能|可不可以|最好/, '提了改进想法'],
    [/喜欢|好用|太棒|感谢|支持|加油|爱了|赞/, '留下了肯定和鼓励']
  ];
  keywordRules.forEach(rule => {
    if (deeds.length >= 2) return;
    if (rule[0].test(msg) && deeds.indexOf(rule[1]) === -1) deeds.push(rule[1]);
  });

  /* 正文啥也没认出来时兜底，别留空 */
  if (deeds.length === 0) deeds.push('提了反馈');

  /* 拼起来注意别重复：前面已经有「在首页 / 给站点」，所以每条事迹都用能直接接上去的说法 */
  return ((where || '给站点') + deeds.join('、')).slice(0, 200);
}

/* ============================================================
   ✍️ 描述留空时自动代写（「➕ 添加鸣谢」和「➕ 添加赞助者」共用）
   ------------------------------------------------------------
   用户要求（2026-09-29）：往鸣谢名单里加人时，描述那一栏留空就自己写一句，
   别让名单上出现空白；两个加人弹窗都这样。
   做法：名字 / 类别 / 平台填好后，只要描述框还是空的（或还是上一次自动写的那句），
   就把建议句填进去 —— 提交前就看得见、想改直接改，改过就不再覆盖。
   提交时如果仍是空的，再兜一次底。纯前端规则，不联网，≤200 字。
   ============================================================ */

/* 名字 → 一个稳定的序号：同一个人每次拿到的句子一样，不同的人错开，不会千人一面 */
function pickBy(name, n) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return h % n;
}

/* 「➕ 添加鸣谢」：按类别写一句，有平台就带上「在××」 */
function buildSmartThanksNote(category, name, platform) {
  const cat = String(category || '');
  const plat = String(platform || '').trim();
  const at = plat ? '在' + plat : '';

  let options;
  if (cat.indexOf('ID公益') !== -1 || cat.indexOf('UP主') !== -1 || cat.indexOf('作者') !== -1) {
    options = [
      '公开分享了一批 Roblox 音乐 ID，帮宝库补了不少歌',
      '把整理好的音乐 ID 分享了出来，让大家少走弯路',
      '无偿公开了自己收集的音乐 ID'
    ];
  } else if (cat.indexOf('歌单') !== -1 || cat.indexOf('整理') !== -1) {
    options = [
      '整理了歌单，帮我们把曲目信息补齐了',
      '把歌单整理得清清楚楚，省了我们不少事',
      '帮忙校对、整理了歌单里的曲目'
    ];
  } else if (cat.indexOf('反馈') !== -1) {
    options = [
      '给站点提了反馈，帮我们改进了体验',
      '把遇到的问题告诉了我们，站因此变得更好用',
      '认真写了反馈，我们照着改了不少地方'
    ];
  } else {
    options = [
      '帮宝库补了歌，也帮我们改进了站点',
      '在宝库这件事上帮了忙',
      '给站点出了一份力'
    ];
  }

  const pick = options[pickBy(String(name) + plat, options.length)];
  return (at + pick).slice(0, 200);
}

/* 「➕ 添加赞助者」：感谢语留空时写一句
   （金额已经在旁边单独显示了，句子里就不再重复金额，免得一行里出现两次 ¥5） */
function buildSmartSponsorNote(name) {
  const options = [
    '谢谢你的支持 ❤️',
    '谢谢你的支持，这份心意收到啦 ❤️',
    '感谢你的支持，让这个站能继续开下去 ❤️'
  ];
  return options[pickBy(name, options.length)];
}

/* 将反馈用户加入鸣谢 */
async function approveToThanks(feedbackId) {
  const item = feedbackCache.find(i => i.id === feedbackId);
  if (!item) { showToast('未找到反馈'); return; }

  /* 描述照这条反馈现算，并在确认框里先给管理员看一眼（想改事后去鸣谢名单改） */
  const smartMessage = buildSmartThanksMessage(item);
  /* 2026-10-04 起反馈的称呼可以不写，空名字进鸣谢名单会变成一行空白 ——
     这里统一兜成「匿名用户」 */
  const thanksName = String(item.name || '').trim() || '匿名用户';

  const confirmed = await showConfirm(
    '加入鸣谢',
    '把「' + thanksName + '」加入鸣谢名单？\n\n' +
    '描述会自动写成：\n「' + smartMessage + '」\n\n' +
    '加入后可以在「❤️ 鸣谢名单」→「🎮 Roblox ID 宝库」里改类别和描述。'
  );
  if (!confirmed) return;

  try {
    const addRes = await fetch('/api/thanks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add',
        category: '💬 反馈贡献者',
        name: thanksName,
        platform: '',
        message: smartMessage,
        feedbackId: item.id
      })
    });
    const addData = await addRes.json();

    if (addData.ok) {
      showToast('✅ 已加入鸣谢名单');
      const st = await fetch('/api/feedback/status', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, status: 'approved' })
      });
      if (!st.ok) showToast('⚠️ 状态更新失败');
      loadThanks();
      loadFeedback();
    } else {
      showToast('加入失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* 删除反馈 */
async function deleteFeedback(id) {
  if (!id || isNaN(Number(id))) {
    showToast('⚠️ 反馈 ID 无效，无法删除');
    return;
  }

  const confirmed = await showConfirm('删除反馈', '确定要删除这条反馈吗？此操作不可撤销。');
  if (!confirmed) return;

  try {
    const res = await fetch('/api/feedback/delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Number(id) })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`🗑️ 已删除（共 ${data.deleted || 1} 条）`);
      loadFeedback();
    } else {
      showToast('删除失败：' + (data.message || data.error || '未知'));
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* ============================================================
   Roblox 数据（歌曲管理的统计 + 开发者隔离区列表与统计）
   ------------------------------------------------------------
   2026-10-01 用户要求：
     · 歌曲管理的统计卡 = 总 ID 数 / 歌曲组数 / **D1 歌曲数量**（新加）；
     · 「开发者隔离区」那张卡从歌曲管理搬进隔离区自己的统计里，
       号码改成「隔离区 ID 数」，并配一张「涉及分类」。
   ============================================================ */
async function loadRobloxStats() {
  try {
    const res1 = await fetch('data/roblox_music.json?t=' + Date.now());
    const musicData = await res1.json();

    let extraData = [];
    let extraOk = false;
    try {
      const extraRes = await fetch('/api/songs/list?t=' + Date.now());
      if (extraRes.ok) {
        const extraJson = await extraRes.json();
        if (extraJson && extraJson.ok && Array.isArray(extraJson.data)) {
          extraData = extraJson.data;
          extraOk = true;
        }
      }
    } catch (e) {}

    /* 总 ID 数 / 歌曲组数：两份数据先合并再按 id、name 去重，避免两边都有的被算两次；
       D1 没读到时显示 '-'，而不是看起来像 0 条 */
    const seenIds = new Set();
    const seenNames = new Set();
    musicData.concat(extraData).forEach(item => {
      if (!item) return;
      if (item.id) seenIds.add(String(item.id));
      if (item.name) seenNames.add(item.name);
    });
    setStatText('statTotal', extraOk ? seenIds.size : '-');
    setStatText('statGroup', extraOk ? seenNames.size : '-');
    /* D1 歌曲数量 = /api/songs/list 回来的条数（就是「🎶 D1 歌曲管理」下面列出来的那些） */
    setStatText('statD1Songs', extraOk ? extraData.length : '-');

    const res2 = await fetch('/api/quarantine/list?t=' + Date.now());
    const container = document.getElementById('quarantineList');
    if (!res2.ok) {
      container.innerHTML = '<div class="empty-state">加载失败（HTTP ' + res2.status + '）· 登录可能已过期，请重新登录</div>';
      setStatText('statQuarantine', '-');
      setStatText('statQuarantineCats', '-');
      return;
    }
    const qData = await res2.json();
    if (qData && qData.ok === false) {
      container.innerHTML = '<div class="empty-state">加载失败：' + escapeHtml(qData.error || '未知错误') + '</div>';
      setStatText('statQuarantine', '-');
      setStatText('statQuarantineCats', '-');
      return;
    }

    let quarantine = [];
    if (qData.ok && Array.isArray(qData.data)) {
      quarantine = qData.data;
    }

    setStatText('statQuarantine', quarantine.length);

    /* 涉及分类：隔离区里的歌一共牵扯到多少种分类（前端现算，不额外发请求） */
    const qCats = new Set();
    quarantine.forEach(it => {
      qCats.add(String((it && it.category) || '').trim() || '未分类');
    });
    setStatText('statQuarantineCats', qCats.size);

    quarantineCache = quarantine;
    renderQuarantinePage();
  } catch (err) {
    document.getElementById('quarantineList').innerHTML = '<div class="empty-state">加载失败</div>';
    const pager = document.getElementById('quarantinePager');
    if (pager) pager.hidden = true;
  }
}

/* 隔离区列表：每页 100 条（2026-10-01 站主要求，跟宝库页一样） */
let quarantineCache = [];
let quarantinePage = 1;

function renderQuarantinePage() {
  const container = document.getElementById('quarantineList');
  const pager = document.getElementById('quarantinePager');
  const total = quarantineCache.length;

  quarantinePage = clampPage(quarantinePage, total);

  if (total === 0) {
    container.innerHTML = '<div class="empty-state">隔离区是空的</div>';
    if (pager) pager.hidden = true;
    return;
  }

  const start = (quarantinePage - 1) * ADMIN_PAGE_SIZE;
  const pageItems = quarantineCache.slice(start, start + ADMIN_PAGE_SIZE);

  container.innerHTML = '';
  pageItems.forEach(item => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div class="row1">
        <span class="name">${escapeHtml(item.name || '未知歌名')}</span>
        <span class="type-tag">${escapeHtml(item.category || '未分类')}</span>
      </div>
      <div class="meta">
        🆔 ${escapeHtml(item.id)}
        ${item.source ? ' · 📌 ' + escapeHtml(item.source) : ''}
        ${item.quarantinedAt ? ' · 🕒 ' + escapeHtml(item.quarantinedAt) : ''}
      </div>
      <div class="actions">
        <button class="btn-delete" data-id="${escapeHtml(item.id)}">🗑️ 移除</button>
      </div>
    `;
    container.appendChild(el);
  });

  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteQuarantineItem(btn.dataset.id));
  });

  renderAdminPager(pager, total, quarantinePage, '条', (p) => {
    quarantinePage = p;
    renderQuarantinePage();
    scrollListIntoView(container);
  });
}

/* 从隔离区移除单个 ID */
async function deleteQuarantineItem(musicId) {
  const confirmed = await showConfirm(
    '移除隔离',
    `确定将 ID ${musicId} 从开发者隔离区移除吗？\n\n移除后宝库页会重新显示该 ID。`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/quarantine/delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: musicId })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✅ 已移除');
      loadRobloxStats();
    } else {
      showToast('移除失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* 添加隔离歌曲：JSON 数组，或「歌名 + ID」多行文本
   （2026-10-01 用户要求加的后一种：跟「➕ 添加歌曲」共用同一套智能解析） */
async function handleImportQuarantine() {
  const text = document.getElementById('importQuarantineText').value.trim();
  const status = document.getElementById('importQuarantineStatus');
  status.className = 'import-status';
  status.textContent = '';

  if (!text) {
    status.classList.add('err');
    status.textContent = '⚠️ 请粘贴内容（JSON 数组，或者「歌名 + ID」的多行文本）';
    return;
  }

  let items;
  if (text.charAt(0) === '[' || text.charAt(0) === '{') {
    try {
      items = JSON.parse(text);
    } catch (e) {
      status.classList.add('err');
      status.textContent = '⚠️ JSON 格式错误：' + e.message;
      return;
    }
  } else if (typeof window.zmParseSongText === 'function') {
    /* 不是 JSON：当成「歌名 + ID」的多行文本，
       用 admin.html 里那套智能解析（自己认 ID、清杂物、判分类） */
    items = window.zmParseSongText(text);
    if (!items.length) {
      status.classList.add('err');
      status.textContent = '⚠️ 没认出任何 ID（ID 要 9 位及以上的纯数字）；要贴 JSON 的话请以 [ 开头';
      return;
    }
  } else {
    status.classList.add('err');
    status.textContent = '⚠️ 这里要贴 JSON 数组，或者「歌名 + ID」的多行文本';
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    status.classList.add('err');
    status.textContent = '⚠️ 请提供一个非空数组';
    return;
  }

  const valid = [];
  let dropped = 0;
  for (const it of items) {
    if (!it || !it.id) { dropped++; continue; }
    valid.push({
      id: String(it.id).trim(),
      name: String(it.name || '').trim().slice(0, 100),
      category: String(it.category || '').trim().slice(0, 30)
    });
  }

  if (valid.length === 0) {
    status.classList.add('err');
    status.textContent = '⚠️ 没有有效的记录（每条必须包含 id）'
      + (dropped > 0 ? `，已跳过 ${dropped} 条缺少 id 的记录` : '');
    return;
  }

  /* 服务端单次上限 500 条，先在前端拦下，避免只看到原始报错 */
  if (valid.length > 500) {
    status.classList.add('err');
    status.textContent = `⚠️ 一次最多 500 条，请分批导入（当前 ${valid.length} 条）`;
    return;
  }

  status.textContent = `正在导入 ${valid.length} 条...`
    + (dropped > 0 ? `（已跳过 ${dropped} 条缺少 id 的记录）` : '');

  try {
    const res = await fetch('/api/quarantine/import', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: valid, source: '手动导入' })
    });
    const data = await res.json();

    if (data.ok) {
      status.classList.add('ok');
      status.textContent = `✅ 导入完成：新增 ${data.added} 条，跳过 ${data.skipped} 条（已存在）`
        + (dropped > 0 ? `，另有 ${dropped} 条缺少 id 未导入` : '');
      loadRobloxStats();
      setTimeout(() => closeModal('importQuarantineModal'), 2000);
    } else {
      status.classList.add('err');
      status.textContent = '❌ 导入失败：' + (data.error || '未知错误');
    }
  } catch (err) {
    status.classList.add('err');
    status.textContent = '❌ 网络异常';
  }
}

/* ============================================================
   歌曲管理（D1）
   ------------------------------------------------------------
   2026-10-01：
     · 标题后面的数字徽章（songCount）已删掉，条数写在统计卡「D1 歌曲数量」里；
     · 列表按「100 组/页」分页（跟宝库页一样），所以要先把整份数据存下来
       （songCache），只渲染当前这一页。
   ============================================================ */
let songCache = [];
let songPage = 1;

async function loadSongs() {
  const container = document.getElementById('songList');
  const pager = document.getElementById('songPager');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/songs/list?t=' + Date.now());
    if (!res.ok) {
      container.innerHTML = '<div class="empty-state">加载失败（HTTP ' + res.status + '）· 登录可能已过期，请重新登录</div>';
      if (pager) pager.hidden = true;
      return;
    }
    const data = await res.json();
    if (data && data.ok === false) {
      container.innerHTML = '<div class="empty-state">加载失败：' + escapeHtml(data.error || '未知错误') + '</div>';
      if (pager) pager.hidden = true;
      return;
    }

    let list = [];
    if (data.ok && Array.isArray(data.data)) {
      list = data.data;
    }
    setStatText('statD1Songs', list.length);
    songCache = list;
    renderSongPage();
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
    if (pager) pager.hidden = true;
  }
}

/* 只画当前这一页（每页 100 条） */
function renderSongPage() {
  const container = document.getElementById('songList');
  const pager = document.getElementById('songPager');
  const total = songCache.length;

  songPage = clampPage(songPage, total);

  if (total === 0) {
    container.innerHTML = '<div class="empty-state">D1 里还没有歌曲</div>';
    if (pager) pager.hidden = true;
    return;
  }

  const start = (songPage - 1) * ADMIN_PAGE_SIZE;
  const pageItems = songCache.slice(start, start + ADMIN_PAGE_SIZE);

  container.innerHTML = '';
  pageItems.forEach(item => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div class="row1">
        <span class="name">${escapeHtml(item.name)}</span>
        <span class="type-tag">${escapeHtml(item.category)}</span>
      </div>
      <div class="meta">
        🆔 ${escapeHtml(item.id)}
        · 📌 lineIndex: ${escapeHtml(String(item.lineIndex || 0))}
      </div>
      <div class="actions">
        <button class="btn-delete" data-id="${escapeHtml(item.id)}">🗑️ 删除</button>
      </div>
    `;
    container.appendChild(el);
  });

  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteSong(btn.dataset.id));
  });

  renderAdminPager(pager, total, songPage, '条', (p) => {
    songPage = p;
    renderSongPage();
    scrollListIntoView(container);
  });
}

/* 2026-09-29：这里原来有「➕ 添加歌曲」弹窗的三个函数
   （openAddSongModal / resetSongForm / handleAddSong）。
   用户要求去掉那个按钮，弹窗 HTML 和这三个函数一起删了。
   注意：addSongToServer() 还留着 —— 「📥 导入」和它共用同一个 /api/songs/add。 */

/* 调后端 /api/songs/add（批量导入都用它） */
async function addSongToServer({ musicId, name, category }) {
  try {
    const res = await fetch('/api/songs/add', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ musicId, name, category })
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: 'network' };
  }
}

/* 删除单曲 */
async function deleteSong(musicId) {
  const confirmed = await showConfirm(
    '删除歌曲',
    `确定从 D1 删除 ID ${musicId} 吗？\n\n（不会影响 roblox_music.json 里的数据）`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/songs/delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: musicId })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('🗑️ 已删除');
      loadSongs();
      loadRobloxStats();
    } else {
      showToast('删除失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* 清空 D1 歌曲 */
async function handleClearSongs() {
  const confirmed = await showConfirm(
    '清空歌曲',
    '确定清空 D1 里的所有歌曲吗？\n\n（不会影响 roblox_music.json 里的数据）\n\n建议先导出，再清空。'
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/songs/clear', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE_ALL' })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`🧹 已清空 ${data.deleted || 0} 条`);
      loadSongs();
      loadRobloxStats();
    } else {
      showToast('清空失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* ============================================================
   📤 导出（2026-09-29 用户要求：「卡片管理」和「鸣谢名单」都要一键导出）
   ------------------------------------------------------------
   导出的就是站点实际读的那份静态文件的格式，拿到即可直接用 / 直接替换：
     · 歌曲     → data/roblox_music.json   [{id, name, category, lineIndex}]
     · 赞助者   → data/sponsors.json       [{name, amount, message}]
     · 鸣谢名单 → data/thanks.json         [{category, people:[{name, platform, message}]}]
   ============================================================ */
function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* 歌曲：后端已经把字段整理成 roblox_music.json 的格式了，直接落盘 */
async function handleExportSongs() {
  try {
    const res = await fetch('/api/songs/export?t=' + Date.now(), { credentials: 'include' });
    const data = await res.json();
    if (!data || data.ok === false) {
      showToast('导出失败：' + ((data && data.error) || ('HTTP ' + res.status)));
      return;
    }
    const list = Array.isArray(data.data) ? data.data : [];
    if (!list.length) { showToast('D1 里还没有歌曲，没什么可导出的'); return; }
    downloadJson(`roblox_music-${exportStamp()}.json`, list);
    showToast(`📤 已导出 ${list.length} 首（格式同 data/roblox_music.json）`);
  } catch (err) {
    showToast('网络异常，导出失败');
  }
}

/* 鸣谢名单：排除「👑 赞助者」和「🚫 已删除赞助者」那两组
   （前者有自己单独的导出，后者是底档删除用的隐藏标记，都不是鸣谢内容），
   字段对齐 data/thanks.json */
async function handleExportThanks() {
  try {
    const res = await fetch('/api/thanks?t=' + Date.now(), { credentials: 'include' });
    const data = await res.json();
    if (data && data.ok === false) { showToast('导出失败：' + (data.error || '未知错误')); return; }
    if (!Array.isArray(data)) { showToast('暂无鸣谢可导出'); return; }
    const groups = data
      .filter((cat) => cat && cat.category !== SPONSOR_CATEGORY && cat.category !== SPONSOR_HIDDEN_CATEGORY)
      .map((cat) => ({
        category: cat.category,
        people: (cat.people || []).map((p) => ({
          name: p.name || '',
          platform: p.platform || '',
          message: p.message || ''
        }))
      }));
    const total = groups.reduce((n, g) => n + g.people.length, 0);
    if (!total) { showToast('暂无鸣谢可导出'); return; }
    downloadJson(`thanks-${exportStamp()}.json`, groups);
    showToast(`📤 已导出 ${total} 条鸣谢（格式同 data/thanks.json）`);
  } catch (err) {
    showToast('网络异常，导出失败');
  }
}

/* 赞助者：导出 D1 里现有的赞助者（金额统一落在 amount 字段）。
   2026-10-01 晚：赞助者只在 D1 里管，导出的就是这一份 ——
   拿到可以直接覆盖 data/sponsors.json 当存档（页面已经不读那个文件了）。 */
async function handleExportSponsors() {
  try {
    const res = await fetch('/api/thanks?t=' + Date.now(), { credentials: 'include' });
    const data = await res.json();
    if (!Array.isArray(data)) { showToast('导出失败：名单拿不到'); return; }

    const cat = data.find((c) => c && c.category === SPONSOR_CATEGORY);
    const d1People = (cat && Array.isArray(cat.people)) ? cat.people : [];

    const list = d1People.map((p) => ({
      name: p.name || '',
      amount: String(p.amount === undefined || p.amount === null || p.amount === '' ? (p.platform || '') : p.amount),
      message: p.message || ''
    }));
    if (!list.length) { showToast('暂无赞助者可导出'); return; }
    downloadJson(`sponsors-${exportStamp()}.json`, list);
    showToast(`📤 已导出 ${list.length} 条赞助者（格式同 data/sponsors.json）`);
  } catch (err) {
    showToast('网络异常，导出失败');
  }
}

/* 开发者隔离区：导出成 data/admin_quarantine.json 的格式 [{id, name, category}]。
   D1 里还多存了 source / quarantinedAt，但静态快照那份文件没有这两个字段，
   所以导出时按静态文件的格式来 —— 拿到就能直接覆盖 data/admin_quarantine.json。 */
async function handleExportQuarantine() {
  try {
    const res = await fetch('/api/quarantine/list?t=' + Date.now(), { credentials: 'include' });
    const data = await res.json();
    if (!data || data.ok === false || !Array.isArray(data.data)) {
      showToast('导出失败：隔离区列表拿不到');
      return;
    }
    const list = data.data.map((it) => ({
      id: it.id,
      name: it.name || '未知歌名',
      category: it.category || '未分类'
    }));
    if (!list.length) { showToast('隔离区是空的，没什么可导出的'); return; }
    downloadJson(`admin_quarantine-${exportStamp()}.json`, list);
    showToast(`📤 已导出 ${list.length} 条隔离记录（格式同 data/admin_quarantine.json）`);
  } catch (err) {
    showToast('网络异常，导出失败');
  }
}

/* 2026-09-29：上面三个导出对应的按钮由文件开头的绑定区统一挂钩；
   后端 /api/songs/export 一直是好的，之前只是按钮被拿掉过。 */

/* ============================================================
   ❤️ 鸣谢名单（后台「🎮 Roblox ID 宝库」子面板；赞助者见下面单独一节）
   ============================================================ */
/* 2026-10-01 站主要求：宝库鸣谢上面的统计改成「那 3 个类别」——
   每个类别一张卡，显示这个类别有几个人。卡片按 D1 里实际的类别动态生成，
   以后加 / 删类别会自动跟着变，不用改代码。 */
function renderThanksStats(groups) {
  const box = document.getElementById('thanksStatGrid');
  if (!box) return;

  box.innerHTML = '';
  const list = (Array.isArray(groups) ? groups : []).filter(cat => cat);

  if (list.length === 0) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = '<div class="num">0</div><div class="label">还没有类别</div>';
    box.appendChild(card);
    return;
  }

  list.forEach(cat => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = '<div class="num">' + Number((cat.people || []).length) + '</div>' +
      '<div class="label">' + escapeHtml(cat.category) + '</div>';
    box.appendChild(card);
  });
}

async function loadThanks() {
  const container = document.getElementById('thanksList');
  /* 2026-10-01：标题后面的数字徽章（thanksCount）已删掉，
     统计改成上面那排「每个类别一张卡」（见 renderThanksStats） */
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/thanks?t=' + Date.now());
    if (!res.ok) {
      container.innerHTML = '<div class="empty-state">加载失败（HTTP ' + res.status + '）· 登录可能已过期，请重新登录</div>';
      renderThanksStats(null);
      return;
    }
    const data = await res.json();
    if (data && data.ok === false) {
      container.innerHTML = '<div class="empty-state">加载失败：' + escapeHtml(data.error || '未知错误') + '</div>';
      renderThanksStats(null);
      return;
    }

    if (!Array.isArray(data)) {
      container.innerHTML = '<div class="empty-state">暂无鸣谢</div>';
      renderThanksStats([]);
      return;
    }

    /* 2026-09-29 用户要求：这一栏是「🎮 Roblox ID 宝库」的鸣谢名单，
       「👑 赞助者」有自己单独的子面板，不能在这里再出现一遍
       （前端鸣谢页 thanks.html 早就跳过它了，后台这栏之前漏了过滤）。
       2026-10-01 又排除掉「🚫 已删除赞助者」——那是白天那版删除用过、
       现在已经废掉的隐藏标记类别，万一 D1 里还剩着，不许混进这份名单。
       注意这两个字符串都是数据口径，别改。 */
    const groups = data.filter(cat => cat && cat.category !== SPONSOR_CATEGORY && cat.category !== SPONSOR_HIDDEN_CATEGORY);

    /* 2026-10-04：把已有的类别（含管理员自建的）补进「添加鸣谢」的类别下拉，
       下次再添加同类鸣谢时直接选就行。 */
    if (typeof window.syncThanksCategoryOptions === 'function') window.syncThanksCategoryOptions(groups);

    /* 统计卡：只算真的有人在那儿的类别，跟列表口径一致 */
    renderThanksStats(groups.filter(cat => (cat.people || []).length > 0));

    /* 平铺成「一行一个人」，好按 100 人一页翻（类别名跟着每个人走） */
    thanksCache = [];
    groups.forEach(cat => {
      (cat.people || []).forEach(person => thanksCache.push({ category: cat.category, person }));
    });
    renderThanksPage();
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
    const pager = document.getElementById('thanksPager');
    if (pager) pager.hidden = true;
  }
}

/* 鸣谢名单：每页 100 人（2026-10-01 站主要求，跟宝库页一样） */
let thanksCache = [];
let thanksPage = 1;

function renderThanksPage() {
  const container = document.getElementById('thanksList');
  const pager = document.getElementById('thanksPager');
  const total = thanksCache.length;

  thanksPage = clampPage(thanksPage, total);

  if (total === 0) {
    container.innerHTML = '<div class="empty-state">暂无鸣谢</div>';
    if (pager) pager.hidden = true;
    return;
  }

  const start = (thanksPage - 1) * ADMIN_PAGE_SIZE;
  const pageItems = thanksCache.slice(start, start + ADMIN_PAGE_SIZE);

  container.innerHTML = '';
  let lastCat = '';
  pageItems.forEach(({ category, person }) => {
    /* 类别标题只在换类别时出现一次；翻到第二页时也会先报一下当前是哪个类别 */
    if (category !== lastCat) {
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:700;color:var(--gold);margin:16px 0 8px;font-size:1rem;';
      title.textContent = category;
      container.appendChild(title);
      lastCat = category;
    }

    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div class="row1">
        <span class="name">${escapeHtml(person.name)}</span>
        ${person.platform ? '<span class="type-tag gold">' + escapeHtml(person.platform) + '</span>' : ''}
      </div>
      ${person.message ? '<div class="message">' + escapeHtml(person.message) + '</div>' : ''}
      <div class="actions">
        <button class="btn-edit-thanks" data-id="${escapeHtml(String(person.id))}">✏️ 编辑</button>
        <button class="btn-delete" data-id="${escapeHtml(person.id)}">🗑️ 删除</button>
      </div>
    `;
    container.appendChild(el);

    /* 编辑按钮直接挂在这个人的数据上，不用再回头查一遍（避免同名/同 id 找错） */
    const editBtn = el.querySelector('.btn-edit-thanks');
    if (editBtn) editBtn.addEventListener('click', () => startEditThanks({ category, person }));
  });

  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteThanks(Number(btn.dataset.id)));
  });

  renderAdminPager(pager, total, thanksPage, '人', (p) => {
    thanksPage = p;
    renderThanksPage();
    scrollListIntoView(container);
  });
}

/* 当前「添加 / 编辑鸣谢」弹窗里选中的类别（2026-10-04 支持自定义分类后新增）
   · 选中「✏️ 自定义类别…」→ 取下面输入框里的字；
   · 否则取下拉按钮上显示的那一行。
   空串表示还没选。 */
function currentThanksCategory() {
  const opt = document.querySelector('#addThanksSelectDropdown .select-option.active');
  if (opt && opt.dataset.value === '__custom__') {
    const input = document.getElementById('addThanksCustomCat');
    return input ? input.value.trim() : '';
  }
  const selected = document.getElementById('addThanksSelectedCat');
  const text = (selected ? selected.textContent : '').trim();
  return (!text || text === '请选择类别') ? '' : text;
}

/* 正在编辑的鸣谢条目 id；0 = 新增（2026-10-01 站主要求「鸣谢也要能改」） */
let editingThanksId = 0;

/* 点某一行「✏️ 编辑」：复用「添加鸣谢」弹窗，把值填进去（类别用自定义下拉，要手动选中） */
function startEditThanks(entry) {
  const person = entry && entry.person;
  if (!person || !person.id) { showToast('未找到这条记录，刷新后再试'); return; }

  editingThanksId = Number(person.id);
  const category = String(entry.category || '').trim();

  /* 自定义下拉：把对应选项点亮，并把标题文字换掉。
     2026-10-04 起类别可以自定义：如果这条记录的类别不在预设 / 已有列表里，
     就切到「✏️ 自定义类别…」并把类别名填进旁边的输入框。 */
  const trigger = document.getElementById('addThanksSelectTrigger');
  const dropdown = document.getElementById('addThanksSelectDropdown');
  const selected = document.getElementById('addThanksSelectedCat');
  const customInput = document.getElementById('addThanksCustomCat');
  let hitOption = null;
  if (dropdown) {
    dropdown.querySelectorAll('.select-option').forEach(o => {
      const val = String(o.dataset.value || '').trim();
      const hit = val !== '__custom__' &&
        (val === category || String(o.textContent || '').trim() === category);
      if (hit) hitOption = o;
      o.classList.toggle('active', hit);
      o.setAttribute('aria-selected', hit ? 'true' : 'false');
    });
    if (!hitOption) {
      const customOpt = dropdown.querySelector('.select-option[data-value="__custom__"]');
      if (customOpt) {
        customOpt.classList.add('active');
        customOpt.setAttribute('aria-selected', 'true');
      }
    }
  }
  if (customInput) {
    customInput.hidden = !!hitOption;
    customInput.value = hitOption ? '' : category;
  }
  if (selected) selected.textContent = category;
  if (trigger) {
    trigger.classList.add('selected');
    trigger.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }
  if (dropdown) dropdown.classList.remove('open');

  document.getElementById('addThanksName').value = person.name || '';
  document.getElementById('addThanksPlatform').value = person.platform || '';
  document.getElementById('addThanksMessage').value = person.message || '';

  const titleEl = document.querySelector('#addThanksModal h2');
  if (titleEl) titleEl.textContent = '✏️ 编辑鸣谢';
  const okBtn = document.getElementById('confirmAddThanks');
  if (okBtn) okBtn.textContent = '💾 保存修改';

  openModal('addThanksModal');
  showToast('✏️ 正在编辑「' + (person.name || '') + '」，改完点「💾 保存修改」');
}

/* 退出编辑模式（「取消」按钮、提交成功后都走这里） */
function resetThanksForm() {
  editingThanksId = 0;
  const selected = document.getElementById('addThanksSelectedCat');
  if (selected) selected.textContent = '请选择类别';
  const trigger = document.getElementById('addThanksSelectTrigger');
  if (trigger) trigger.classList.remove('selected');
  const dropdown = document.getElementById('addThanksSelectDropdown');
  if (dropdown) {
    dropdown.querySelectorAll('.select-option').forEach(o => {
      o.classList.remove('active');
      o.setAttribute('aria-selected', 'false');
    });
  }
  ['addThanksName', 'addThanksPlatform', 'addThanksMessage'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  /* 自定义类别输入框也一并收起来、清空 */
  const customInput = document.getElementById('addThanksCustomCat');
  if (customInput) {
    customInput.hidden = true;
    customInput.value = '';
  }
  const titleEl = document.querySelector('#addThanksModal h2');
  if (titleEl) titleEl.textContent = '➕ 添加鸣谢';
  const okBtn = document.getElementById('confirmAddThanks');
  if (okBtn) okBtn.textContent = '✅ 确认添加';
}

/* 添加 / 保存鸣谢 */
async function handleAddThanks() {
  /* 2026-10-04：类别可能是自定义的，统一从 currentThanksCategory() 取 */
  const category = currentThanksCategory();
  const name = document.getElementById('addThanksName').value.trim();
  const platform = document.getElementById('addThanksPlatform').value.trim();
  const messageEl = document.getElementById('addThanksMessage');
  let message = messageEl.value.trim();

  if (!category) {
    showToast('请选择类别（选「✏️ 自定义类别…」的话要把名字填上）');
    const opt = document.querySelector('#addThanksSelectDropdown .select-option.active');
    if (opt && opt.dataset.value === '__custom__') {
      const input = document.getElementById('addThanksCustomCat');
      if (input) input.focus();
    }
    return;
  }
  if (category.length > 30) { showToast('类别最多 30 个字'); return; }
  if (!name) { showToast('请填写名字'); return; }

  const editingId = editingThanksId;

  /* 描述留空 → 自己写一句（2026-09-29 用户要求；填进去再发，返回列表就能看到）。
     编辑时留空就留空，那是管理员自己的选择。 */
  let autoWrote = false;
  if (!message && !editingId) {
    message = buildSmartThanksNote(category, name, platform);
    messageEl.value = message;
    autoWrote = true;
  }

  try {
    const res = await fetch('/api/thanks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingId
        ? { action: 'update', id: editingId, category, name, platform, message }
        : { action: 'add', category, name, platform, message })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(editingId
        ? '✅ 已保存修改'
        : (autoWrote ? '✅ 已添加（描述留空，已自动代写）' : '✅ 已添加'));
      closeModal('addThanksModal');
      resetThanksForm();
      loadThanks();
    } else {
      showToast((editingId ? '保存失败：' : '添加失败：') + (data.error || '未知错误'));
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* 删除鸣谢 */
async function deleteThanks(id) {
  if (!id || isNaN(Number(id))) {
    showToast('⚠️ ID 无效，无法删除');
    return;
  }

  const confirmed = await showConfirm('删除鸣谢', '确定要从鸣谢名单中删除这个人吗？');
  if (!confirmed) return;

  try {
    const res = await fetch('/api/thanks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: Number(id) })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('🗑️ 已删除');
      loadThanks();
    } else {
      showToast('删除失败');
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* ============================================================
   👑 赞助者（新「❤️ 鸣谢名单」页里赞助者那一栏）
   ------------------------------------------------------------
   2026-10-01 晚（站主：「删除就是删除了，不要搞什么隐藏」）：
   赞助者**只在 D1 里管** —— 加 / 改 / 删都直接生效，删除就是真删掉。
   仓库里的 data/sponsors.json 保留成一份存档，页面不再读它，
   所以这里也不再需要「同名覆盖」「隐藏标记」那套东西。
   ------------------------------------------------------------
   字段口径（前端 thanks.html 按同一套读，别改名）：
   · 类别固定写死 '👑 赞助者'；
   · 「金额」存 platform 字段（例如 '¥10'），「感谢语」存 message 字段。
   ============================================================ */
const SPONSOR_CATEGORY = '👑 赞助者';

/* 2026-10-01 白天那版「删除」曾用这个类别存隐藏标记。
   现在改了做法（真删），这里只留一个过滤：万一 D1 里还躺着这种老标记，
   不许它混进鸣谢名单里显示。新代码不再往里写东西。 */
const SPONSOR_HIDDEN_CATEGORY = '🚫 已删除赞助者';

/* D1 那部分的缓存：编辑时按 id 取回原值 */
let sponsorCache = [];

/* 已经拉过一次没有？用来避免来回切标签反复请求 */
let sponsorsLoaded = false;

/* 正在编辑的 D1 记录 id；0 表示「新增」模式 */
let editingSponsorId = 0;

/* 第一次进面板才拉一次；之后靠「🔄 刷新」或增删后自动刷新 */
function ensureSponsors() {
  if (sponsorsLoaded) return;
  loadSponsors();
}

/* 读底档 data/sponsors.json：取不到就返回空数组
   （文件还没建 / 本地直接开文件时会 404，静默跳过，不当成错误刷屏） */
async function fetchSponsorBaseline() {
  try {
    const res = await fetch('data/sponsors.json?t=' + Date.now());
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.sponsors)) return data.sponsors;
    if (data && Array.isArray(data.list)) return data.list;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  } catch (err) {
    return [];
  }
}

/* 把服务端的英文错误码翻成人话 */
function sponsorErrorText(data, status) {
  const code = (data && (data.error || data.message)) || '';
  if (code === 'too long') return '内容太长（名字 ≤40 / 金额 ≤30 / 感谢语 ≤200）';
  if (code === 'missing fields') return '名字不能为空（类别是固定写死的）';
  if (code === 'unauthorized') return '登录已过期，请重新登录';
  if (code === 'bad origin') return '来源校验没通过，刷新页面再试';
  if (code === 'invalid id') return '这条记录的 ID 不对，刷新后再试';
  if (code) return code;
  return 'HTTP ' + status;
}

async function loadSponsors() {
  sponsorsLoaded = true;

  const container = document.getElementById('sponsorList');
  if (!container) return;
  container.innerHTML = '<div class="loading">加载中...</div>';

  /* 名单只有一处来源：D1 的 thanks 表里 category = '👑 赞助者' 的行。
     （2026-10-01 晚站主：「删除就是删除了，不要搞什么隐藏」——
      仓库底档 data/sponsors.json 不再参与显示，只当存档；
      但切换那天 D1 里一个赞助者都没有，所以要给个「一键把底档搬进 D1」的入口。） */
  let d1People = [];
  let d1Error = '';

  try {
    const res = await fetch('/api/thanks?t=' + Date.now());
    if (!res.ok) {
      d1Error = '加载失败（HTTP ' + res.status + '）· 登录可能已过期，请重新登录';
    } else {
      const data = await res.json();
      if (data && data.ok === false) {
        d1Error = '加载失败：' + escapeHtml(data.error || '未知错误');
      } else if (Array.isArray(data)) {
        const cat = data.find(c => c && c.category === SPONSOR_CATEGORY);
        d1People = (cat && Array.isArray(cat.people)) ? cat.people : [];
      }
    }
  } catch (err) {
    d1Error = '网络异常，名单没加载出来';
  }

  sponsorCache = d1People;
  setStatText('statSponsorTotal', d1People.length);

  sponsorRows = d1People.map(person => ({ item: person }));
  sponsorD1Error = d1Error;
  renderSponsorPage();
}

/* 赞助者：每页 100 人（2026-10-01 站主要求，跟宝库页一样） */
let sponsorRows = [];
let sponsorPage = 1;
let sponsorD1Error = '';

function renderSponsorPage() {
  const container = document.getElementById('sponsorList');
  const pager = document.getElementById('sponsorPager');
  const total = sponsorRows.length;

  sponsorPage = clampPage(sponsorPage, total);

  container.innerHTML = '';

  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = sponsorD1Error ? '名单加载失败' : '暂无赞助者';
    container.appendChild(empty);
    if (sponsorD1Error) {
      const warn = document.createElement('div');
      warn.className = 'empty-state';
      warn.textContent = '⚠️ ' + sponsorD1Error;
      container.appendChild(warn);
    }
    if (pager) pager.hidden = true;
    return;
  }

  const start = (sponsorPage - 1) * ADMIN_PAGE_SIZE;
  const pageItems = sponsorRows.slice(start, start + ADMIN_PAGE_SIZE);

  container.innerHTML = '';
  pageItems.forEach(({ item }) => {
    const person = item || {};
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div class="row1">
        <span class="name">${escapeHtml(person.name)}</span>
        ${person.platform ? '<span class="type-tag gold">' + escapeHtml(person.platform) + '</span>' : ''}
      </div>
      ${person.message ? '<div class="message">' + escapeHtml(person.message) + '</div>' : ''}
      <div class="actions">
        <button class="btn-edit-sponsor" data-id="${escapeHtml(String(person.id))}">✏️ 编辑</button>
        <button class="btn-delete" data-id="${escapeHtml(String(person.id))}">🗑️ 删除</button>
      </div>
    `;
    container.appendChild(el);
  });

  container.querySelectorAll('.btn-edit-sponsor').forEach(btn => {
    btn.addEventListener('click', () => startEditSponsor(Number(btn.dataset.id)));
  });
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteSponsor(Number(btn.dataset.id)));
  });

  if (sponsorD1Error) {
    const warn = document.createElement('div');
    warn.className = 'empty-state';
    warn.textContent = '⚠️ ' + sponsorD1Error;
    container.appendChild(warn);
  }

  renderAdminPager(pager, total, sponsorPage, '人', (p) => {
    sponsorPage = p;
    renderSponsorPage();
    scrollListIntoView(container);
  });
}

/* 编辑：打开同一个弹窗、把这一行的值填进去
   （2026-09-26：原来是填回上面那排行内表单，现在统一走弹窗；
    值一律用 .value 赋值，不拼 HTML） */
function startEditSponsor(id) {
  const person = sponsorCache.find(p => Number(p.id) === Number(id));
  if (!person) { showToast('未找到这条记录，刷新后再试'); return; }

  editingSponsorId = Number(id);
  document.getElementById('addSponsorName').value = person.name || '';
  document.getElementById('addSponsorAmount').value = person.platform || '';
  document.getElementById('addSponsorMessage').value = person.message || '';

  const titleEl = document.getElementById('addSponsorModalTitle');
  if (titleEl) titleEl.textContent = '✏️ 编辑赞助者';
  const okBtn = document.getElementById('confirmAddSponsor');
  if (okBtn) okBtn.textContent = '💾 保存修改';

  openModal('addSponsorModal');
  showToast('✏️ 正在编辑「' + (person.name || '') + '」，改完点「💾 保存修改」');
}

/* 「➕ 添加赞助者」：先退出编辑模式、清空表单，再开弹窗 */
function openAddSponsorModal() {
  resetSponsorForm();
  openModal('addSponsorModal');
}

/* 清空表单 + 退出编辑模式（「取消」按钮和提交成功后都走这里） */
function resetSponsorForm() {
  editingSponsorId = 0;
  ['addSponsorName', 'addSponsorAmount', 'addSponsorMessage'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const titleEl = document.getElementById('addSponsorModalTitle');
  if (titleEl) titleEl.textContent = '➕ 添加赞助者';
  const okBtn = document.getElementById('confirmAddSponsor');
  if (okBtn) { okBtn.textContent = '✅ 确认添加'; okBtn.disabled = false; }
}

/* 添加 / 保存赞助者（2026-10-01 晚：赞助者只在 D1 里管，没有底档那套了）
   ⚠️ 约定：金额写进 platform 字段、感谢语写进 message 字段，类别固定 '👑 赞助者'
   —— 前端 thanks.html 按同一套读，别改成别的字段名。 */
async function handleAddSponsor() {
  const nameEl = document.getElementById('addSponsorName');
  const amountEl = document.getElementById('addSponsorAmount');
  const messageEl = document.getElementById('addSponsorMessage');
  const name = nameEl.value.trim();
  const amount = amountEl.value.trim();
  let message = messageEl.value.trim();

  /* 长度上限跟服务端 functions/api/thanks.js 对齐（name 40 / platform 30 / message 200） */
  if (!name) { showToast('请填写名字'); nameEl.focus(); return; }
  if (name.length > 40) { showToast('名字最多 40 个字'); return; }
  if (amount.length > 30) { showToast('金额最多 30 个字'); return; }
  if (message.length > 200) { showToast('感谢语最多 200 个字'); return; }

  const editingId = editingSponsorId;

  /* 感谢语留空 → 自己写一句（2026-09-29 用户要求）。
     只在「新增」时代写：编辑时留空就是留空，那是管理员自己的选择。 */
  let autoWrote = false;
  if (!message && !editingId) {
    message = buildSmartSponsorNote(name);
    messageEl.value = message;
    autoWrote = true;
  }

  const btn = document.getElementById('confirmAddSponsor');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/thanks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingId
        ? {
            action: 'update', id: editingId, category: SPONSOR_CATEGORY,
            name, platform: amount, message
          }
        : {
            action: 'add', category: SPONSOR_CATEGORY,
            name, platform: amount, message
          })
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (data && data.ok) {
      showToast(editingId
        ? '✅ 已保存修改'
        : (autoWrote ? '✅ 已添加赞助者（感谢语留空，已自动代写）' : '✅ 已添加赞助者'));
      closeModal('addSponsorModal');
      resetSponsorForm();
      loadSponsors();
    } else {
      showToast((editingId ? '保存失败：' : '添加失败：') + sponsorErrorText(data, res.status));
    }
  } catch (err) {
    showToast('网络异常');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* 删除赞助者：真删（2026-10-01 晚站主：「删除就是删除了，不要搞什么隐藏」） */
async function deleteSponsor(id) {
  if (!id || isNaN(Number(id))) { showToast('⚠️ ID 无效，无法删除'); return; }

  const person = sponsorCache.find(p => Number(p.id) === Number(id));
  const label = person && person.name ? '「' + person.name + '」' : '这位赞助者';

  const confirmed = await showConfirm('删除赞助者', '确定删除' + label + '吗？\n\n删掉就直接没了（D1 里真删），要去鸣谢页看效果刷新一下就行。');
  if (!confirmed) return;

  try {
    const res = await fetch('/api/thanks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: Number(id) })
    });
    const data = await res.json().catch(() => null);
    if (data && data.ok) {
      showToast('🗑️ 已删除');
      if (editingSponsorId === Number(id)) resetSponsorForm();
      loadSponsors();
    } else {
      showToast('删除失败：' + sponsorErrorText(data, res.status));
    }
  } catch (err) {
    showToast('网络异常');
  }
}

/* ============================================================
   📊 数据统计面板
   ------------------------------------------------------------
   数据本来就存在 D1 里（hot_songs 热度表 / visit_sources 渠道表），
   接口也早就有了，只是后台一直没有页面把它们显示出来 —— 这里补上。

   2026-09-26：按用户要求，后台不再展示「🔥 热门 Top 100」排行榜
   （标题 / 说明 / 榜单列表 / 每行的「✕ 清空热度」全部下线），
   也没有了清空热度的入口；只保留
     · 两张汇总卡（有热度的曲目 / 总互动次数）—— 数据仍取自 /api/hot/list，
       所以这个接口还得调用，但不再渲染任何列表；
     · 📢 访问渠道来源（/api/visit/stats，不受影响）。
   后端 functions/api/hot/* 没动。
   ============================================================ */

let statsLoading = false;

async function loadStatsPanel() {
  if (statsLoading) return;
  statsLoading = true;
  try {
    await Promise.all([loadHotSummary(), loadSourceStats()]);
  } finally {
    statsLoading = false;
  }
}

/* 「有热度的曲目 / 总互动次数」两张卡：/api/hot/list 返回带 total 的列表，
   这里只取条数与 total 之和，不渲染榜单、也不提供清空入口。 */
async function loadHotSummary() {
  const elHotCount = document.getElementById('statHotCount');
  const elHotTotal = document.getElementById('statHotTotal');
  if (!elHotCount && !elHotTotal) return;

  try {
    const res = await fetch('/api/hot/list?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();
    if (!data || data.ok !== true || !Array.isArray(data.data)) {
      throw new Error((data && data.error) || 'bad payload');
    }

    const list = data.data;
    const totalInteractions = list.reduce((sum, x) => sum + (Number(x.total) || 0), 0);
    if (elHotCount) elHotCount.textContent = list.length.toLocaleString('en-US');
    if (elHotTotal) elHotTotal.textContent = totalInteractions.toLocaleString('en-US');
  } catch (err) {
    console.error('[stats] hot/list', err);
    if (elHotCount) elHotCount.textContent = '-';
    if (elHotTotal) elHotTotal.textContent = '-';
  }
}

/* 访问渠道：/api/visit/stats 返回 [{source, count}] */
async function loadSourceStats() {
  const box = document.getElementById('sourceStats');
  if (!box) return;

  box.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/visit/stats?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) {
      box.innerHTML = '<div class="empty-state">加载失败（HTTP ' + res.status + '）</div>';
      return;
    }
    const data = await res.json();
    if (!data || data.ok !== true || !Array.isArray(data.data)) {
      box.innerHTML = '<div class="empty-state">加载失败：' + escapeHtml((data && data.error) || '未知错误') + '</div>';
      return;
    }

    const list = data.data
      .map(x => ({ source: String(x.source || '未填写'), count: Number(x.count) || 0 }))
      .filter(x => x.count > 0)
      .sort((a, b) => b.count - a.count);

    const visitors = list.reduce((sum, x) => sum + x.count, 0);
    const elSrcCount = document.getElementById('statSourceCount');
    const elVisitor = document.getElementById('statVisitorCount');
    if (elSrcCount) elSrcCount.textContent = list.length.toLocaleString('en-US');
    if (elVisitor) elVisitor.textContent = visitors.toLocaleString('en-US');

    if (list.length === 0) {
      box.innerHTML = '<div class="empty-state">还没有人回答过来源。<br>访客在宝库页点「📢 告诉我们你从哪来」就会记录在这里。</div>';
      return;
    }

    const max = list[0].count || 1;
    box.innerHTML = '';

    const frag = document.createDocumentFragment();
    list.forEach(item => {
      const row = document.createElement('div');
      row.className = 'source-row';

      const top = document.createElement('div');
      top.className = 'source-top';

      const name = document.createElement('span');
      name.className = 'source-name';
      name.textContent = item.source;

      const num = document.createElement('span');
      num.className = 'source-num';
      num.textContent = item.count + ' 人 · ' + Math.round((item.count / visitors) * 100) + '%';

      top.append(name, num);

      const bar = document.createElement('div');
      bar.className = 'source-bar';
      const fill = document.createElement('i');
      fill.style.width = Math.max(3, Math.round((item.count / max) * 100)) + '%';
      bar.appendChild(fill);

      row.append(top, bar);
      frag.appendChild(row);
    });

    box.appendChild(frag);
  } catch (err) {
    console.error('[stats] visit/stats', err);
    box.innerHTML = '<div class="empty-state">加载失败，请检查网络</div>';
  }
}

/* 点「刷新」按钮时重新拉一次 */
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('refreshStatsBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '⏳ 刷新中...';
      await loadStatsPanel();
      btn.disabled = false;
      btn.textContent = '🔄 刷新';
      showToast('✅ 统计已刷新');
    });
  }
});

/* 2026-09-29：这里原来是「博客管理（卡片2 · 玩家交流）」整段 ——
   社区帖子管理 + 拉黑名单 + 隐藏/恢复/误报复位/拉黑/删除 全部随之删除
   （用户要求把玩家社区及其相关内容全部清掉，前端、接口、D1 表都不留）。 */

/* ============================================================
   全局暴露（供 admin.html 内联脚本批量导入使用）
   ============================================================ */
window.loadSongs = loadSongs;
window.loadRobloxStats = loadRobloxStats;
window.addSongToServer = addSongToServer;
window.loadStatsPanel = loadStatsPanel;
window.loadSponsors = loadSponsors;
window.ensureSponsors = ensureSponsors;