/* ============================================================
   织雾满穗 · 身份验证
   登录状态检查、密码提交、后台入口
   ------------------------------------------------------------
   依赖 js/common.js 提供的 openModal / closeModal / showToast。
   ============================================================ */

/* 检查当前是否已登录 */
async function isLoggedIn() {
  try {
    const res = await fetch('/api/auth/check', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.ok === true;
  } catch (e) {
    return false;
  }
}

/* 提交密码到后端 */
async function submitPassword(password) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: String(password ?? '') })
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.ok === true;
  } catch (e) {
    return false;
  }
}

/* 退出登录 */
async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
  } catch (e) {}
}

/* 动态创建验证弹窗 */
function ensureAuthModal(modalId = 'authModal') {
  let modal = document.getElementById(modalId);
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = modalId;
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', modalId + 'Title');
  /* 后台入口属于敏感操作，禁止点遮罩误关（ESC 仍可关闭） */
  modal.dataset.static = 'true';
  modal.innerHTML = `
    <div class="modal-content">
      <h2 id="${modalId}Title">身份验证</h2>
      <p>请输入访问凭证</p>
      <div class="form-group">
        <label class="sr-only" for="${modalId}Input">访问凭证</label>
        <input type="password" id="${modalId}Input" placeholder="请输入" autocomplete="current-password">
        <div class="form-error" id="${modalId}Error" role="alert" hidden>凭证不正确，请重试</div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="${modalId}Cancel">取消</button>
        <button type="button" class="btn btn-primary" id="${modalId}Confirm">确认</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

/* 绑定后台入口：连点标题 3 次弹出验证框 */
function setupAdminEntry(titleId, redirect = 'admin.html') {
  const title = document.getElementById(titleId);
  if (!title) return;

  const modalId = 'authModal';
  ensureAuthModal(modalId);

  const input = document.getElementById(modalId + 'Input');
  const err = document.getElementById(modalId + 'Error');
  const confirmBtn = document.getElementById(modalId + 'Confirm');
  const cancelBtn = document.getElementById(modalId + 'Cancel');

  if (!input || !confirmBtn || !cancelBtn) return;

  title.style.cursor = 'pointer';
  title.setAttribute('title', title.getAttribute('title') || '点我三下有惊喜');

  let count = 0;
  let lastTime = 0;
  let verifying = false;

  function resetError() {
    err.hidden = true;
  }

  function setBusy(busy) {
    verifying = busy;
    confirmBtn.disabled = busy;
    cancelBtn.disabled = busy;
    input.disabled = busy;
    confirmBtn.textContent = busy ? '验证中...' : '确认';
    confirmBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  title.addEventListener('click', async function () {
    const now = Date.now();
    if (now - lastTime > 2000) count = 0;
    count++;
    lastTime = now;

    if (count < 3) return;
    count = 0;

    /* 已在登录态就直接进后台 */
    if (await isLoggedIn()) {
      window.location.href = redirect;
      return;
    }

    input.value = '';
    resetError();
    openModal(modalId);
    /* openModal 内部已负责聚焦，这里只做兜底 */
    setTimeout(function () { if (!verifying) input.focus(); }, 320);
  });

  async function tryLogin() {
    if (verifying) return;
    const pwd = input.value;
    if (!pwd) {
      err.textContent = '请输入访问凭证';
      err.hidden = false;
      input.focus();
      return;
    }

    setBusy(true);
    resetError();

    const ok = await submitPassword(pwd);

    setBusy(false);

    if (ok) {
      closeModal(modalId);
      setTimeout(function () { window.location.href = redirect; }, 260);
    } else {
      err.textContent = '凭证不正确，请重试';
      err.hidden = false;
      input.value = '';
      input.focus();
    }
  }

  confirmBtn.addEventListener('click', tryLogin);

  cancelBtn.addEventListener('click', function () {
    if (verifying) return;
    closeModal(modalId);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      tryLogin();
    }
  });
}

/* 后台页面守卫：未登录跳回主页 */
async function requireAuth() {
  const ok = await isLoggedIn();
  if (!ok) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}
