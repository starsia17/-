(() => {
  const root = document.querySelector('#sharedOutput'), status = document.querySelector('#shareStatus'); let request = 0;
  async function load() {
    const sequence = ++request; root.querySelectorAll('video').forEach(video => video.pause()); root.replaceChildren(); status.hidden = false; status.textContent = '공유된 작업을 불러오는 중입니다.';
    const token = location.hash.slice(1); if (!/^[\w-]{43}$/.test(token)) { status.textContent = '올바르지 않은 공유 주소입니다.'; return; }
    try {
      const response = await fetch('/api/shared/' + token, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }); const data = await response.json();
      if (sequence !== request) return; if (!response.ok || !data.success) throw Error(data.message || '공유된 작업을 확인할 수 없습니다.');
      root.append(window.portfolioPresentation.render(data)); status.hidden = true;
    } catch (error) { if (sequence === request) status.textContent = error.message; }
  }
  window.addEventListener('hashchange', load); load();
})();
