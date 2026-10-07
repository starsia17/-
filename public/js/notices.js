(() => {
  const page = document.querySelector('#noticesPage');
  const list = document.querySelector('#noticeList');
  const form = document.querySelector('#noticeComposer');
  const write = document.querySelector('#writeNoticeButton');
  const cancel = document.querySelector('#cancelNoticeButton');
  const publish = document.querySelector('#publishNoticeButton');
  const message = document.querySelector('#noticeMessage');
  const empty = document.querySelector('#noticeEmpty');
  const loading = document.querySelector('#noticeLoading');
  let identity = null, version = 0, request = 0, saving = false;
  const isAdmin = () => window.portfolioAuth.user?.kind === 'admin';
  function status(text, error = false) {
    message.textContent = text; message.hidden = !text;
    message.classList.toggle('notice-status-error', error);
  }
  function compose(open) {
    form.hidden = !open || !isAdmin();
    write.setAttribute('aria-expanded', String(!form.hidden));
    write.textContent = form.hidden ? '공지 작성' : '작성창 닫기';
    if (!form.hidden) document.querySelector('#noticeTitleInput').focus({ preventScroll: true });
  }
  async function read(response, epoch) {
    let data;
    try { data = await response.json(); } catch { throw Error('공지사항 서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    if (epoch !== version) throw Error('로그인 계정이 변경되었습니다.');
    if (response.status === 401) window.portfolioAuth.expire();
    if (!response.ok || !data.success) throw Error(data.message || '공지사항을 처리하지 못했습니다.');
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
      const author = document.createElement('span'); author.textContent = '관리자';
      const expand = document.createElement('span'); expand.className = 'notice-expand'; expand.textContent = '+'; expand.setAttribute('aria-hidden', 'true');
      meta.append(author, date); summary.append(text, meta, expand);
      const content = document.createElement('div'); content.className = 'notice-entry-content'; content.textContent = notice.content;
      entry.append(summary, content); list.append(entry);
    });
  }
  async function load() {
    if (!window.portfolioAuth.user || page.hidden) return;
    const sequence = ++request, epoch = version;
    loading.hidden = false; empty.hidden = true;
    try {
      const response = await window.portfolioAuth.fetch('/api/notices');
      if (epoch !== version || sequence !== request) return;
      const data = await read(response, epoch);
      if (epoch !== version || sequence !== request || page.hidden) return;
      render(data.notices);
    } catch (error) {
      if (epoch === version && sequence === request) status(error.message, true);
    } finally { if (epoch === version && sequence === request) loading.hidden = true; }
  }
  function syncUser(user) {
    const next = user ? user.kind + ':' + user.username : null;
    write.hidden = user?.kind !== 'admin';
    if (next === identity) return;
    identity = next; version++; request++; saving = false;
    list.replaceChildren(); form.reset(); compose(false); status(''); loading.hidden = true; empty.hidden = true;
    publish.disabled = false; cancel.disabled = false; write.disabled = false;
    publish.textContent = '공지 등록';
    if (!user) page.hidden = true;
    else if (location.hash === '#notices') setVisible(true);
  }
  function setVisible(visible) {
    page.hidden = !visible || !window.portfolioAuth.user;
    if (page.hidden) { request++; loading.hidden = true; }
    else { write.hidden = !isAdmin(); load(); }
  }
  window.portfolioNotices = { setVisible };
  document.addEventListener('portfolio:auth', event => syncUser(event.detail.user));
  window.portfolioAuth.ready.then(() => syncUser(window.portfolioAuth.user));
  write.addEventListener('click', () => { if (!saving) { status(''); compose(form.hidden); } });
  cancel.addEventListener('click', () => { if (!saving) compose(false); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !isAdmin() || !form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    values.title = values.title.trim(); values.content = values.content.trim();
    if (!values.title || !values.content) { status('공지 제목과 내용을 입력해주세요.', true); return; }
    const epoch = version;
    saving = true; publish.disabled = true; cancel.disabled = true; write.disabled = true;
    publish.textContent = '등록 중…'; status('');
    try {
      const response = await window.portfolioAuth.fetch('/api/notices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values)
      });
      if (epoch !== version) return;
      await read(response, epoch);
      if (epoch !== version) return;
      form.reset(); compose(false);
      status('공지가 등록되었습니다. 모든 로그인 사용자가 확인할 수 있습니다.');
      await load();
    } catch (error) { if (epoch === version) status(error.message, true); }
    finally {
      if (epoch === version) {
        saving = false; publish.disabled = false; cancel.disabled = false; write.disabled = false;
        publish.textContent = '공지 등록';
      }
    }
  });
})();
