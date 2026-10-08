(() => {
  const screen = document.querySelector('#authScreen');
  const forms = document.querySelectorAll('.auth-form');
  let user = null, epoch = 0, lastActivity = Date.now(), lastCheck = 0, pendingRefresh = null;
  let tabToken = sessionStorage.getItem('portfolioTabToken') || '';
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('private-portfolio-auth') : null;
  const safeFetch = (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (tabToken) headers.set('X-Portfolio-Tab', tabToken);
    return window.fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  };
  function setUser(next) {
    user = next; screen.hidden = !!user;
    document.querySelector('main').hidden = !user;
    document.querySelectorAll('[data-private]').forEach(node => { node.hidden = !user; });
    document.querySelector('#accountBadge').textContent = user ? user.username + '의 아카이브' : '';
    document.dispatchEvent(new CustomEvent('portfolio:auth', { detail: { user } }));
  }
  function clear(message = '') {
    ++epoch; tabToken = ''; sessionStorage.removeItem('portfolioTabToken'); setUser(null);
    document.querySelector('#authNotice').textContent = message;
    document.querySelector('#authNotice').hidden = !message;
  }
  async function read(response) {
    let data;
    try { data = await response.json(); } catch { throw Error('서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    if (!response.ok || data.success === false) { const error = Error(data.message || '요청을 처리하지 못했습니다.'); error.mfaRequired = data.mfaRequired === true; throw error; }
    return data;
  }
  async function refresh() {
    if (pendingRefresh) return pendingRefresh;
    const version = epoch;
    pendingRefresh = (async () => {
      const data = await read(await safeFetch('/api/auth/session'));
      if (version !== epoch) return;
      if (data.authenticated) setUser(data.user);
      else clear(user ? '로그인이 만료되었습니다. 다시 로그인해주세요.' : '');
      lastCheck = Date.now();
    })().catch(() => { if (version === epoch) clear('로그인 상태를 확인하지 못했습니다. 다시 로그인해주세요.'); }).finally(() => { pendingRefresh = null; });
    return pendingRefresh;
  }
  function mediaUrl(value) {
    if (!value || !value.startsWith('/api/media/')) return value;
    const url = new URL(value, location.origin);
    if (tabToken) url.searchParams.set('tab', tabToken);
    return url.pathname + url.search;
  }
  const api = window.portfolioAuth = {
    get user() { return user; }, fetch: safeFetch, refresh, mediaUrl,
    acceptAccount(next) { ++epoch; setUser(next); channel?.postMessage('changed'); },
    expire() { clear('로그인이 만료되었습니다. 다시 로그인해주세요.'); },
    ready: null
  };
  function showForm(name) {
    forms.forEach(form => { form.hidden = form.dataset.authView !== name; });
    document.querySelectorAll('[data-auth-view-button]').forEach(button => {
      const selected = button.dataset.authViewButton === name;
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    });
    forms.forEach(form => { const code = form.querySelector('[name=code]'); if (code) code.required = false; });
    document.querySelector('#authNotice').hidden = true;
  }
  document.querySelectorAll('[data-auth-view-button]').forEach(button => button.addEventListener('click', () => showForm(button.dataset.authViewButton)));
  document.querySelector('#loginUsername').addEventListener('input', () => { document.querySelector('#loginSecondFactor').required = false; });
  forms.forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type=submit]'), notice = form.querySelector('[role=status]');
    notice.hidden = true;
    const name = form.dataset.authView, values = Object.fromEntries(new FormData(form));
    if (name === 'register' && values.password !== values.passwordConfirm) {
      notice.textContent = '비밀번호 확인이 일치하지 않습니다.'; notice.hidden = false; return;
    }
    button.disabled = true;
    try {
      if (name !== 'register') {
        tabToken = crypto.randomUUID(); sessionStorage.setItem('portfolioTabToken', tabToken);
        values.tabToken = tabToken; values.remember = form.querySelector('[name=remember]').checked;
      }
      const endpoint = name === 'admin' ? '/api/auth/admin/login' : '/api/auth/' + (name === 'register' ? 'register' : 'login');
      const data = await read(await safeFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }));
      form.reset();
      if (name === 'register') {
        showForm('login'); document.querySelector('#loginUsername').value = values.username;
        document.querySelector('#authNotice').textContent = '가입이 완료되었습니다. 만든 계정으로 로그인해주세요.';
        document.querySelector('#authNotice').hidden = false;
      } else {
        ++epoch; lastActivity = Date.now(); lastCheck = Date.now();
        history.replaceState(history.state, '', location.pathname + location.search);
        setUser(data.user); channel?.postMessage('changed');
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
    } catch (error) {
      notice.textContent = error.message; notice.hidden = false;
      if (error.mfaRequired) { const code = form.querySelector('[name=code]'); if (code) { code.required = true; code.focus(); } }
    }
    finally { button.disabled = false; }
  }));
  async function logout() {
    ++epoch;
    try { await safeFetch('/api/auth/logout', { method: 'POST' }); }
    finally { clear(); channel?.postMessage('changed'); history.replaceState(history.state, '', location.pathname + location.search); showForm('login'); }
  }
  document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', () => logout().catch(() => {})));
  channel?.addEventListener('message', () => { clear(); refresh(); });
  ['pointerdown', 'keydown', 'input', 'scroll'].forEach(name => document.addEventListener(name, () => { lastActivity = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (!user) return;
    if (Date.now() - lastActivity >= 30 * 60 * 1000) { logout().catch(() => {}); return; }
    if (Date.now() - lastActivity < 60000 && Date.now() - lastCheck > 60000) refresh();
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && user) {
      if (Date.now() - lastActivity >= 30 * 60 * 1000) logout().catch(() => {});
      else refresh();
    }
  });
  api.ready = refresh();
  window.addEventListener('pagehide', () => {
    document.querySelector('main').hidden = true;
    document.querySelectorAll('[data-private]').forEach(node => { node.hidden = true; });
  });
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
})();

