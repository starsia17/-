(() => {
  const closedEye = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 10c2 5 16 5 18 0M5 13l-2 3M9 15l-1 3M15 15l1 3M19 13l2 3"/></svg>';
  const openEye = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const controls = [];
  document.querySelectorAll('input[type="password"]').forEach(input => {
    const wrap = document.createElement('div'); wrap.className = 'password-input-wrap';
    input.before(wrap); wrap.append(input); input.classList.add('password-with-toggle');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'password-visibility-button';
    button.setAttribute('aria-controls', input.id);
    const label = document.querySelector('label[for="' + input.id + '"]')?.firstChild?.textContent.trim() || '비밀번호';
    function setVisible(visible) {
      input.type = visible ? 'text' : 'password';
      button.innerHTML = visible ? openEye : closedEye;
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', label + (visible ? ' 숨기기' : ' 표시하기'));
      button.title = visible ? '뜬 눈 · 비밀번호 표시 중 (누르면 숨김)' : '감은 눈 · 비밀번호 숨김 (누르면 표시)';
    }
    button.addEventListener('click', () => {
      const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
      setVisible(input.type === 'password');
      input.focus({ preventScroll: true });
      if (start !== null && end !== null) input.setSelectionRange(start, end, direction || 'none');
    });
    wrap.append(button); setVisible(false); controls.push({ input, setVisible });
    input.form?.addEventListener('reset', () => setVisible(false));
  });
  const hide = () => controls.forEach(control => control.setVisible(false));
  let identity = null;
  document.addEventListener('portfolio:auth', event => {
    const next = event.detail.user?.id || null; if (next === identity) return;
    identity = next; hide();
  });
  window.addEventListener('hashchange', hide);
  window.addEventListener('pagehide', hide);
})();
