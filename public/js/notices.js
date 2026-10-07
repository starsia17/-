(() => {
  const page = document.querySelector('#noticesPage'), list = document.querySelector('#noticeList'), detail = document.querySelector('#noticeDetail');
  const form = document.querySelector('#noticeComposer'), editor = document.querySelector('#noticeContentInput');
  const write = document.querySelector('#writeNoticeButton'), cancel = document.querySelector('#cancelNoticeButton'), publish = document.querySelector('#publishNoticeButton');
  const message = document.querySelector('#noticeMessage'), loading = document.querySelector('#noticeLoading'), empty = document.querySelector('#noticeEmpty');
  let identity = null, version = 0, request = 0, saving = false, current = null, tools = null, creationKey = '';
  const admin = () => window.portfolioAuth.user?.kind === 'admin';
  const node = (tag, text, className) => { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (className) result.className = className; return result; };
  const date = value => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(value));
  function status(text = '', error = false) { message.textContent = text; message.hidden = !text; message.classList.toggle('notice-status-error', error); }
  async function ensureEditor() {
    if (!window.portfolioTextEditor) await new Promise(resolve => document.addEventListener('portfolio:editor-ready', resolve, { once: true }));
    if (!tools) tools = window.portfolioTextEditor.mount(document.querySelector('#noticeToolbarHost'), editor);
  }
  async function read(url, options, epoch) {
    const response = await window.portfolioAuth.fetch(url, options);
    let data; try { data = await response.json(); } catch { throw Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    if (epoch !== version) throw Error('로그인 계정이 변경되었습니다.');
    if (response.status === 401) window.portfolioAuth.expire();
    if (!response.ok || !data.success) throw Error(data.message || '공지사항을 처리하지 못했습니다.');
    return data;
  }
  function renderBody(notice, root) {
    if (notice.bodyHtml) root.innerHTML = notice.bodyHtml;
    else { (notice.content || '').split('\n').forEach(line => { const paragraph = node('p', line); if (!line) paragraph.append(document.createElement('br')); root.append(paragraph); }); }
  }
  function renderList(notices) {
    empty.hidden = notices.length > 0;
    notices.forEach(notice => {
      const row = node('article', undefined, 'notice-entry notice-list-row');
      const title = node('a', notice.title, 'notice-title-link'); title.href = '#notice/' + notice._id;
      const meta = node('div', undefined, 'notice-entry-meta'); meta.append(node('span', '관리자'), node('time', date(notice.createdAt)));
      if (notice.updatedAt) meta.append(node('span', '수정 ' + date(notice.updatedAt)));
      row.append(title, meta); list.append(row);
    });
  }
  async function setVisible(visible, route = 'notices') {
    const sequence = ++request, epoch = version;
    page.hidden = !visible || !window.portfolioAuth.user;
    list.replaceChildren(); detail.replaceChildren(); detail.hidden = true; form.hidden = true;
    empty.hidden = true; loading.hidden = true; write.hidden = !admin(); status('');
    if (page.hidden) return;
    loading.hidden = false; saving = false; current = null;
    try {
      if (route === 'notices') {
        const data = await read('/api/notices', undefined, epoch);
        if (epoch !== version || sequence !== request) return; renderList(data.notices);
      } else {
        const match = /^notice\/([a-f\d]{24})(\/edit)?$/i.exec(route);
        const composing = route === 'notices/new' || !!match?.[2];
        if (composing && !admin()) throw Error('관리자만 공지사항을 작성하거나 수정할 수 있습니다.');
        if (route !== 'notices/new' && !match) throw Error('올바르지 않은 공지사항 주소입니다.');
        let notice = null;
        if (match) { notice = (await read('/api/notices/' + match[1], undefined, epoch)).notice; }
        if (epoch !== version || sequence !== request) return;
        if (composing) {
          await ensureEditor(); if (epoch !== version || sequence !== request) return;
          current = notice; form.reset(); tools.reset(); tools.setBusy(false); creationKey = crypto.randomUUID();
          document.querySelector('#noticeTitleInput').disabled = false;
          document.querySelector('#noticeTitleInput').value = notice?.title || '';
          if (notice) renderBody(notice, editor);
          document.querySelector('#noticeComposeTitle').textContent = notice ? '공지 수정' : '새 공지 작성';
          publish.textContent = notice ? '수정 내용 저장' : '공지 등록'; publish.disabled = false; cancel.disabled = false;
          form.hidden = false; write.hidden = true;
        } else {
          const back = node('a', '← 공지사항 목록', 'detail-back'); back.href = '#notices';
          detail.append(back, node('h2', notice.title, 'notice-detail-title'));
          const meta = node('p', '관리자 · ' + date(notice.createdAt) + (notice.updatedAt ? ' · 수정 ' + date(notice.updatedAt) : ''), 'notice-detail-meta');
          const body = node('article', undefined, 'blog-article notice-detail-body'); renderBody(notice, body);
          detail.append(meta, body);
          if (admin()) { const edit = node('a', '공지 수정', 'notice-edit-link'); edit.href = '#notice/' + notice._id + '/edit'; detail.append(edit); }
          detail.hidden = false;
        }
      }
    } catch (error) { if (epoch === version && sequence === request) status(error.message, true); }
    finally { if (epoch === version && sequence === request) loading.hidden = true; }
  }
  function syncUser(user) {
    const next = user ? user.id + ':' + user.kind : null; if (next === identity) return;
    identity = next; version++; request++; saving = false; current = null;
    form.reset(); tools?.reset(); tools?.setBusy(false); editor.replaceChildren(); list.replaceChildren(); detail.replaceChildren(); status('');
    publish.disabled = false; cancel.disabled = false; write.disabled = false; write.hidden = !admin();
    document.querySelector('#noticeTitleInput').disabled = false;
    if (!user) page.hidden = true;
    else { const hash = location.hash.slice(1); if (hash === 'notices' || hash === 'notices/new' || hash.startsWith('notice/')) setVisible(true, hash); }
  }
  window.portfolioNotices = { setVisible };
  document.addEventListener('portfolio:auth', event => syncUser(event.detail.user));
  window.portfolioAuth.ready.then(() => syncUser(window.portfolioAuth.user));
  write.addEventListener('click', () => { if (admin() && !saving) location.hash = 'notices/new'; });
  cancel.addEventListener('click', () => { if (!saving) location.hash = current ? 'notice/' + current._id : 'notices'; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (saving || !admin() || !form.reportValidity() || !tools) return;
    const title = document.querySelector('#noticeTitleInput').value.trim(), content = editor.innerText.trim(), bodyHtml = tools.html();
    if (!title || !content || content.length > 25000 || bodyHtml.length > 150000) { status('제목과 본문을 입력해주세요. 본문은 최대 25,000자까지 작성할 수 있습니다.', true); return; }
    const epoch = version, sequence = request, edited = current;
    const values = { title, content, bodyHtml, ...(edited ? { revision: edited.revision } : { creationKey }) };
    saving = true; tools.setBusy(true); publish.disabled = true; cancel.disabled = true;
    document.querySelector('#noticeTitleInput').disabled = true; publish.textContent = '저장 중…'; status('');
    try {
      const data = await read('/api/notices' + (edited ? '/' + edited._id : ''), { method: edited ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }, epoch);
      if (epoch !== version || sequence !== request) return; location.hash = 'notice/' + data.notice._id;
    } catch (error) { if (epoch === version && sequence === request) status(error.message, true); }
    finally { if (epoch === version && sequence === request) {
      saving = false; tools.setBusy(false); publish.disabled = false; cancel.disabled = false; document.querySelector('#noticeTitleInput').disabled = false;
      publish.textContent = edited ? '수정 내용 저장' : '공지 등록';
    } }
  });
})();
