(() => {
  const host = document.querySelector('#accountSecurityHost');
  if (!host) return;
  let generation = 0, identity = null;
  const node = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };
  const active = () => !!window.portfolioAuth?.user && location.hash === '#mypage/account';
  async function read(response) {
    const data = await response.json();
    if (!response.ok || !data.success) throw Error(data.message || '보안 설정을 처리하지 못했습니다.');
    return data;
  }
  async function load() {
    const epoch = ++generation; host.replaceChildren();
    if (!active()) return;
    try {
      const data = await read(await window.portfolioAuth.fetch('/api/account/security'));
      if (epoch !== generation || !active()) return;
      render(data, epoch);
    } catch (error) { if (epoch === generation && active()) host.append(node('p', error.message)); }
  }
  function render(data, epoch) {
    host.replaceChildren(); host.className = 'account-security';
    host.append(node('h3', '2단계 인증'), node('p', data.enabled ? '사용 중 · 로그인할 때 비밀번호와 인증 코드가 모두 필요합니다.' : '인증 앱을 연결하면 비밀번호가 유출되어도 추가 인증이 필요합니다.'));
    if (!data.available) { host.append(node('p', '서버의 인증 암호화 설정이 준비되어야 연결할 수 있습니다. 기존 로그인은 계속 사용할 수 있습니다.')); return; }
    const form = node('form'); form.className = 'account-change-form';
    const passwordLabel = node('label', window.portfolioAuth.user.kind === 'admin' ? '현재 관리자 비밀번호' : '현재 비밀번호');
    const password = node('input'); password.type = 'password'; password.autocomplete = 'current-password'; password.maxLength = 128; password.required = true;
    passwordLabel.append(password); form.append(passwordLabel);
    const codeLabel = node('label', '인증 앱의 6자리 코드 또는 미사용 복구 코드'), code = node('input');
    code.autocomplete = 'one-time-code'; code.maxLength = 35; code.required = true; codeLabel.append(code); codeLabel.hidden = !data.enabled; code.disabled = !data.enabled; form.append(codeLabel);
    const setup = node('div'); setup.hidden = true; form.append(setup);
    const status = node('p'); status.setAttribute('role', 'status'); form.append(status);
    const button = node('button', data.enabled ? '2단계 인증 해제' : '인증 앱 연결 시작'); button.type = 'submit'; button.className = 'edit-post-button'; form.append(button); host.append(form);
    let confirming = false;
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      button.disabled = true; status.textContent = '';
      try {
        const endpoint = data.enabled ? 'disable' : confirming ? 'confirm' : 'setup';
        const result = await read(await window.portfolioAuth.fetch('/api/account/security/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value, code: code.value.trim() }) }));
        if (epoch !== generation || !active()) return;
        password.value = ''; code.value = '';
        if (endpoint === 'setup') {
          confirming = true; passwordLabel.hidden = true; password.disabled = true;
          setup.replaceChildren(node('p', '인증 앱에서 QR을 스캔하거나 아래 설정 키를 직접 입력하세요. 10분 내에 확인해야 적용됩니다.'));
          const image = node('img'); image.src = result.qr; image.alt = '본인 인증 앱 연결용 QR'; image.width = 240; image.height = 240;
          const key = node('code', result.secret); setup.append(image, key); setup.hidden = false;
          codeLabel.firstChild.textContent = '인증 앱의 6자리 코드'; code.disabled = false; codeLabel.hidden = false; code.inputMode = 'numeric'; code.maxLength = 6; code.pattern = '[0-9]{6}'; button.textContent = '코드 확인하고 2단계 인증 켜기'; code.focus();
        } else if (endpoint === 'confirm') {
          host.replaceChildren(node('h3', '2단계 인증이 켜졌습니다'), node('p', '복구 코드는 지금 한 번만 표시됩니다. 인증 앱을 잃어버렸을 때 사용할 수 있도록 본인만 접근할 수 있는 곳에 보관하세요. 각 코드는 한 번만 사용할 수 있습니다. 다른 기기의 기존 로그인은 종료되었습니다.'));
          const label = node('label', '복구 코드 10개'), codes = node('textarea'); codes.readOnly = true; codes.rows = 10; codes.value = result.recoveryCodes.join('\n'); label.append(codes); host.append(label);
          const done = node('button', '복구 코드 보관 완료'); done.type = 'button'; done.addEventListener('click', load); host.append(done);
        } else { await load(); }
      } catch (error) { if (epoch === generation && active()) status.textContent = error.message; }
      finally { button.disabled = false; }
    });
  }
  document.addEventListener('portfolio:auth', () => {
    const next = window.portfolioAuth?.user?.id || null;
    if (next !== identity) { identity = next; load(); }
  });
  window.addEventListener('hashchange', load);
})();
