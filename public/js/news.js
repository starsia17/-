(() => {
  const page = document.querySelector('#newsPage');
  const list = document.querySelector('#newsList');
  const form = document.querySelector('#newsComposer');
  const write = document.querySelector('#writeNewsButton');
  const cancel = document.querySelector('#cancelNewsButton');
  const publish = document.querySelector('#publishNewsButton');
  const message = document.querySelector('#newsMessage');
  const empty = document.querySelector('#newsEmpty');
  const loading = document.querySelector('#newsLoading');
  let identity = null, version = 0, request = 0, saving = false, writable = false;
  const isAdmin = () => !!window.portfolioAuth.user && (window.portfolioAuth.user.kind === 'admin' || writable);
  function status(text, error = false) {
    message.textContent = text; message.hidden = !text;
    message.classList.toggle('notice-status-error', error);
  }
  function compose(open) {
    form.hidden = !open || !isAdmin();
    write.setAttribute('aria-expanded', String(!form.hidden));
    write.textContent = form.hidden ? '뉴스 작성' : '작성창 닫기';
    if (!form.hidden) document.querySelector('#newsTitleInput').focus({ preventScroll: true });
  }
  async function read(response, epoch) {
    let data;
    try { data = await response.json(); } catch { throw Error('뉴스 서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    if (epoch !== version) throw Error('로그인 계정이 변경되었습니다.');
    if (response.status === 401) window.portfolioAuth.expire();
    if (!response.ok || !data.success) throw Error(data.message || '뉴스을 처리하지 못했습니다.');
    return data;
  }
  function render(notices) {
    list.replaceChildren(); empty.hidden = notices.length > 0;
    notices.forEach(notice => {
      const entry = document.createElement('details'); entry.className = 'notice-entry';
      const summary = document.createElement('summary');
      const text = document.createElement('span'); text.className = 'notice-entry-title'; text.textContent = notice.title;
      const meta = document.createElement('span'); meta.className = 'notice-entry-meta';
      const date = document.createElement('time'); date.dateTime = notice.createdAt;
      date.textContent = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(notice.createdAt));
      const author = document.createElement('span'); author.textContent = notice.authorName;
      const expand = document.createElement('span'); expand.className = 'notice-expand'; expand.textContent = '+'; expand.setAttribute('aria-hidden', 'true');
      meta.append(author, date); summary.append(text, meta, expand);
      const content = document.createElement('div'); content.className = 'notice-entry-content'; content.textContent = notice.content;
      if (notice.sourceUrl) {
        const source = document.createElement('a'); source.className = 'news-source'; source.href = notice.sourceUrl;
        source.textContent = '원문 보기 ↗'; source.target = '_blank'; source.rel = 'noopener noreferrer'; content.append(document.createElement('br'), source);
      }
      entry.append(summary, content); list.append(entry);
    });
  }
  async function load() {
    if (!window.portfolioAuth.user || page.hidden) return;
    const sequence = ++request, epoch = version;
    loading.hidden = false; empty.hidden = true;
    try {
      const response = await window.portfolioAuth.fetch('/api/news');
      if (epoch !== version || sequence !== request) return;
      const data = await read(response, epoch);
      if (epoch !== version || sequence !== request || page.hidden) return;
      writable = data.canWrite === true; write.hidden = !isAdmin();
      if (!isAdmin()) compose(false);
      render(data.news);
    } catch (error) {
      if (epoch === version && sequence === request) status(error.message, true);
    } finally { if (epoch === version && sequence === request) loading.hidden = true; }
  }
  function syncUser(user) {
    const next = user ? user.kind + ':' + user.username : null;
    writable = user?.canWriteNews === true; write.hidden = !isAdmin(); if (!isAdmin()) compose(false);
    if (next === identity) return;
    identity = next; version++; request++; saving = false;
    list.replaceChildren(); form.reset(); compose(false); status(''); loading.hidden = true; empty.hidden = true;
    publish.disabled = false; cancel.disabled = false; write.disabled = false;
    publish.textContent = '뉴스 등록';
    if (!user) page.hidden = true;
    else if (location.hash === '#news') setVisible(true);
  }
  function setVisible(visible) {
    page.hidden = !visible || !window.portfolioAuth.user;
    if (page.hidden) { request++; loading.hidden = true; }
    else { write.hidden = !isAdmin(); load(); }
  }
  window.portfolioNews = { setVisible };
  document.addEventListener('portfolio:auth', event => syncUser(event.detail.user));
  window.portfolioAuth.ready.then(() => syncUser(window.portfolioAuth.user));
  write.addEventListener('click', () => { if (!saving) { status(''); compose(form.hidden); } });
  cancel.addEventListener('click', () => { if (!saving) compose(false); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !isAdmin() || !form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    values.title = values.title.trim(); values.content = values.content.trim();
    if (!values.title || !values.content) { status('뉴스 제목과 내용을 입력해주세요.', true); return; }
    const epoch = version;
    saving = true; publish.disabled = true; cancel.disabled = true; write.disabled = true;
    publish.textContent = '등록 중…'; status('');
    try {
      const response = await window.portfolioAuth.fetch('/api/news', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values)
      });
      if (epoch !== version) return;
      await read(response, epoch);
      if (epoch !== version) return;
      form.reset(); compose(false);
      status('뉴스가 등록되었습니다. 모든 로그인 사용자가 확인할 수 있습니다.');
      await load();
    } catch (error) { if (epoch === version) status(error.message, true); }
    finally {
      if (epoch === version) {
        saving = false; publish.disabled = false; cancel.disabled = false; write.disabled = false;
        publish.textContent = '뉴스 등록';
      }
    }
  });
})();
