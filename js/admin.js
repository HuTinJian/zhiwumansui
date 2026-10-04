/* ============================================================
   织雾满穗 · 后台管理
   卡片管理（歌曲 / 无效音乐ID管理）、
   鸣谢名单（👑 赞助者 + 🎮 Roblox ID 宝库）、数据统计
   ------------------------------------------------------------
   2026-10-01 用户要求：
     · 每个列表面板都配上「📊 数据统计」，卡片内容各归各位
       （「开发者隔离区」那张卡从歌曲管理搬到隔离区自己那儿，
        歌曲管理这边换成「D1 歌曲数量」）；
     · 标题后面那些灰色数字徽章全部删掉（数字只看统计卡）；
     · 「📥 导入」改名「➕ 添加歌曲 / ➕ 添加隔离歌曲」，跟鸣谢名单的叫法对齐。
   2026-10-05 站主要求（契约 .verify/SPEC-invalid-20261005.md）：
     · 「💬 反馈管理」整块下线 —— 标签、面板、弹窗、统计卡、所有反馈 JS 一起删；
     · 原「⛔ 开发者隔离区」并入新的「🚫 无效音乐ID管理」（待处理上报 / 已忽略 /
       已下架 三段 + 统计卡 + 分页 + 批量操作 + 导出 + 清空已忽略）；
     · 鸣谢类别新增「网站创新家」，该类别的描述由站主手写、绝不自动代写。
   ============================================================ */

/* 「💡 网站创新家」这个类别的名字跟数据口径绑着（D1 里存的就是带图标的这七个字符），别改。
   2026-10-05 站主明确：这一栏的描述他自己手写，所以代码里写死「绝不自动代写」。
   2026-10-05 补：站主说「网站创新家前面也要有个图标」→ 类别名统一带上 💡
   （跟别的类别 `🎬 ID公益UP主/作者` / `💬 反馈贡献者` 一样，前面的图标属于名字的一部分，
   后台下拉、D1、鸣谢页显示的是同一个字符串）。判断用 indexOf 宽松匹配，
   这样以前存成不带图标的「网站创新家」的老数据（如果以后有）也照样算数。 */
const MANUAL_NOTE_CATEGORY = '💡 网站创新家';
const MANUAL_NOTE_KEYWORD = '网站创新家';

/* 弹窗里那个「✍️ 描述由我手写」勾选框是不是「系统替站主勾的」
   （类别选到网站创新家时自动勾上；切走类别要把这一下撤掉，站主自己点的勾永远不动） */
let manualNoteAuto = false;

/* 这个类别是不是「网站创新家」（带不带 💡 都算）。
   三个地方要判它：勾选框自动勾上、自动代写拦一道、编辑时回填 —— 判断只留这一份。 */
function isInnovatorCategory(cat) {
  return String(cat === undefined || cat === null ? '' : cat).indexOf(MANUAL_NOTE_KEYWORD) !== -1;
}

/* ============================================================
   🙏 玩家感谢（2026-10-05 站主要求新增）
   ------------------------------------------------------------
   站主原话：「鸣谢名单加一个『玩家感谢』，里面把 Roblox 里面的网站创新家弄到这里来，
   后台依旧跟 Roblox 一样可以自定义」。
   · 鸣谢页多了第三个切换「🙏 玩家感谢」；「💡 网站创新家」从 Roblox 那栏搬过来；
   · 后台多了个子面板「🙏 玩家感谢」，跟 Roblox 那一栏一样能增 / 改 / 删、能自定义类别。
   归属规则（**必须跟 thanks.html 里的 isPlayerThanks 一模一样，改一处要改两处**）：
     一个类别属于「玩家感谢」当且仅当 ——
       ① 名字里带 🙏（后台在这一栏新增/自定义时自动补前缀，见 PLAYER_THANKS_PREFIX）
       ② 名字里含「玩家感谢」
       ③ 名字里含「网站创新家」（就是搬过来的那一类，D1 里的名字没变，不用改库）
     其余类别（除 👑 赞助者 / 🚫 已删除赞助者）都归「🎮 Roblox ID 宝库」。
   所以「自定义」照样能用：随便起名字，保存时自动带上 🙏 前缀就会落到玩家感谢栏。
   ============================================================ */
const PLAYER_THANKS_MARK = '🙏';
const PLAYER_THANKS_KEYWORD = '玩家感谢';
const PLAYER_THANKS_PREFIX = '🙏 ';

function isPlayerThanksCategory(cat) {
  const name = String(cat === undefined || cat === null ? '' : cat);
  if (!name) return false;
  if (name.indexOf(PLAYER_THANKS_MARK) !== -1) return true;
  if (name.indexOf(PLAYER_THANKS_KEYWORD) !== -1) return true;
  return isInnovatorCategory(name);
}

/* 当前「添加 / 编辑鸣谢」弹窗是从哪一栏打开的：roblox / players。
   决定两件事：① 下拉里只列出归属这一栏的类别；② 保存时要不要给自定义类别补 🙏 前缀。 */
let addThanksScope = 'roblox';

/* 现在到底要不要「不自动代写」：勾选框勾着，或者类别就是网站创新家。
   两个地方（自动代写、提交保存）都走这一个判断，口径只有一处。 */
