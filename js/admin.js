/* ============================================================
   织雾满穗 · 后台管理
   反馈管理、卡片管理（歌曲 / 隔离区 / 社区）、
   📦 合并工具（四个 iframe 工具页，里面分了二级 / 三级）、
   鸣谢名单（👑 赞助者 + 🎮 Roblox ID 宝库）、数据统计
   ============================================================ */

/* 缓存反馈列表，用于展开查看隔离区时定位 */
let feedbackCache = [];

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
         所以「📦 合并工具」（panel-merge）切过来时先加载的是默认那个
         「🎵 音乐 ID」（merge-songs），另外三个 —— ⛔ 开发者隔离区 /
         👑 赞助者 / 🎮 Roblox ID 宝库 —— 等你切到对应的二级 → 三级标签时才加载。 */
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
  // 注：更新管理走 iframe（tools/update-notice.html），不需要在这里加载

  /* 导入隔离区弹窗 */
  document.getElementById('openImportQuarantineBtn').onclick = () => {
    document.getElementById('importQuarantineText').value = '';
    document.getElementById('importQuarantineStatus').textContent = '';
    document.getElementById('importQuarantineStatus').className = 'import-status';
    openModal('importQuarantineModal');
  };
  document.getElementById('cancelImportQuarantine').onclick = () => closeModal('importQuarantineModal');
  document.getElementById('confirmImportQuarantine').onclick = handleImportQuarantine;

  /* 歌曲管理按钮 */
  document.getElementById('addSongBtn').onclick = handleAddSong;
  document.getElementById('exportSongsBtn').onclick = handleExportSongs;
  document.getElementById('clearSongsBtn').onclick = handleClearSongs;

  /* 👑 赞助者：添加 / 保存、取消编辑、刷新 */
  document.getElementById('addSponsorBtn').onclick = handleAddSponsor;
  document.getElementById('cancelSponsorEditBtn').onclick = resetSponsorForm;
  document.getElementById('refreshSponsorsBtn').onclick = loadSponsors;

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
    document.getElementById('addThanksSelectedCat').textContent = opt.textContent;
    addThanksTrigger.classList.add('selected');
    setAddThanksOpen(false);
    addThanksTrigger.focus();
  }

  document.getElementById('openAddThanksBtn').onclick = () => {
    document.getElementById('addThanksSelectedCat').textContent = '请选择类别';
    addThanksTrigger.classList.remove('selected');
    addThanksDropdown.querySelectorAll('.select-option').forEach(o => {
      o.classList.remove('active');
      o.setAttribute('aria-selected', 'false');
    });
    setAddThanksOpen(false);
    document.getElementById('addThanksName').value = '';
    document.getElementById('addThanksPlatform').value = '';
    document.getElementById('addThanksMessage').value = '';
    openModal('addThanksModal');
  };
  document.getElementById('cancelAddThanks').onclick = () => closeModal('addThanksModal');
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
})();

/* ============================================================
   反馈管理
   ============================================================ */
