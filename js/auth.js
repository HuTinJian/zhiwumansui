/* ============================================================
   织雾满穗 · 身份验证
   登录状态检查、密码提交、后台入口
   ============================================================ */

/* 检查当前是否已登录 */
async function isLoggedIn() {
  try {
    const res = await fetch('/api/auth/check', {
      method: 'GET',
      credentials: 'include'
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.ok === true;
  } catch {
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
      body: JSON.stringify({ password })
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.ok === true;
  } catch {
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
  } catch {}
}

/* 动态创建验证弹窗 */
function ensureAuthModal(modalId = 'authModal') {
  let modal = document.getElementById(modalId);
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = modalId;
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h2>身份验证</h2>
      <p>请输入访问凭证</p>
      <div class="form-group">
        <input type="password" id="authInput" placeholder="请输入" autocomplete="off">
        <div id="authError" style="display:none;color:#c0392b;font-size:0.85rem;margin-top:6px;">凭证不正确，请重试</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="authCancel">取消</button>
        <button class="btn btn-primary" id="authConfirm">确认</button>
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

  let count = 0;
  let lastTime = 0;

  title.addEventListener('click', async function () {
    const now = Date.now();
    if (now - lastTime > 2000) count = 0;
    count++;
    lastTime = now;

    if (count >= 3) {
      count = 0;
      if (await isLoggedIn()) {
        window.location.href = redirect;
        return;
      }
      const input = document.getElementById('authInput');
      const err = document.getElementById('authError');
      if (input) input.value = '';
      if (err) err.style.display = 'none';
      openModal(modalId);
      setTimeout(() => input && input.focus(), 300);
    }
  });

  document.getElementById('authConfirm').addEventListener('click', async function () {
    const input = document.getElementById('authInput');
    const err = document.getElementById('authError');
    const pwd = input ? input.value : '';

    if (await submitPassword(pwd)) {
      closeModal(modalId);
      setTimeout(() => window.location.href = redirect, 300);
    } else {
      if (err) err.style.display = 'block';
      if (input) {
        input.value = '';
        input.focus();
      }
    }
  });

  document.getElementById('authCancel').addEventListener('click', function () {
    closeModal(modalId);
  });

  document.getElementById('authInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('authConfirm').click();
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