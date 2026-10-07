(() => {
  const header = document.querySelector('.topbar');
  const button = header?.querySelector('.mobile-menu-toggle');
  const panel = document.querySelector('#siteNavigation');
  if (!header || !button || !panel) return;
  const compact = window.matchMedia('(max-width: 1100px)');
  function setOpen(open, returnFocus = false) {
    const expanded = compact.matches && open && !panel.hidden;
    header.classList.toggle('menu-open', expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.querySelector('.menu-toggle-label').textContent = expanded ? '닫기' : '메뉴';
    if (!expanded) panel.querySelectorAll('details[open]').forEach(details => { details.open = false; });
    if (returnFocus && compact.matches && !button.hidden) button.focus({ preventScroll: true });
  }
  function markCurrent() {
    const route = location.hash.split('/')[0] || '#top';
    panel.querySelectorAll('.top-nav > a').forEach(link => {
      const current = link.hash === route || (link.hash === '#work' && (route === '#post' || route === '#write')) || (link.hash === '#portfolios' && route === '#portfolio') || (link.hash === '#notices' && route === '#notice');
      if (current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }
  button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
  panel.addEventListener('click', event => {
    if (event.target.closest('a, [data-logout]')) setOpen(false, true);
  });
  header.querySelector('.wordmark')?.addEventListener('click', () => setOpen(false));
  document.addEventListener('click', event => {
    if (!header.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') { setOpen(false, true); event.preventDefault(); }
  });
  window.addEventListener('hashchange', () => { setOpen(false); markCurrent(); });
  compact.addEventListener('change', () => setOpen(false));
  document.addEventListener('portfolio:auth', () => { setOpen(false); markCurrent(); });
  markCurrent();
})();