async function loadFeedback() {
  const container = document.getElementById('feedbackList');
  const countEl = document.getElementById('feedbackCount');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/feedback/list', { credentials: 'include' });
    if (!res.ok) {
      container.innerHTML = '<div class="empty-state">加载失败（HTTP ' + res.status + '）· 登录可能已过期，请重新登录</div>';
      countEl.textContent = '-';
      return;
    }
    const data = await res.json();
    if (data && data.ok === false) {
      container.innerHTML = '<div class="empty-state">加载失败：' + escapeHtml(data.error || '未知错误') + '</div>';
      countEl.textContent = '-';
      return;
    }

    /* 后端返回 { ok:true, data:[...], total }；同时兼容早期的裸数组格式 */
    const list = Array.isArray(data)
      ? data
      : (data && Array.isArray(data.data) ? data.data : null);

    if (list === null) {
      container.innerHTML = '<div class="empty-state">暂无反馈</div>';
      countEl.textContent = '0';
      return;
    }

    feedbackCache = list;
    countEl.textContent = (data && typeof data.total === 'number') ? data.total : list.length;

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
          <span class="name">${escapeHtml(item.name)}</span>
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

/* 将反馈用户加入鸣谢 */
async function approveToThanks(feedbackId) {
  const confirmed = await showConfirm(
    '加入鸣谢',
    '确认将该反馈用户加入鸣谢名单？\n\n加入后可在后台「❤️ 鸣谢名单」→「🎮 Roblox ID 宝库」里编辑类别和描述。'
  );
  if (!confirmed) return;

  try {
    const item = feedbackCache.find(i => i.id === feedbackId);
    if (!item) { showToast('未找到反馈'); return; }

    const addRes = await fetch('/api/thanks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add',
        category: '💬 反馈贡献者',
        name: item.name,
        platform: '',
        message: '反馈了「' + item.type + '」相关问题',
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
   Roblox 数据（统计 + 开发者隔离区）
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
    document.getElementById('statTotal').textContent = extraOk ? seenIds.size : '-';
    document.getElementById('statGroup').textContent = extraOk ? seenNames.size : '-';

    const res2 = await fetch('/api/quarantine/list?t=' + Date.now());
    const container = document.getElementById('quarantineList');
    const countEl = document.getElementById('quarantineCount');
    if (!res2.ok) {
      container.innerHTML = '<div class="empty-state">加载失败（HTTP ' + res2.status + '）· 登录可能已过期，请重新登录</div>';
      countEl.textContent = '-';
      document.getElementById('statQuarantine').textContent = '-';
      return;
    }
    const qData = await res2.json();
    if (qData && qData.ok === false) {
      container.innerHTML = '<div class="empty-state">加载失败：' + escapeHtml(qData.error || '未知错误') + '</div>';
      countEl.textContent = '-';
      document.getElementById('statQuarantine').textContent = '-';
      return;
    }

    let quarantine = [];
    if (qData.ok && Array.isArray(qData.data)) {
      quarantine = qData.data;
    }

    document.getElementById('statQuarantine').textContent = quarantine.length;
    countEl.textContent = quarantine.length;

    if (quarantine.length === 0) {
      container.innerHTML = '<div class="empty-state">隔离区是空的</div>';
      return;
    }

    container.innerHTML = '';
    quarantine.forEach(item => {
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
  } catch (err) {
    document.getElementById('quarantineList').innerHTML = '<div class="empty-state">加载失败</div>';
  }
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

/* 批量导入隔离区（JSON 数组格式） */
async function handleImportQuarantine() {
  const text = document.getElementById('importQuarantineText').value.trim();
  const status = document.getElementById('importQuarantineStatus');
  status.className = 'import-status';
  status.textContent = '';

  if (!text) {
    status.classList.add('err');
    status.textContent = '⚠️ 请粘贴 JSON 数据';
    return;
  }

  let items;
  try {
    items = JSON.parse(text);
  } catch (e) {
    status.classList.add('err');
    status.textContent = '⚠️ JSON 格式错误：' + e.message;
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
   ============================================================ */
async function loadSongs() {
  const container = document.getElementById('songList');
  const countEl = document.getElementById('songCount');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/songs/list?t=' + Date.now());
    if (!res.ok) {
      container.innerHTML = '<div class="empty-state">加载失败（HTTP ' + res.status + '）· 登录可能已过期，请重新登录</div>';
      countEl.textContent = '-';
      return;
    }
    const data = await res.json();
    if (data && data.ok === false) {
      container.innerHTML = '<div class="empty-state">加载失败：' + escapeHtml(data.error || '未知错误') + '</div>';
      countEl.textContent = '-';
      return;
    }

    let list = [];
    if (data.ok && Array.isArray(data.data)) {
      list = data.data;
    }
    countEl.textContent = list.length;

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">D1 里还没有歌曲</div>';
      return;
    }

    container.innerHTML = '';
    list.forEach(item => {
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
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

/* 单曲添加 */
async function handleAddSong() {
  const idInput = document.getElementById('addSongId');
  const nameInput = document.getElementById('addSongName');
  const catInput = document.getElementById('addSongCat');

  const musicId = idInput.value.trim();
  const name = nameInput.value.trim();
  const category = catInput.value.trim() || '未分类';

  if (!musicId) { showToast('请填写歌曲 ID'); return; }
  if (!name) { showToast('请填写歌曲名称'); return; }
  if (!/^\d+$/.test(musicId)) { showToast('ID 必须是纯数字'); return; }

  const data = await addSongToServer({ musicId, name, category });

  if (data && data.ok) {
    showToast('✅ 已添加');
    idInput.value = '';
    nameInput.value = '';
    catInput.value = '';
    loadSongs();
    loadRobloxStats();
  } else {
    showToast('添加失败：' + ((data && (data.message || data.error)) || '未知'));
  }
}

/* 调后端 /api/songs/add（单曲、批量导入都用它） */
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

/* 导出 D1 歌曲 */
async function handleExportSongs() {
  try {
    const res = await fetch('/api/songs/export', { credentials: 'include' });
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.data)) {
      showToast('导出失败');
      return;
    }
    if (data.data.length === 0) {
      showToast('D1 里没有歌曲可导出');
      return;
    }

    const confirmed = await showConfirm(
      '导出歌曲',
      `即将导出 ${data.data.length} 条歌曲。\n\n导出后，用 tools/json-merge.html 工具合并到 roblox_music.json 中。\n\n是否下载？`
    );
    if (!confirmed) return;

    const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'songs_extra_' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast('📤 已下载');
  } catch (err) {
    showToast('网络异常');
  }
}

/* ============================================================
   ❤️ 鸣谢名单（后台「🎮 Roblox ID 宝库」子面板；赞助者见下面单独一节）
   ============================================================ */
async function loadThanks() {
  const container = document.getElementById('thanksList');
  const countEl = document.getElementById('thanksCount');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/thanks?t=' + Date.now());
    if (!res.ok) {
      container.innerHTML = '<div class="empty-state">加载失败（HTTP ' + res.status + '）· 登录可能已过期，请重新登录</div>';
      countEl.textContent = '-';
      return;
    }
    const data = await res.json();
    if (data && data.ok === false) {
      container.innerHTML = '<div class="empty-state">加载失败：' + escapeHtml(data.error || '未知错误') + '</div>';
      countEl.textContent = '-';
      return;
    }

    if (!Array.isArray(data)) {
      container.innerHTML = '<div class="empty-state">暂无鸣谢</div>';
      countEl.textContent = '0';
      return;
    }

    let total = 0;
    data.forEach(cat => { total += (cat.people || []).length; });
    countEl.textContent = total;

    if (total === 0) {
      container.innerHTML = '<div class="empty-state">暂无鸣谢</div>';
      return;
    }

    container.innerHTML = '';
    data.forEach(cat => {
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:700;color:var(--gold);margin:16px 0 8px;font-size:1rem;';
      title.textContent = cat.category;
      container.appendChild(title);

      (cat.people || []).forEach(person => {
        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `
          <div class="row1">
            <span class="name">${escapeHtml(person.name)}</span>
            ${person.platform ? '<span class="type-tag gold">' + escapeHtml(person.platform) + '</span>' : ''}
          </div>
          ${person.message ? '<div class="message">' + escapeHtml(person.message) + '</div>' : ''}
          <div class="actions">
            <button class="btn-delete" data-id="${escapeHtml(person.id)}">🗑️ 删除</button>
          </div>
        `;
        container.appendChild(el);
      });
    });

    container.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteThanks(Number(btn.dataset.id)));
    });
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

/* 添加鸣谢 */
async function handleAddThanks() {
  const selectedCatEl = document.getElementById('addThanksSelectedCat');
  const category = (selectedCatEl.textContent || '').trim();
  const name = document.getElementById('addThanksName').value.trim();
  const platform = document.getElementById('addThanksPlatform').value.trim();
  const message = document.getElementById('addThanksMessage').value.trim();

  if (!category || category === '请选择类别') { showToast('请选择类别'); return; }
  if (!name) { showToast('请填写名字'); return; }

  try {
    const res = await fetch('/api/thanks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add',
        category,
        name,
        platform,
        message
      })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✅ 已添加');
      closeModal('addThanksModal');
      loadThanks();
    } else {
      showToast('添加失败：' + (data.error || '未知错误'));
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
   约定（本轮定的，前端 thanks.html 也按同一套读，别自行改名）：
   · 类别固定写死 '👑 赞助者'；
   · 「金额」存 platform 字段（例如 '¥10'），「感谢语」存 message 字段；
   · 两处来源：随仓库发布的底档 data/sponsors.json（这里只读，要改就改文件后重新部署），
     以及 D1 的 thanks 表里 category='👑 赞助者' 的行（这个面板负责增 / 删 / 改）。
   ============================================================ */
const SPONSOR_CATEGORY = '👑 赞助者';

/* D1 那部分（可管理）的缓存：编辑时按 id 取回原值 */
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
  const countEl = document.getElementById('sponsorCount');
  if (!container) return;
  container.innerHTML = '<div class="loading">加载中...</div>';

  /* ① 底档（静态文件，只读） */
  const baseline = await fetchSponsorBaseline();

  /* ② D1 里 category === '👑 赞助者' 的行（可增删改） */
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
    d1Error = '网络异常，D1 那部分没加载出来';
  }

  sponsorCache = d1People;

  /* 计数 = 底档 + D1 两段之和 */
  const total = baseline.length + d1People.length;
  if (countEl) countEl.textContent = total;

  container.innerHTML = '';

  if (total === 0 && !d1Error) {
    container.innerHTML = '<div class="empty-state">暂无赞助者</div>';
    return;
  }

  /* ---- 底档行：只读，标一句「改文件」 ---- */
  if (baseline.length) {
    const head = document.createElement('div');
    head.className = 'sponsor-group-title';
    head.textContent = '📄 底档 · data/sponsors.json（只读，改文件 + 重新部署才会变）';
    container.appendChild(head);

    baseline.forEach(item => {
      const p = item || {};
      const amount = (p.amount === undefined || p.amount === null || p.amount === '')
        ? String(p.platform || '')
        : String(p.amount);
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `
        <div class="row1">
          <span class="name">${escapeHtml(p.name || '匿名')}</span>
          ${amount ? '<span class="type-tag gold">' + escapeHtml(amount) + '</span>' : ''}
        </div>
        ${p.title ? '<div class="meta">' + escapeHtml(p.title) + '</div>' : ''}
        ${p.message ? '<div class="message">' + escapeHtml(p.message) + '</div>' : ''}
        <div class="meta" style="margin:0;">📄 底档 · 改 data/sponsors.json</div>
      `;
      container.appendChild(el);
    });
  }

  /* ---- D1 行：可编辑、可删除 ---- */
  if (d1People.length) {
    const head = document.createElement('div');
    head.className = 'sponsor-group-title';
    head.textContent = '☁️ 后台添加 · 存在 D1（category = 👑 赞助者）';
    container.appendChild(head);

    d1People.forEach(person => {
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
  }

  /* D1 拉挂了也要说清楚，但不挡住底档已经渲染出来的部分 */
  if (d1Error) {
    const warn = document.createElement('div');
    warn.className = 'empty-state';
    warn.textContent = '⚠️ D1 那部分没加载出来：' + d1Error;
    container.appendChild(warn);
  }
}

/* 编辑：把这一行的值填回上面的表单（值一律用 .value 赋值，不拼 HTML） */
function startEditSponsor(id) {
  const person = sponsorCache.find(p => Number(p.id) === Number(id));
  if (!person) { showToast('未找到这条记录，刷新后再试'); return; }

  editingSponsorId = Number(id);
  document.getElementById('addSponsorName').value = person.name || '';
  document.getElementById('addSponsorAmount').value = person.platform || '';
  document.getElementById('addSponsorMessage').value = person.message || '';

  const okBtn = document.getElementById('addSponsorBtn');
  if (okBtn) okBtn.textContent = '💾 保存修改';
  const cancelBtn = document.getElementById('cancelSponsorEditBtn');
  if (cancelBtn) cancelBtn.style.display = '';

  const form = document.querySelector('.sponsor-add-form');
  if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('✏️ 正在编辑「' + (person.name || '') + '」，改完点「💾 保存修改」');
}

/* 清空表单 + 退出编辑模式（「取消编辑」按钮和提交成功后都走这里） */
function resetSponsorForm() {
  editingSponsorId = 0;
  ['addSponsorName', 'addSponsorAmount', 'addSponsorMessage'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const okBtn = document.getElementById('addSponsorBtn');
  if (okBtn) { okBtn.textContent = '➕ 添加'; okBtn.disabled = false; }
  const cancelBtn = document.getElementById('cancelSponsorEditBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

/* 添加 / 保存赞助者
   ⚠️ 约定：金额写进 platform 字段、感谢语写进 message 字段，类别固定 '👑 赞助者'
   —— 这是本轮定下来的，别改成别的字段名，thanks.html 前端按同一套读。 */
async function handleAddSponsor() {
  const nameEl = document.getElementById('addSponsorName');
  const amountEl = document.getElementById('addSponsorAmount');
  const messageEl = document.getElementById('addSponsorMessage');
  const name = nameEl.value.trim();
  const amount = amountEl.value.trim();
  const message = messageEl.value.trim();

  /* 长度上限跟服务端 functions/api/thanks.js 对齐（name 40 / platform 30 / message 200） */
  if (!name) { showToast('请填写名字'); nameEl.focus(); return; }
  if (name.length > 40) { showToast('名字最多 40 个字'); return; }
  if (amount.length > 30) { showToast('金额最多 30 个字'); return; }
  if (message.length > 200) { showToast('感谢语最多 200 个字'); return; }

  const editingId = editingSponsorId;
  const btn = document.getElementById('addSponsorBtn');
  if (btn) btn.disabled = true;

  try {
    /* 底档那份是静态文件，这里动不了；能改的只有 D1 里的行 */
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
      showToast(editingId ? '✅ 已保存修改' : '✅ 已添加赞助者');
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

/* 删除 D1 里的那一条（底档删不了，要改 data/sponsors.json） */
async function deleteSponsor(id) {
  if (!id || isNaN(Number(id))) {
    showToast('⚠️ ID 无效，无法删除');
    return;
  }

  const confirmed = await showConfirm(
    '删除赞助者',
    '确定要删除这位赞助者吗？\n\n只能删后台添加的（D1）；底档那部分要改 data/sponsors.json。'
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/thanks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: Number(id) })
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }

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
   ============================================================ */

let statsLoading = false;

async function loadStatsPanel() {
  if (statsLoading) return;
  statsLoading = true;
  try {
    await Promise.all([loadHotRank(), loadSourceStats()]);
  } finally {
    statsLoading = false;
  }
}

/* 热门榜：/api/hot/list 已经返回 copy / play / fav 分项 + total */
async function loadHotRank() {
  const box = document.getElementById('hotRankList');
  if (!box) return;

  box.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/hot/list?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) {
      box.innerHTML = '<div class="empty-state">加载失败（HTTP ' + res.status + '）</div>';
      return;
    }
    const data = await res.json();
    if (!data || data.ok !== true || !Array.isArray(data.data)) {
      box.innerHTML = '<div class="empty-state">加载失败：' + escapeHtml((data && data.error) || '未知错误') + '</div>';
      return;
    }

    const list = data.data;

    /* 概览卡片 */
    const totalInteractions = list.reduce((sum, x) => sum + (Number(x.total) || 0), 0);
    const elHotCount = document.getElementById('statHotCount');
    const elHotTotal = document.getElementById('statHotTotal');
    if (elHotCount) elHotCount.textContent = list.length.toLocaleString('en-US');
    if (elHotTotal) elHotTotal.textContent = totalInteractions.toLocaleString('en-US');

    if (list.length === 0) {
      box.innerHTML = '<div class="empty-state">还没有热门数据。<br>访客复制 / 试听 / 收藏 ID 之后，这里就会开始累积。</div>';
      return;
    }

    box.innerHTML = '';
    const frag = document.createDocumentFragment();

    list.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'rank-item' + (idx < 3 ? ' top' + (idx + 1) : '');

      const no = document.createElement('span');
      no.className = 'rank-no';
      no.textContent = String(idx + 1);

      const id = document.createElement('span');
      id.className = 'rank-id';
      id.textContent = item.id;

      const counts = document.createElement('span');
      counts.className = 'rank-counts';
      counts.append(
        document.createTextNode('📋 '), strong(String(item.copy || 0)),
        document.createTextNode(' · 🔗 '), strong(String(item.play || 0)),
        document.createTextNode(' · ⭐ '), strong(String(item.fav || 0))
      );

      const total = document.createElement('span');
      total.className = 'rank-total';
      total.textContent = String(item.total || 0);

      /* 删除这一条热度（例如被刷了、或这首歌已经不收录了） */
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'rank-del';
      del.textContent = '✕';
      del.title = '清空这条热度';
      del.setAttribute('aria-label', '清空 ID ' + item.id + ' 的热度');
      del.dataset.id = item.id;
      del.addEventListener('click', () => deleteHotRecord(item.id));

      row.append(no, id, counts, total, del);
      frag.appendChild(row);
    });

    box.appendChild(frag);
  } catch (err) {
    console.error('[stats] hot/list', err);
    box.innerHTML = '<div class="empty-state">加载失败，请检查网络</div>';
  }
}

/* 清空某条热度 */
async function deleteHotRecord(id) {
  const ok = await showConfirm(
    '清空热度',
    '确定要清空 ID ' + id + ' 的热度记录吗？\n\n' +
    '清空后它的「复制 / 试听 / 收藏」计数都会归零，' +
    '宝库页的热门榜里也会消失。这个操作不能撤销。'
  );
  if (!ok) return;

  try {
    const res = await fetch('/api/hot/delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: String(id) })
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data && data.ok) {
      showToast('🗑️ 已清空该条热度');
      loadHotRank();
    } else {
      showToast('清空失败：' + ((data && data.error) || ('HTTP ' + res.status)));
    }
  } catch (err) {
    console.error('[stats] hot/delete', err);
    showToast('网络异常，请稍后重试');
  }
}

function strong(text) {
  const b = document.createElement('b');
  b.textContent = text;
  return b;
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

/* ============================================================
   博客管理（卡片2 · 玩家交流）
   ------------------------------------------------------------
   玩家发的帖子都在这里。处置手段分四种：
     隐藏 / 恢复  —— 单条上下线
     误报复位     —— 被误举报时清空举报数并恢复显示
     拉黑作者     —— 按「浏览器身份」拉黑：他名下帖子全部下线且不能再发
     删除         —— 连同它的回复一起永久删除
   ============================================================ */
let blogCache = [];

function blogStatusTag(item) {
  if (item.status !== 'visible') return '<span class="type-tag red" style="margin-left:6px;">🙈 已隐藏</span>';
  if (item.reports >= 3) return '<span class="type-tag gold" style="margin-left:6px;">⚠️ 举报较多</span>';
  return '<span class="type-tag green" style="margin-left:6px;">👁️ 显示中</span>';
}

async function loadBlogPanel() {
  const box = document.getElementById('blogList');
  const banBox = document.getElementById('blogBanList');
  if (!box) return;

  box.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch('/api/blog/admin-list', { credentials: 'include' });
    const data = await res.json();

    if (!data || !data.ok) {
      box.innerHTML = '<div class="empty-state">加载失败（HTTP ' + res.status + '）· 登录可能已过期，或数据库还没跑迁移</div>';
      return;
    }

    const list = Array.isArray(data.data) ? data.data : [];
    blogCache = list;
    document.getElementById('blogCount').textContent = list.length;

    renderBlogBans(
      Array.isArray(data.bans) ? data.bans : [],
      Array.isArray(data.bannedUsers) ? data.bannedUsers : [],
      Number(data.userCount) || 0
    );

    if (list.length === 0) {
      box.innerHTML = '<div class="empty-state">还没有人发帖</div>';
      return;
    }

    box.innerHTML = '';
    list.forEach(item => {
      const el = document.createElement('div');
      el.className = 'list-item';

      const hidden = item.status !== 'visible';
      const title = item.title ? escapeHtml(item.title) : '<span style="color:var(--text-muted)">（无标题）</span>';
      const tags = item.tags ? escapeHtml(item.tags) : '';

      el.innerHTML = `
        <div class="row1">
          <span class="name">${item.pinned ? '📌 ' : ''}${title}</span>
          <span>
            <span class="type-tag">👤 ${escapeHtml(item.name)}</span>
            ${blogStatusTag(item)}
          </span>
        </div>
        <div class="meta">
          🕒 ${escapeHtml(item.createdAt)}
          · 👁 ${item.views} · 👍 ${item.likes} · 💬 ${item.replies} · ⚠️ ${item.reports}
          ${item.userId ? ' · 🆔 账号 #' + item.userId : ''}
          ${tags ? ' · 🏷 ' + tags : ''}
        </div>
        <div class="message">${escapeHtml(item.content)}</div>
        <div class="actions">
          ${item.pinned
            ? '<button class="btn-unpin" data-id="' + item.id + '">📌 取消置顶</button>'
            : '<button class="btn-pin" data-id="' + item.id + '">📌 置顶</button>'}
          ${hidden
            ? '<button class="btn-show" data-id="' + item.id + '">👁️ 恢复显示</button>'
            : '<button class="btn-hide" data-id="' + item.id + '">🙈 隐藏</button>'}
          <button class="btn-unreport" data-id="${item.id}">🔁 误报复位</button>
          <button class="btn-ban" data-id="${item.id}">🚫 拉黑作者</button>
          <button class="btn-delete" data-id="${item.id}">🗑️ 删除</button>
        </div>
      `;
      box.appendChild(el);
    });

    box.querySelectorAll('.btn-pin').forEach(b => b.addEventListener('click', () => moderateBlog(Number(b.dataset.id), 'pin')));
    box.querySelectorAll('.btn-unpin').forEach(b => b.addEventListener('click', () => moderateBlog(Number(b.dataset.id), 'unpin')));
    box.querySelectorAll('.btn-hide').forEach(b => b.addEventListener('click', () => moderateBlog(Number(b.dataset.id), 'hide')));
    box.querySelectorAll('.btn-show').forEach(b => b.addEventListener('click', () => moderateBlog(Number(b.dataset.id), 'show')));
    box.querySelectorAll('.btn-unreport').forEach(b => b.addEventListener('click', () => moderateBlog(Number(b.dataset.id), 'resetReports')));
    box.querySelectorAll('.btn-ban').forEach(b => b.addEventListener('click', () => moderateBlog(Number(b.dataset.id), 'ban')));
    box.querySelectorAll('.btn-delete').forEach(b => b.addEventListener('click', () => moderateBlog(Number(b.dataset.id), 'delete')));
  } catch (err) {
    box.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

function renderBlogBans(bans, bannedUsers, userCount) {
  bans = Array.isArray(bans) ? bans : [];
  bannedUsers = Array.isArray(bannedUsers) ? bannedUsers : [];
  const box = document.getElementById('blogBanList');
  if (!box) return;

  const hasBans = bans.length > 0;
  const hasUsers = bannedUsers.length > 0;

  if (!hasBans && !hasUsers) {
    box.innerHTML = '<div class="empty-state">暂无限制记录</div>';
    return;
  }

  box.innerHTML = '';

  /* 被封的账号（登录用户） */
  bannedUsers.forEach(u => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div class="row1">
        <span class="name">👤 ${escapeHtml(u.username)}</span>
        <span><span class="type-tag red">🚫 账号已封禁</span></span>
      </div>
      <div class="meta">🕒 ${escapeHtml(u.createdAt)} · 🆔 账号 #${u.id}</div>
      <div class="actions">
        <button class="btn-unban-user" data-user="${u.id}">✅ 解封账号</button>
      </div>
    `;
    box.appendChild(el);
  });

  /* 被拉黑的浏览器身份（游客） */
  bans.forEach(b => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div class="row1">
        <span class="name">🔑 ${escapeHtml(String(b.clientId).slice(0, 10))}…</span>
        <span><span class="type-tag red">🚫 浏览器已限制</span></span>
      </div>
      <div class="meta">🕒 ${escapeHtml(b.createdAt)}${b.reason ? ' · 原因：' + escapeHtml(b.reason) : ''}</div>
      <div class="actions">
        <button class="btn-unban" data-client="${escapeHtml(b.clientId)}">✅ 解除限制</button>
      </div>
    `;
    box.appendChild(el);
  });

  box.querySelectorAll('.btn-unban-user').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm('解封账号', '解封后这个账号可以重新登录发帖，之前被隐藏的内容仍需要你手动恢复显示。确定吗？');
      if (!ok) return;
      btn.disabled = true;
      try {
        const res = await fetch('/api/blog/moderate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'unbanUser', userId: Number(btn.dataset.user) })
        });
        const data = await res.json();
        if (data && data.ok) { showToast('✅ 已解封'); loadBlogPanel(); }
        else { btn.disabled = false; showToast('操作失败'); }
      } catch (e) {
        btn.disabled = false;
        showToast('网络异常');
      }
    });
  });

  box.querySelectorAll('.btn-unban').forEach(btn => {
    btn.addEventListener('click', async () => {
      const clientId = btn.dataset.client;
      const ok = await showConfirm('解除限制', '解除后这个人可以重新发帖，之前被隐藏的帖子仍需要你手动恢复显示。确定吗？');
      if (!ok) return;

      btn.disabled = true;
      try {
        const res = await fetch('/api/blog/moderate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'unban', clientId: clientId })
        });
        const data = await res.json();
        if (data && data.ok) { showToast('✅ 已解除限制'); loadBlogPanel(); }
        else { btn.disabled = false; showToast('操作失败'); }
      } catch (e) {
        btn.disabled = false;
        showToast('网络异常');
      }
    });
  });
}

async function moderateBlog(id, action) {
  const item = blogCache.find(i => Number(i.id) === id);

  const CONFIRM = {
    hide: '隐藏这篇文章？玩家端立刻看不到，但数据保留，随时可以恢复。',
    delete: '永久删除这篇文章？它下面的评论、点赞、举报记录都会一起消失，无法恢复。',
    ban: '拉黑作者？他的账号会被封禁、浏览器身份也会被拉黑，名下所有内容一起下线，之后再也发不了。',
    resetReports: '把举报数清零并恢复显示？用在确认是误报的时候。'
  };

  if (CONFIRM[action]) {
    const ok = await showConfirm('确认操作', CONFIRM[action]);
    if (!ok) return;
  }

  const payload = { action: action, id: id };
  if (action === 'ban' && item) payload.reason = '管理员在博客管理中限制发言';

  try {
    const res = await fetch('/api/blog/moderate', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data && data.ok) {
      if (action === 'delete') showToast('🗑️ 已删除');
      else if (action === 'hide') showToast('🙈 已隐藏');
      else if (action === 'show') showToast('👁️ 已恢复显示');
      else if (action === 'pin') showToast('📌 已置顶');
      else if (action === 'unpin') showToast('📌 已取消置顶');
      else if (action === 'ban') showToast('🚫 已拉黑作者，下线了 ' + (data.hidden || 0) + ' 条内容');
      else showToast('🔁 已复位');
      loadBlogPanel();
    } else if (data && data.error === 'no_identity') {
      showToast('这条内容没有可识别的作者（旧数据），改用「删除」处理吧');
    } else {
      showToast('操作失败：' + ((data && data.error) || ('HTTP ' + res.status)));
    }
  } catch (e) {
    showToast('网络异常');
  }
}

/* 刷新按钮 */
(function () {
  const btn = document.getElementById('refreshBlogBtn');
  if (btn) btn.addEventListener('click', loadBlogPanel);
})();

/* ============================================================
   全局暴露（供 admin.html 内联脚本批量导入使用）
   ============================================================ */
window.loadSongs = loadSongs;
window.loadRobloxStats = loadRobloxStats;
window.addSongToServer = addSongToServer;
window.loadStatsPanel = loadStatsPanel;
window.loadBlogPanel = loadBlogPanel;
window.loadSponsors = loadSponsors;
window.ensureSponsors = ensureSponsors;