function isManualThanksNote() {
  const el = document.getElementById('addThanksManualNote');
  if (el && el.checked) return true;
  return String(currentThanksCategory() || '').indexOf(MANUAL_NOTE_KEYWORD) !== -1;
}

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

  loadRobloxStats();
  loadSongs();
  loadThanks();
  /* 2026-10-05：卡片管理是默认打开的面板，所以无效音乐ID管理一进来就拉一次；
     （原来这里第一行拉的是反馈列表，反馈面板整块下线后换成 loadInvalid()） */
  loadInvalid();
  // 注：2026-09-29 起后台没有「更新管理」了（公告改由 AI 写 data/updates.json），
  // 所以这里也不需要为任何更新面板做初始化。

  /* 🚫 无效音乐ID管理：工具条 / 三段切换 / 批量操作（2026-10-05 新增）
     —— 原来这里是「➕ 添加隔离歌曲」弹窗的三条绑定，那个弹窗随旧隔离区面板删了。 */
  bindInvalidPanel();

  /* 🎶 歌曲管理的搜索框（2026-10-05 站主要求）：输入停 150ms 再重画，页码回到第 1 页；
     ESC 一键清空（跟宝库页搜索框一个手感）。 */
  const songSearchEl = document.getElementById('songSearch');
  if (songSearchEl) {
    const applySongSearch = debounce(() => {
      songSearch = songSearchEl.value || '';
      songPage = 1;
      renderSongPage();
    }, 150);
    songSearchEl.addEventListener('input', applySongSearch);
    songSearchEl.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      songSearchEl.value = '';
      songSearch = '';
      songPage = 1;
      renderSongPage();
    });
  }

  /* 歌曲管理按钮（2026-09-29 用户要求把「➕ 添加歌曲」和「📤 导出」两个按钮拿掉，
     只服务于它们的弹窗和处理函数也一并删了；「📥 导入」是在 admin.html 的内联脚本里
     单独绑的，跟这里无关）。所以这一块现在只剩「🧹 清空」一条绑定。 */
  document.getElementById('clearSongsBtn').onclick = handleClearSongs;

  /* 📤 导出按钮（2026-09-29 用户要求：「卡片管理」和「鸣谢名单」各加一键导出） */
  const exportSongsBtn = document.getElementById('exportSongsBtn');
  if (exportSongsBtn) exportSongsBtn.onclick = handleExportSongs;
  const exportThanksBtn = document.getElementById('exportThanksBtn');
  if (exportThanksBtn) exportThanksBtn.onclick = () => handleExportThanks('roblox');
  const exportPlayerThanksBtn = document.getElementById('exportPlayerThanksBtn');
  if (exportPlayerThanksBtn) exportPlayerThanksBtn.onclick = () => handleExportThanks('players');
  const exportSponsorsBtn = document.getElementById('exportSponsorsBtn');
  if (exportSponsorsBtn) exportSponsorsBtn.onclick = handleExportSponsors;

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
    /* 2026-10-05：类别定了就同步「✍️ 描述由我手写」——
       类别 = 网站创新家 时必然勾上（那一栏是站主手写的），
       从它切到别的类别时把「刚才是系统帮勾的」那一下撤掉（管理员自己勾的不动）。 */
    syncManualNoteWithCategory();
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
      syncManualNoteWithCategory();   /* 手动把类别名打成「网站创新家」时也算数 */
      refreshThanksNote();
    });
  }

  /* ============================================================
     ✍️ 「描述由我手写（不自动代写）」（2026-10-05 站主要求）
     ------------------------------------------------------------
     勾上之后，描述框里写什么就原样存什么，一个字都不代写。
     · 类别 = 网站创新家 → 默认勾上；refreshThanksNote / handleAddThanks 都不代写
       （站主明确说这一类他自己写）。这一下是「系统帮勾的」，
       切到别的类别时会自动撤掉；管理员自己点的勾永远不动。
     · 判断统一走上面的 isManualThanksNote()，别在这里另写一套。
     ============================================================ */
  function manualNoteEl() {
    return document.getElementById('addThanksManualNote');
  }

  function syncManualNoteWithCategory() {
    const el = manualNoteEl();
    if (!el) return;
    if (isInnovatorCategory(currentThanksCategory())) {
      if (!el.checked) { el.checked = true; manualNoteAuto = true; }
      return;
    }
    if (el.checked && manualNoteAuto) {
      el.checked = false;
      manualNoteAuto = false;
    }
  }

  const manualNoteBox = manualNoteEl();
  if (manualNoteBox) {
    manualNoteBox.addEventListener('change', () => {
      manualNoteAuto = false;   /* 管理员自己点的，之后不再自动改它 */
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
      /* 2026-10-05：D1 里已有的类别按归属规则自动分栏 ——
         新面板打开时只列出属于自己那一栏的类别（applyThanksDropdownForPanel 会过滤）。 */
      opt.dataset.scope = isPlayerThanksCategory(name) ? 'players' : 'roblox';
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

  /* 按当前是哪一栏过滤下拉选项（2026-10-05）：
     scope 为 players 的只在「🙏 玩家感谢」里出现，roblox 的只在「🎮 Roblox ID 宝库」里出现；
     「✏️ 自定义类别…」两边都有。顺带把上一次的选择清干净，免得串栏。 */
  function applyThanksDropdownForPanel() {
    if (!addThanksDropdown) return;
    addThanksDropdown.querySelectorAll('.select-option').forEach(o => {
      if (o.dataset.value === '__custom__') { o.hidden = false; return; }
      const scope = o.dataset.scope === 'players' ? 'players' : 'roblox';
      o.hidden = scope !== addThanksScope;
      o.classList.remove('active');
      o.setAttribute('aria-selected', 'false');
    });
    const selected = document.getElementById('addThanksSelectedCat');
    if (selected) selected.textContent = '请选择类别';
    const customEl = document.getElementById('addThanksCustomCat');
    if (customEl) { customEl.hidden = true; customEl.value = ''; }
    const trigger = document.getElementById('addThanksSelectTrigger');
    if (trigger) trigger.classList.remove('selected');
    setAddThanksOpen(false);
  }

  /* 编辑鸣谢时（startEditThanks 在外层）也要按那一栏过滤下拉，所以挂到 window 上 */
  window.applyThanksDropdownForPanel = applyThanksDropdownForPanel;

  /* 「➕ 添加鸣谢」（Roblox 那一栏） */
  document.getElementById('openAddThanksBtn').onclick = () => {
    /* 先清干净（顺便退出「编辑鸣谢」模式），再开弹窗 */
    addThanksScope = 'roblox';
    resetThanksForm();
    applyThanksDropdownForPanel();
    openModal('addThanksModal');
  };

  /* 「➕ 添加玩家感谢」（玩家感谢那一栏，2026-10-05 新增）——
     跟上面那颗同一个弹窗，只是限定在「玩家感谢」这一栏的类别里选。 */
  const openAddPlayerBtn = document.getElementById('openAddPlayerBtn');
  if (openAddPlayerBtn) openAddPlayerBtn.onclick = () => {
    addThanksScope = 'players';
    resetThanksForm();
    applyThanksDropdownForPanel();
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
     类别统一走 currentThanksCategory()：自定义类别取输入框里的字。
     2026-10-05：勾了「✍️ 描述由我手写」就一句话都不代写（网站创新家必然如此）。 */
  function refreshThanksNote() {
    if (isManualThanksNote()) return;
    const cat = currentThanksCategory();
    if (!cat) return;
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

  /* 2026-10-05 站主要求：类别 = 网站创新家 时描述由站主手写，一个字都不许代写。
     这里再兜一道 —— 万一以后哪里漏了判断，也会返回空串（调用方拿到空串就不填）。
     用关键字宽松判断：类别名带不带 💡 都算（见 MANUAL_NOTE_KEYWORD 的注释）。 */
  if (isInnovatorCategory(cat)) return '';

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

/* ============================================================
   Roblox 数据（歌曲管理那三张统计卡）
   ------------------------------------------------------------
   2026-10-01 用户要求：
     · 歌曲管理的统计卡 = 总 ID 数 / 歌曲组数 / **D1 歌曲数量**（新加）。
   2026-10-05：原来这里还顺带渲染「开发者隔离区」列表和统计，
     那段随旧面板一起删了 —— 待处理 / 已忽略 / 已下架 现在全归
     下面的「🚫 无效音乐ID管理」管。
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
  } catch (err) {
    /* 连主数据都拉不到：三张卡老老实实显示 '-'，不假装是 0 */
    setStatText('statTotal', '-');
    setStatText('statGroup', '-');
    setStatText('statD1Songs', '-');
  }
}

/* ============================================================
   🚫 无效音乐ID管理（2026-10-05 新增，替代原「⛔ 开发者隔离区」）
   ------------------------------------------------------------
   数据口径（契约 .verify/SPEC-invalid-20261005.md 第 3 节，别自己改）：
     · 待处理 / 已忽略 → GET /api/invalid/list（按 music_id 聚合，响应里带 summary）
     · 已下架          → GET /api/quarantine/list
                         （quarantine_admin 这张旧表沿用不改名，界面文案统一叫「已下架」）
     · 操作            → POST /api/invalid/handle { ids, action }
         remove        确认无效 → 从全站下架
         ignore        判定这条上报不算
         restore       撤销下架重新上架 / 把已忽略的恢复为待处理（两处共用同一个 action）
         clear-ignored 清空全部已忽略
     · handle 返回的 changed 只是「受影响行数」（重复执行 remove 也还是 1），
       所以这里一律以列表接口给回来的 status 为准，不拿 changed 当「处理过」的凭据。
   导出：跟 data/admin_quarantine.json 完全一致 —— [{id, name, category}] 数组，
   拿到直接覆盖那个文件即可。
   ============================================================ */

/* 三段各自的缓存与页码：切段 / 翻页只重画，不重新发请求（点「🔄 刷新」才重拉） */
let invalidPendingCache = [];
let invalidIgnoredCache = [];
let invalidRemovedCache = [];
let invalidPendingPage = 1;
let invalidIgnoredPage = 1;
let invalidRemovedPage = 1;

/* 已下架那一栏的加载错误（拉到一半失败时，列表里要说人话，不能假装是空的） */
let invalidRemovedError = '';

/* 当前在哪一段：pending / ignored / removed，跟着三段按钮上的 data-seg 走 */
let invalidSeg = 'pending';

/* 2026-10-05 站主要求：三个分类各自搜索自己的（互不影响）。
   空串 = 这一段不过滤；匹配 ID / 歌名 / 分类 / 来源，忽略大小写。 */
const invalidSearch = { pending: '', ignored: '', removed: '' };

/* 按该段的搜索词过滤。三段的分页都基于「过滤后的结果」，所以页码也会跟着重算。 */
function filterInvalidList(list, seg) {
  const kw = String(invalidSearch[seg] || '').trim().toLowerCase();
  if (!kw) return list;
  return list.filter(it => (
    String(it.id || '').toLowerCase().indexOf(kw) !== -1 ||
    String(it.name || '').toLowerCase().indexOf(kw) !== -1 ||
    String(it.category || '').toLowerCase().indexOf(kw) !== -1 ||
    String(it.source || '').toLowerCase().indexOf(kw) !== -1
  ));
}

/* 搜索框右边那句「匹配 N 条 / 共 M 条」；没输入搜索词时清空（不占地方） */
function updateInvalidSearchInfo(seg, matched, total) {
  const id = 'invalid' + seg.charAt(0).toUpperCase() + seg.slice(1) + 'SearchInfo';
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(invalidSearch[seg] || '').trim()
    ? '匹配 ' + matched.toLocaleString('en-US') + ' 条 / 共 ' + total.toLocaleString('en-US') + ' 条'
    : '';
}

/* 统计卡上的数字：拿不到就显示 '-'（「不知道」和「0 条」是两回事） */
function invalidStatNum(v) {
  if (v === undefined || v === null || v === '' || isNaN(Number(v))) return '-';
  return Number(v).toLocaleString('en-US');
}

/* 拉数据：待处理 + 已忽略一个请求就够（status=all），已下架单独一个接口 */
async function loadInvalid() {
  const boxPending = document.getElementById('invalidPendingList');
  if (!boxPending) return;   /* 面板不在页面上（比如以后又挪走了）就安静退出 */

  const boxIgnored = document.getElementById('invalidIgnoredList');
  const boxRemoved = document.getElementById('invalidRemovedList');
  boxPending.innerHTML = '<div class="loading">加载中...</div>';
  if (boxIgnored) boxIgnored.innerHTML = '<div class="loading">加载中...</div>';
  if (boxRemoved) boxRemoved.innerHTML = '<div class="loading">加载中...</div>';

  let summary = null;
  let listOk = false;

  try {
    /* limit 取服务端上限 2000：分页在前端做，争取一次把要用的都拿回来 */
    const res = await fetch('/api/invalid/list?status=all&limit=2000&t=' + Date.now(), { credentials: 'include' });
    if (!res.ok) {
      const msg = '<div class="empty-state">加载失败（HTTP ' + res.status + '）· 登录可能已过期，请重新登录</div>';
      boxPending.innerHTML = msg;
      if (boxIgnored) boxIgnored.innerHTML = msg;
      setStatText('statInvalidPending', '-');
      setStatText('statInvalidReports', '-');
      setStatText('statInvalidIgnored', '-');
    } else {
      const data = await res.json();
      if (!data || data.ok !== true || !Array.isArray(data.data)) {
        const msg = '<div class="empty-state">加载失败：' + escapeHtml((data && data.error) || '返回格式不对') + '</div>';
        boxPending.innerHTML = msg;
        if (boxIgnored) boxIgnored.innerHTML = msg;
      } else {
        const rows = data.data.map(it => ({
          id: String((it && it.musicId) || ''),
          name: String((it && it.name) || '') || '未知歌名',
          category: String((it && it.category) || '') || '未分类',
          count: Number(it && it.count) || 0,
          status: (it && it.status) === 'ignored' ? 'ignored' : 'pending',
          firstAt: (it && it.firstAt) || '',
          lastAt: (it && it.lastAt) || ''
        })).filter(it => it.id);

        invalidPendingCache = rows.filter(it => it.status !== 'ignored');
        invalidIgnoredCache = rows.filter(it => it.status === 'ignored');
        summary = (data && data.summary) || null;
        listOk = true;
      }
    }
  } catch (err) {
    const msg = '<div class="empty-state">加载失败，请检查网络</div>';
    boxPending.innerHTML = msg;
    if (boxIgnored) boxIgnored.innerHTML = msg;
  }

  /* 已下架：单独一个接口，失败不影响上面两段 */
  invalidRemovedError = '';
  try {
    const res = await fetch('/api/quarantine/list?t=' + Date.now(), { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || data.ok === false || !Array.isArray(data.data)) {
      throw new Error((data && data.error) || '返回格式不对');
    }
    invalidRemovedCache = data.data.map(it => ({
      id: String((it && it.id) || ''),
      name: (it && it.name) || '未知歌名',
      category: (it && it.category) || '未分类',
      source: (it && it.source) || '',
      at: (it && it.quarantinedAt) || ''
    })).filter(it => it.id);
  } catch (err) {
    invalidRemovedCache = [];
    invalidRemovedError = '加载失败，请检查网络';
  }

  /* 统计卡：四张都取自列表接口的 summary；
     已下架那张在 summary 拿不到时用列表长度兜底（口径一样，都是 quarantine_admin 的行数） */
  if (summary) {
    setStatText('statInvalidPending', invalidStatNum(summary.pendingIds));
    setStatText('statInvalidReports', invalidStatNum(summary.pendingReports));
    setStatText('statInvalidIgnored', invalidStatNum(summary.ignoredIds));
    setStatText('statInvalidRemoved', invalidStatNum(summary.removedIds));
  } else {
    setStatText('statInvalidRemoved', invalidStatNum(invalidRemovedCache.length));
    if (!listOk) {
      setStatText('statInvalidPending', '-');
      setStatText('statInvalidReports', '-');
      setStatText('statInvalidIgnored', '-');
    }
  }

  renderInvalidSegment();
}

/* 按当前段把列表画出来（三段各自分页） */
function renderInvalidSegment() {
  if (invalidSeg === 'ignored') renderInvalidIgnored();
  else if (invalidSeg === 'removed') renderInvalidRemoved();
  else renderInvalidPending();
}

/* ① 待处理上报：勾选若干条 → 批量下架 / 批量忽略 */
function renderInvalidPending() {
  const container = document.getElementById('invalidPendingList');
  const pager = document.getElementById('invalidPendingPager');
  if (!container) return;

  const all = invalidPendingCache;
  const list = filterInvalidList(all, 'pending');
  const total = list.length;
  invalidPendingPage = clampPage(invalidPendingPage, total);
  updateInvalidSearchInfo('pending', total, all.length);

  if (total === 0) {
    container.innerHTML = String(invalidSearch.pending || '').trim()
      ? '<div class="empty-state">这一栏里没有匹配「' + escapeHtml(invalidSearch.pending.trim()) + '」的条目。<br>换个关键词试试，或清空搜索框。</div>'
      : '<div class="empty-state">还没有待处理的上报。<br>宝库页访客点「🚫 无效处理」就会出现在这里。</div>';
    if (pager) pager.hidden = true;
    updateInvalidPickInfo();
    return;
  }

  const start = (invalidPendingPage - 1) * ADMIN_PAGE_SIZE;
  const pageItems = list.slice(start, start + ADMIN_PAGE_SIZE);

  container.innerHTML = '';
  pageItems.forEach(item => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div class="row1">
        <span class="invalid-head-left">
          <label class="invalid-pick" title="勾选后可批量下架 / 批量忽略">
            <input type="checkbox" class="invalid-pick-cb" data-id="${escapeHtml(item.id)}">
          </label>
          <span class="name">${escapeHtml(item.name)}</span>
        </span>
        <span>
          <span class="type-tag">${escapeHtml(item.category)}</span>
          <span class="type-tag red">🚫 上报 ${item.count} 次</span>
        </span>
      </div>
      <div class="meta">
        🆔 <span class="invalid-id">${escapeHtml(item.id)}</span>
        ${item.lastAt ? ' · 🕒 最近上报 ' + escapeHtml(item.lastAt) : ''}
        ${item.firstAt ? ' · 首次 ' + escapeHtml(item.firstAt) : ''}
      </div>
      <div class="actions">
        <button class="btn-invalid-remove" data-id="${escapeHtml(item.id)}">✅ 确认无效并下架</button>
        <button class="btn-invalid-ignore" data-id="${escapeHtml(item.id)}">🙈 忽略</button>
      </div>
    `;
    container.appendChild(el);
  });

  container.querySelectorAll('.invalid-pick-cb').forEach(cb => {
    cb.addEventListener('change', updateInvalidPickInfo);
  });
  container.querySelectorAll('.btn-invalid-remove').forEach(btn => {
    btn.addEventListener('click', () => confirmInvalidRemove([btn.dataset.id]));
  });
  container.querySelectorAll('.btn-invalid-ignore').forEach(btn => {
    btn.addEventListener('click', () => handleInvalidAction([btn.dataset.id], 'ignore'));
  });

  renderAdminPager(pager, total, invalidPendingPage, '个 ID', (p) => {
    invalidPendingPage = p;
    renderInvalidPending();
    scrollListIntoView(container);
  });

  updateInvalidPickInfo();
}

/* ② 已忽略：单行「♻️ 恢复为待处理」（跟已下架的「🔓 恢复上架」是同一个 restore） */
function renderInvalidIgnored() {
  const container = document.getElementById('invalidIgnoredList');
  const pager = document.getElementById('invalidIgnoredPager');
  if (!container) return;

  const all = invalidIgnoredCache;
  const list = filterInvalidList(all, 'ignored');
  const total = list.length;
  invalidIgnoredPage = clampPage(invalidIgnoredPage, total);
  updateInvalidSearchInfo('ignored', total, all.length);

  if (total === 0) {
    container.innerHTML = String(invalidSearch.ignored || '').trim()
      ? '<div class="empty-state">这一栏里没有匹配「' + escapeHtml(invalidSearch.ignored.trim()) + '」的条目。</div>'
      : '<div class="empty-state">没有已忽略的上报。</div>';
    if (pager) pager.hidden = true;
    return;
  }

  const start = (invalidIgnoredPage - 1) * ADMIN_PAGE_SIZE;
  const pageItems = list.slice(start, start + ADMIN_PAGE_SIZE);

  container.innerHTML = '';
  pageItems.forEach(item => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div class="row1">
        <span class="name">${escapeHtml(item.name)}</span>
        <span class="type-tag">🙈 已忽略</span>
      </div>
      <div class="meta">
        🆔 <span class="invalid-id">${escapeHtml(item.id)}</span>
        ${item.category ? ' · 📂 ' + escapeHtml(item.category) : ''}
        · 🚫 上报 ${item.count} 次
        ${item.lastAt ? ' · 🕒 最近上报 ' + escapeHtml(item.lastAt) : ''}
      </div>
      <div class="actions">
        <button class="btn-invalid-restore" data-id="${escapeHtml(item.id)}">♻️ 恢复为待处理</button>
      </div>
    `;
    container.appendChild(el);
  });

  container.querySelectorAll('.btn-invalid-restore').forEach(btn => {
    btn.addEventListener('click', () => handleInvalidAction([btn.dataset.id], 'restore'));
  });

  renderAdminPager(pager, total, invalidIgnoredPage, '个 ID', (p) => {
    invalidIgnoredPage = p;
    renderInvalidIgnored();
    scrollListIntoView(container);
  });
}

/* ③ 已下架：来自 /api/quarantine/list，单行「🔓 恢复上架」 */
function renderInvalidRemoved() {
  const container = document.getElementById('invalidRemovedList');
  const pager = document.getElementById('invalidRemovedPager');
  if (!container) return;

  const all = invalidRemovedCache;
  const list = filterInvalidList(all, 'removed');
  const total = list.length;
  invalidRemovedPage = clampPage(invalidRemovedPage, total);
  updateInvalidSearchInfo('removed', total, all.length);

  if (total === 0) {
    /* 三种空状态分清楚：加载失败 > 搜索没匹配 > 本来就没有 */
    if (invalidRemovedError) {
      container.innerHTML = '<div class="empty-state">' + escapeHtml(invalidRemovedError) + '</div>';
    } else if (String(invalidSearch.removed || '').trim()) {
      container.innerHTML = '<div class="empty-state">这一栏里没有匹配「' + escapeHtml(invalidSearch.removed.trim()) + '」的条目。</div>';
    } else {
      container.innerHTML = '<div class="empty-state">还没有已下架的 ID。</div>';
    }
    if (pager) pager.hidden = true;
    return;
  }

  const start = (invalidRemovedPage - 1) * ADMIN_PAGE_SIZE;
  const pageItems = list.slice(start, start + ADMIN_PAGE_SIZE);

  container.innerHTML = '';
  pageItems.forEach(item => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div class="row1">
        <span class="name">${escapeHtml(item.name)}</span>
        <span class="type-tag green">✅ 已下架</span>
      </div>
      <div class="meta">
        🆔 <span class="invalid-id">${escapeHtml(item.id)}</span>
        ${item.category ? ' · 📂 ' + escapeHtml(item.category) : ''}
        ${item.source ? ' · 📌 ' + escapeHtml(item.source) : ''}
        ${item.at ? ' · 🕒 ' + escapeHtml(item.at) : ''}
      </div>
      <div class="actions">
        <button class="btn-invalid-restore" data-id="${escapeHtml(item.id)}">🔓 恢复上架</button>
      </div>
    `;
    container.appendChild(el);
  });

  container.querySelectorAll('.btn-invalid-restore').forEach(btn => {
    btn.addEventListener('click', () => handleInvalidAction([btn.dataset.id], 'restore'));
  });

  renderAdminPager(pager, total, invalidRemovedPage, '个 ID', (p) => {
    invalidRemovedPage = p;
    renderInvalidRemoved();
    scrollListIntoView(container);
  });
}

/* 当前页勾了哪些 ID（批量操作只看这一页 —— 翻页会重画，勾选不跨页保留） */
function pickedInvalidIds() {
  const box = document.getElementById('invalidPendingList');
  if (!box) return [];
  return Array.from(box.querySelectorAll('.invalid-pick-cb:checked'))
    .map(cb => cb.dataset.id)
    .filter(Boolean);
}

/* 工具条左边那句「已选 N 条」 */
function updateInvalidPickInfo() {
  const el = document.getElementById('invalidPendingInfo');
  if (!el) return;
  el.innerHTML = '已选 <strong>' + pickedInvalidIds().length + '</strong> 条';
}

/* 下架（单个 / 批量）：下架 = 全站隐藏，先问一句 */
async function confirmInvalidRemove(ids) {
  const list = (ids || []).filter(Boolean);
  if (list.length === 0) { showToast('请先勾选要下架的 ID'); return; }

  const preview = list.slice(0, 10).join('、') + (list.length > 10 ? ' …' : '');
  const confirmed = await showConfirm(
    '确认无效并下架',
    '确定把这 ' + list.length + ' 个 ID 从全站下架吗？\n\n' +
    preview + '\n\n' +
    '下架后宝库页不再显示它们；想反悔可以在「✅ 已下架」那一栏点「🔓 恢复上架」。'
  );
  if (!confirmed) return;
  handleInvalidAction(list, 'remove');
}

/* 批量忽略：忽略只是「这条上报不算」，记录留着，能恢复 */
async function confirmInvalidIgnore(ids) {
  const list = (ids || []).filter(Boolean);
  if (list.length === 0) { showToast('请先勾选要忽略的上报'); return; }

  const confirmed = await showConfirm(
    '批量忽略上报',
    '确定忽略这 ' + list.length + ' 个上报吗？\n\n' +
    '忽略后它们不再算「待处理」，记录还留着，之后可以在「🙈 已忽略」里点「♻️ 恢复为待处理」。'
  );
  if (!confirmed) return;
  handleInvalidAction(list, 'ignore');
}

/* 清空已忽略：连记录一起删（契约里明确要二次确认） */
async function clearIgnoredInvalid() {
  const n = invalidIgnoredCache.length;
  if (n === 0) { showToast('已经没有已忽略的记录了'); return; }

  const confirmed = await showConfirm(
    '清空已忽略',
    '确定清空全部已忽略的记录吗？（当前列表里 ' + n + ' 个 ID）\n\n' +
    '清空后这些上报连记录一起删掉，不能再恢复为待处理；待处理和已下架的都不受影响。'
  );
  if (!confirmed) return;
  handleInvalidAction([], 'clear-ignored');
}

/* ============================================================
   ➕ 手动下架 ID（2026-10-05 补回「站主自己下架」的能力）
   ------------------------------------------------------------
   为什么要有这条：旧的「⛔ 开发者隔离区」删掉之后，站主自己发现某个 ID 不能用
   （但没有任何访客上报）就没了下架入口 —— 这条把它补回来。
   走 POST /api/quarantine/import（source 写「手动下架」）：只写「已下架」名单，
   不进 invalid_reports，所以「待处理上报 / 累计上报」的数字不受影响。
   解析刻意写得很笨：只认 ID + 可选歌名，不碰 admin.html 那套智能分类。
   ============================================================ */

/* 一行 → { id, name }。认三种写法：
     ① 整行就是一个 ID：1876950732
     ② 「ID 空格 歌名」或「歌名 空格 ID」：挑第一个「带数字的 ID 片段」
     ③ 粘在一起的：123456789《晴天》—— 抠出第一段 6 位以上的连续数字当 ID
   认不出 ID 就返回 { id:'', name:'' }，由调用方报「第 N 行没认出」。 */
function parseManualRemoveLine(line) {
  const raw = String(line == null ? '' : line).trim();
  if (!raw) return { id: '', name: '' };

  const isIdToken = (t) => /^[A-Za-z0-9_-]{1,30}$/.test(t) && /\d/.test(t);

  if (isIdToken(raw)) return { id: raw, name: '' };

  const tokens = raw.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    if (!isIdToken(tokens[i])) continue;
    const rest = tokens.filter((_, k) => k !== i).join(' ');
    return { id: tokens[i], name: cleanManualName(rest) };
  }

  const hit = raw.match(/\d{6,}/);
  if (hit) return { id: hit[0].slice(0, 30), name: cleanManualName(raw.replace(hit[0], ' ')) };

  return { id: '', name: '' };
}

/* 歌名只削掉两头的括号 / 引号 / 标点、收一收空格；绝不判断分类（那是宝库页 / 添加歌曲那边的事） */
function cleanManualName(s) {
  return String(s == null ? '' : s)
    .replace(/[《》〈〉「」『』【】\[\]{}（）()"“”'‘’]/g, ' ')
    .replace(/^[\p{P}\p{S}\s]+/u, '')
    .replace(/[\p{P}\p{S}\s]+$/u, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 100);
}

/* 打开弹窗：每次清空，别把上次贴的内容留着误提交 */
function openManualRemoveModal() {
  const ta = document.getElementById('manualRemoveText');
  const status = document.getElementById('manualRemoveStatus');
  if (ta) ta.value = '';
  if (status) { status.textContent = ''; status.className = 'import-status'; }
  const okBtn = document.getElementById('confirmManualRemove');
  if (okBtn) { okBtn.disabled = false; okBtn.textContent = '✅ 确认下架'; }
  openModal('manualRemoveModal');
  if (ta) setTimeout(() => ta.focus(), 80);
}

function setManualRemoveStatus(text, type) {
  const el = document.getElementById('manualRemoveStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'import-status' + (type ? ' ' + type : '');
}

/* 提交：解析 → 二次确认 → POST /api/quarantine/import → 刷新「已下架」段和统计卡 */
async function handleManualRemove() {
  const ta = document.getElementById('manualRemoveText');
  if (!ta) return;

  const items = [];
  const seen = new Set();
  const badLines = [];

  ta.value.split(/\r?\n/).forEach((line, idx) => {
    if (!line.trim()) return;
    const parsed = parseManualRemoveLine(line);
    if (!parsed.id) { badLines.push(idx + 1); return; }
    if (seen.has(parsed.id)) return;   /* 同一个 ID 贴两遍只算一次 */
    seen.add(parsed.id);
    items.push({ id: parsed.id, name: parsed.name, category: '' });
  });

  if (items.length === 0) {
    setManualRemoveStatus('⚠️ 没认出任何 ID：每行写一个音乐 ID（也可以「ID 空格 歌名」）', 'err');
    return;
  }
  /* 服务端单次上限 500（functions/api/quarantine/import.js），先在前面拦住 */
  if (items.length > 500) {
    setManualRemoveStatus('⚠️ 一次最多 500 个 ID，当前 ' + items.length + ' 个，请分批下架', 'err');
    return;
  }

  const badTip = badLines.length
    ? '\n\n（第 ' + badLines.slice(0, 10).join('、') + (badLines.length > 10 ? ' …' : '') + ' 行没认出 ID，会被跳过）'
    : '';

  const confirmed = await showConfirm(
    '手动下架',
    '确定把这 ' + items.length + ' 个 ID 从全站下架吗？\n\n' +
    '下架后宝库页不再显示；想反悔可以在「✅ 已下架」里点「🔓 恢复上架」。' + badTip
  );
  if (!confirmed) return;

  const okBtn = document.getElementById('confirmManualRemove');
  if (okBtn) { okBtn.disabled = true; okBtn.textContent = '下架中...'; }

  try {
    const res = await fetch('/api/quarantine/import', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items, source: '手动下架' })
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!data || data.ok !== true) {
      setManualRemoveStatus('❌ 下架失败：' + ((data && data.error) || ('HTTP ' + res.status)), 'err');
      return;
    }

    const added = Number(data.added) || 0;
    const skipped = Number(data.skipped) || 0;
    const extra = [];
    if (skipped > 0) extra.push('跳过 ' + skipped + ' 个（已经在已下架名单里）');
    if (badLines.length > 0) extra.push('另有 ' + badLines.length + ' 行没认出 ID');
    showToast('✅ 已手动下架 ' + added + ' 个 ID' + (extra.length ? '，' + extra.join('，') : ''));

    closeModal('manualRemoveModal');
    /* 下架名单变了 → 重拉一次，列表和「已下架」统计卡一起对上；
       顺带把段切到「已下架」，保证刚加进去的 ID 立刻看得见。
       （待处理 / 累计上报 不受影响：这条路径根本不写 invalid_reports） */
    invalidSeg = 'removed';
    await loadInvalid();
  } catch (err) {
    setManualRemoveStatus('❌ 网络异常，下架没生效', 'err');
  } finally {
    if (okBtn) { okBtn.disabled = false; okBtn.textContent = '✅ 确认下架'; }
  }
}

/* 调 /api/invalid/handle 干一件事。ids：要处理的音乐 ID（clear-ignored 不用传）。
   成败只看 ok，不看 changed —— 它是受影响行数，重复 remove 也还是 1。 */
async function handleInvalidAction(ids, action) {
  const body = { action: action };
  if (action !== 'clear-ignored') body.ids = (ids || []).filter(Boolean);

  try {
    const res = await fetch('/api/invalid/handle', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!data || data.ok !== true) {
      showToast('操作失败：' + ((data && data.error) || ('HTTP ' + res.status)));
      return false;
    }

    let tip;
    if (action === 'remove') tip = '✅ 已下架 ' + body.ids.length + ' 个 ID';
    else if (action === 'ignore') tip = '🙈 已忽略 ' + body.ids.length + ' 个上报';
    else if (action === 'restore') tip = '♻️ 已恢复 ' + body.ids.length + ' 个 ID';
    else tip = '🧹 已清空全部已忽略';
    showToast(tip);

    /* 下架会顺手删掉 D1 里同 ID 的歌（契约 3.4 第 2 步），所以歌曲列表和统计跟着刷新；
       其余动作只影响本面板，重拉一次把统计卡和列表对上就行 */
    if (action === 'remove') {
      loadSongs();
      loadRobloxStats();
    }
    await loadInvalid();
    return true;
  } catch (err) {
    showToast('网络异常，操作没生效');
    return false;
  }
}

/* 导出「已下架」列表：格式跟 data/admin_quarantine.json 完全一致（[{id, name, category}]），
   拿到直接覆盖那个文件即可。D1 里还多存了 source / quarantinedAt，
   但静态快照那份文件没有这两个字段，所以导出时按静态文件的格式来。 */
async function handleExportRemoved() {
  let list = invalidRemovedCache;

  try {
    const res = await fetch('/api/quarantine/list?t=' + Date.now(), { credentials: 'include' });
    const data = await res.json();
    if (data && data.ok !== false && Array.isArray(data.data)) {
      list = data.data;
    } else if (!list.length) {
      showToast('导出失败：已下架列表拿不到');
      return;
    }
  } catch (err) {
    /* 拉不到就用手上这份缓存（列表正在显示的那份），别让站主白点一下 */
    if (!list.length) { showToast('网络异常，导出失败'); return; }
  }

  const out = list.map(it => ({
    id: it.id,
    name: (it && it.name) || '未知歌名',
    category: (it && it.category) || '未分类'
  })).filter(it => it.id);

  if (!out.length) { showToast('已下架列表是空的，没什么可导出的'); return; }
  downloadJson('admin_quarantine-' + exportStamp() + '.json', out);
  showToast('📤 已导出 ' + out.length + ' 条已下架记录（格式同 data/admin_quarantine.json）');
}

/* 面板上的按钮 / 三段切换一次性挂好（初始化时调一次） */
function bindInvalidPanel() {
  const segTabs = document.getElementById('invalidSegTabs');
  if (!segTabs) return;   /* 面板不在页面上就什么都不绑 */

  /* 三段切换：显隐交给 admin.html 里那套通用的 data-subpanel 逻辑，
     这里只记下「现在在哪一段」，再把这一段重画一遍（数据早在缓存里了） */
  segTabs.querySelectorAll(':scope > .subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      invalidSeg = btn.dataset.seg || 'pending';
      renderInvalidSegment();
    });
  });

  const pickAll = document.getElementById('invalidPickAll');
  if (pickAll) pickAll.onclick = () => {
    const box = document.getElementById('invalidPendingList');
    if (box) box.querySelectorAll('.invalid-pick-cb').forEach(cb => { cb.checked = true; });
    updateInvalidPickInfo();
  };

  const pickNone = document.getElementById('invalidPickNone');
  if (pickNone) pickNone.onclick = () => {
    const box = document.getElementById('invalidPendingList');
    if (box) box.querySelectorAll('.invalid-pick-cb').forEach(cb => { cb.checked = false; });
    updateInvalidPickInfo();
  };

  const batchRemove = document.getElementById('invalidBatchRemove');
  if (batchRemove) batchRemove.onclick = () => confirmInvalidRemove(pickedInvalidIds());

  const batchIgnore = document.getElementById('invalidBatchIgnore');
  if (batchIgnore) batchIgnore.onclick = () => confirmInvalidIgnore(pickedInvalidIds());

  const clearBtn = document.getElementById('clearIgnoredBtn');
  if (clearBtn) clearBtn.onclick = clearIgnoredInvalid;

  /* ➕ 手动下架 ID（2026-10-05）：已下架段那颗按钮 + 极简弹窗 */
  const manualBtn = document.getElementById('manualRemoveBtn');
  if (manualBtn) manualBtn.onclick = openManualRemoveModal;
  const cancelManual = document.getElementById('cancelManualRemove');
  if (cancelManual) cancelManual.onclick = () => closeModal('manualRemoveModal');
  const confirmManual = document.getElementById('confirmManualRemove');
  if (confirmManual) confirmManual.onclick = handleManualRemove;

  const refreshBtn = document.getElementById('refreshInvalidBtn');
  if (refreshBtn) refreshBtn.onclick = async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '⏳ 刷新中...';
    await loadInvalid();
    refreshBtn.disabled = false;
    refreshBtn.textContent = '🔄 刷新';
    showToast('✅ 已刷新');
  };

  const exportBtn = document.getElementById('exportInvalidBtn');
  if (exportBtn) exportBtn.onclick = handleExportRemoved;

  /* 三段各自的搜索框（2026-10-05 站主要求）：只过滤自己那一段，输入停 150ms 再重画，
     页码回到第 1 页（否则搜到第 3 页的旧页码会显示成空）。 */
  ['pending', 'ignored', 'removed'].forEach(seg => {
    const input = document.getElementById('invalid' + seg.charAt(0).toUpperCase() + seg.slice(1) + 'Search');
    if (!input) return;
    const apply = debounce(() => {
      invalidSearch[seg] = input.value || '';
      if (seg === 'pending') { invalidPendingPage = 1; renderInvalidPending(); }
      else if (seg === 'ignored') { invalidIgnoredPage = 1; renderInvalidIgnored(); }
      else { invalidRemovedPage = 1; renderInvalidRemoved(); }
    }, 150);
    input.addEventListener('input', apply);
    /* ESC 一键清空（跟宝库页搜索框一个手感） */
    input.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      input.value = '';
      invalidSearch[seg] = '';
      if (seg === 'pending') { invalidPendingPage = 1; renderInvalidPending(); }
      else if (seg === 'ignored') { invalidIgnoredPage = 1; renderInvalidIgnored(); }
      else { invalidRemovedPage = 1; renderInvalidRemoved(); }
    });
  });
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

/* 2026-10-05 站主要求：歌曲管理也要能搜。
   匹配 ID / 歌名 / 分类（忽略大小写），只影响这一页的显示，不动 D1 数据；分页基于过滤后的结果。 */
let songSearch = '';

function filterSongList(list) {
  const kw = String(songSearch || '').trim().toLowerCase();
  if (!kw) return list;
  return list.filter(it => (
    String(it.id || '').toLowerCase().indexOf(kw) !== -1 ||
    String(it.name || '').toLowerCase().indexOf(kw) !== -1 ||
    String(it.category || '').toLowerCase().indexOf(kw) !== -1
  ));
}

/* 只画当前这一页（每页 100 条） */
function renderSongPage() {
  const container = document.getElementById('songList');
  const pager = document.getElementById('songPager');
  if (!container) return;

  const all = songCache;
  const list = filterSongList(all);
  const total = list.length;

  songPage = clampPage(songPage, total);

  /* 搜索框右边那句「匹配 N 条 / 共 M 条」 */
  const infoEl = document.getElementById('songSearchInfo');
  if (infoEl) {
    infoEl.textContent = String(songSearch || '').trim()
      ? '匹配 ' + total.toLocaleString('en-US') + ' 条 / 共 ' + all.length.toLocaleString('en-US') + ' 条'
      : '';
  }

  if (total === 0) {
    container.innerHTML = String(songSearch || '').trim()
      ? '<div class="empty-state">没有匹配「' + escapeHtml(songSearch.trim()) + '」的歌曲。<br>换个关键词试试，或清空搜索框。</div>'
      : '<div class="empty-state">D1 里还没有歌曲</div>';
    if (pager) pager.hidden = true;
    return;
  }

  const start = (songPage - 1) * ADMIN_PAGE_SIZE;
  const pageItems = list.slice(start, start + ADMIN_PAGE_SIZE);

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
   字段对齐 data/thanks.json。
   2026-10-05：加 scope 参数 —— 'roblox' 只导 Roblox 那一栏、'players' 只导「🙏 玩家感谢」那栏
   （两栏的导出按钮各导各的；不传就按 Roblox 那一栏，兼容老调用）。 */
async function handleExportThanks(scope) {
  const wantPlayer = scope === 'players';
  try {
    const res = await fetch('/api/thanks?t=' + Date.now(), { credentials: 'include' });
    const data = await res.json();
    if (data && data.ok === false) { showToast('导出失败：' + (data.error || '未知错误')); return; }
    if (!Array.isArray(data)) { showToast('暂无鸣谢可导出'); return; }
    const groups = data
      .filter((cat) => cat && cat.category !== SPONSOR_CATEGORY && cat.category !== SPONSOR_HIDDEN_CATEGORY)
      .filter((cat) => isPlayerThanksCategory(cat.category) === wantPlayer)
      .map((cat) => ({
        category: cat.category,
        people: (cat.people || []).map((p) => ({
          name: p.name || '',
          platform: p.platform || '',
          message: p.message || ''
        }))
      }));
    const total = groups.reduce((n, g) => n + g.people.length, 0);
    if (!total) { showToast(wantPlayer ? '暂无玩家感谢可导出' : '暂无鸣谢可导出'); return; }
    downloadJson(`thanks-${wantPlayer ? 'players-' : ''}${exportStamp()}.json`, groups);
    showToast(`📤 已导出 ${total} 条${wantPlayer ? '玩家感谢' : '鸣谢'}（格式同 data/thanks.json）`);
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
      /* 2026-10-05：导出的金额也统一两位小数（站主要求「关于金额的都弄成小数点后两位」） */
      amount: adminMoney(String(p.amount === undefined || p.amount === null || p.amount === '' ? (p.platform || '') : p.amount)),
      message: p.message || ''
    }));
    if (!list.length) { showToast('暂无赞助者可导出'); return; }
    downloadJson(`sponsors-${exportStamp()}.json`, list);
    showToast(`📤 已导出 ${list.length} 条赞助者（格式同 data/sponsors.json）`);
  } catch (err) {
    showToast('网络异常，导出失败');
  }
}

/* 2026-09-29：上面三个导出对应的按钮由文件开头的绑定区统一挂钩；
   后端 /api/songs/export 一直是好的，之前只是按钮被拿掉过（现在是四颗：歌曲 / 鸣谢 /
   赞助者 / 已下架。「已下架」那颗归「🚫 无效音乐ID管理」，见上面 handleExportRemoved）。 */

/* ============================================================
   ❤️ 鸣谢名单（后台「🎮 Roblox ID 宝库」子面板；赞助者见下面单独一节）
   ============================================================ */
/* 2026-10-01 站主要求：宝库鸣谢上面的统计改成「那 3 个类别」——
   每个类别一张卡，显示这个类别有几个人。卡片按 D1 里实际的类别动态生成，
   以后加 / 删类别会自动跟着变，不用改代码。 */
function renderThanksStats(groups, gridId) {
  const box = document.getElementById(gridId || 'thanksStatGrid');
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
       注意这两个字符串都是数据口径，别改。
       2026-10-05：再按「归属」拆成两份 —— 属于「🙏 玩家感谢」的类别进新子面板，
       剩下的留在这一栏（规则见 isPlayerThanksCategory，跟 thanks.html 一模一样）。 */
    const groups = data.filter(cat => cat && cat.category !== SPONSOR_CATEGORY && cat.category !== SPONSOR_HIDDEN_CATEGORY);
    const playerGroups = groups.filter(cat => isPlayerThanksCategory(cat.category));
    const robloxGroups = groups.filter(cat => !isPlayerThanksCategory(cat.category));

    /* 2026-10-04：把已有的类别（含管理员自建的）补进「添加鸣谢」的类别下拉，
       下次再添加同类鸣谢时直接选就行。两份都要补（下拉按栏过滤显示，见 applyThanksDropdownForPanel）。 */
    if (typeof window.syncThanksCategoryOptions === 'function') window.syncThanksCategoryOptions(groups);

    /* 统计卡：只算真的有人在那儿的类别，跟各自列表口径一致 */
    renderThanksStats(robloxGroups.filter(cat => (cat.people || []).length > 0), 'thanksStatGrid');
    renderThanksStats(playerGroups.filter(cat => (cat.people || []).length > 0), 'playerThanksStatGrid');

    /* 平铺成「一行一个人」，好按 100 人一页翻（类别名跟着每个人走） */
    thanksCache = [];
    robloxGroups.forEach(cat => {
      (cat.people || []).forEach(person => thanksCache.push({ category: cat.category, person }));
    });
    renderThanksPage();

    playerThanksCache = [];
    playerGroups.forEach(cat => {
      (cat.people || []).forEach(person => playerThanksCache.push({ category: cat.category, person }));
    });
    renderPlayerThanksPage();
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
    const pager = document.getElementById('thanksPager');
    if (pager) pager.hidden = true;
    const pager2 = document.getElementById('playersPager');
    if (pager2) pager2.hidden = true;
  }
}

/* 鸣谢名单：每页 100 人（2026-10-01 站主要求，跟宝库页一样） */
let thanksCache = [];
let thanksPage = 1;
/* 🙏 玩家感谢那一栏的缓存与页码（2026-10-05 新增；跟上面那两份完全分开） */
let playerThanksCache = [];
let playerThanksPage = 1;

/* 两栏共用这一套画法：容器 / 分页器 / 每页 100 人 / 类别标题 / 编辑删除按钮。
   list：该栏的数据；pageKey：'thanks' | 'players'（决定用哪套缓存与页码变量）。 */
function renderThanksListOf(containerId, pagerId, cache, page, onPageChange) {
  const container = document.getElementById(containerId);
  const pager = document.getElementById(pagerId);
  if (!container) return;

  const total = cache.length;

  if (total === 0) {
    container.innerHTML = '<div class="empty-state">暂无鸣谢</div>';
    if (pager) pager.hidden = true;
    return;
  }

  const start = (page - 1) * ADMIN_PAGE_SIZE;
  const pageItems = cache.slice(start, start + ADMIN_PAGE_SIZE);

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

  renderAdminPager(pager, total, page, '人', (p) => {
    onPageChange(p);
    scrollListIntoView(container);
  });
}

/* 🎮 Roblox ID 宝库那一栏 */
function renderThanksPage() {
  thanksCache = thanksCache || [];
  thanksPage = clampPage(thanksPage, thanksCache.length);
  renderThanksListOf('thanksList', 'thanksPager', thanksCache, thanksPage, (p) => {
    thanksPage = p;
    renderThanksPage();
  });
}

/* 🙏 玩家感谢那一栏（2026-10-05 新增） */
function renderPlayerThanksPage() {
  playerThanksCache = playerThanksCache || [];
  playerThanksPage = clampPage(playerThanksPage, playerThanksCache.length);
  renderThanksListOf('playersList', 'playersPager', playerThanksCache, playerThanksPage, (p) => {
    playerThanksPage = p;
    renderPlayerThanksPage();
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

  /* 2026-10-05：这一条属于哪一栏（决定下拉里列哪些类别、保存时要不要补 🙏 前缀）。
     从「🙏 玩家感谢」栏点编辑 → scope = players；从 Roblox 栏点 → roblox。 */
  addThanksScope = isPlayerThanksCategory(category) ? 'players' : 'roblox';
  if (typeof window.applyThanksDropdownForPanel === 'function') window.applyThanksDropdownForPanel();

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

  /* 2026-10-05：编辑时「网站创新家」照样把「描述由我手写」勾上
     （编辑本来就不会代写，勾上只是让站主一眼看清这一类是手写栏） */
  const manualBox = document.getElementById('addThanksManualNote');
  if (manualBox) {
    manualBox.checked = category === MANUAL_NOTE_CATEGORY;
    manualNoteAuto = false;
  }

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
  /* 「✍️ 描述由我手写」也回到未勾选（下一次选到网站创新家会自动再勾上） */
  const manualBox = document.getElementById('addThanksManualNote');
  if (manualBox) manualBox.checked = false;
  manualNoteAuto = false;
  const titleEl = document.querySelector('#addThanksModal h2');
  if (titleEl) titleEl.textContent = '➕ 添加鸣谢';
  const okBtn = document.getElementById('confirmAddThanks');
  if (okBtn) okBtn.textContent = '✅ 确认添加';
}

/* 添加 / 保存鸣谢 */
async function handleAddThanks() {
  /* 2026-10-04：类别可能是自定义的，统一从 currentThanksCategory() 取 */
  let category = currentThanksCategory();
  const name = document.getElementById('addThanksName').value.trim();
  const platform = document.getElementById('addThanksPlatform').value.trim();
  const messageEl = document.getElementById('addThanksMessage');

  /* 2026-10-05：勾了「✍️ 描述由我手写」（或类别就是网站创新家）时，
     站主写的东西原样送走 —— 不 trim 内容本身、更不代写；
     只有「整框都是空白」才当成没写（免得往鸣谢页塞一行空白）。 */
  const manualNote = isManualThanksNote();
  let message = manualNote
    ? (messageEl.value.trim() ? messageEl.value : '')
    : messageEl.value.trim();

  if (!category) {
    showToast('请选择类别（选「✏️ 自定义类别…」的话要把名字填上）');
    const opt = document.querySelector('#addThanksSelectDropdown .select-option.active');
    if (opt && opt.dataset.value === '__custom__') {
      const input = document.getElementById('addThanksCustomCat');
      if (input) input.focus();
    }
    return;
  }
  /* 2026-10-05：从「🙏 玩家感谢」那一栏新增/编辑时，自己起的类别名会自动补上「🙏 」前缀 ——
     带这个前缀（或名字里含「玩家感谢」/「网站创新家」）的类别才会出现在鸣谢页的
     「玩家感谢」栏里（归属规则见 isPlayerThanksCategory）。已经符合规则的就不再重复加。 */
  if (addThanksScope === 'players' && !isPlayerThanksCategory(category)) {
    category = PLAYER_THANKS_PREFIX + category;
  }
  /* 长度上限跟服务端一致（30 字），补前缀之后再算 */
  if (category.length > 30) { showToast('类别最多 30 个字（玩家感谢那一栏会自动加「🙏 」前缀，也算在内）'); return; }
  if (!name) { showToast('请填写名字'); return; }
  /* 描述上限跟服务端 functions/api/thanks.js 对齐（200 字） */
  if (message.length > 200) { showToast('描述最多 200 个字'); return; }

  const editingId = editingThanksId;

  /* 描述留空 → 自己写一句（2026-09-29 用户要求；填进去再发，返回列表就能看到）。
     编辑时留空就留空，那是管理员自己的选择；
     手写模式（含网站创新家）一个字都不代写 —— 这是 2026-10-05 站主的硬要求。 */
  let autoWrote = false;
  if (!message && !editingId && !manualNote) {
    message = buildSmartThanksNote(category, name, platform);
    if (message) {
      messageEl.value = message;
      autoWrote = true;
    }
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

/* 金额一律两位小数（2026-10-05 站主要求「把关于金额的相关内容弄到小数点后两位」）：
   列表显示 / 保存入库 / 导出三处都走 common.js 的 normalizeMoneyText ——
   认得出是金额就归一成「¥10.00」（'10'、'¥10'、'10元'、'10.5'、'1,000' 都认）；
   认不出（比如备注写成「一杯奶茶」）就**原样保留**，绝不硬改成 ¥0.00 把原话吃掉。
   common.js 没加载时退回原值，不影响后台其它功能。 */
function adminMoney(text) {
  const raw = String(text === undefined || text === null ? '' : text);
  if (!raw.trim()) return raw;
  if (typeof normalizeMoneyText === 'function') return normalizeMoneyText(raw);
  return raw;
}

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
        ${person.platform ? '<span class="type-tag gold">' + escapeHtml(adminMoney(person.platform)) + '</span>' : ''}
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
  /* 金额统一显示成两位小数（2026-10-05），改不改都行 */
  document.getElementById('addSponsorAmount').value = adminMoney(person.platform || '');
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
  /* 2026-10-05：金额统一归一成两位小数再存（'10' → '¥10.00'），
     并把归一后的值回填到输入框里，让管理员一眼看到最终会存成什么。 */
  const amount = adminMoney(amountEl.value);
  if (amount && amount !== amountEl.value.trim()) amountEl.value = amount;
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