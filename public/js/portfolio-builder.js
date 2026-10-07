(() => {
  const page = document.querySelector('#portfolioPage'), list = document.querySelector('#portfolioList');
  const form = document.querySelector('#portfolioBuilderForm'), output = document.querySelector('#portfolioOutput');
  const choices = document.querySelector('#portfolioChoices'), order = document.querySelector('#portfolioOrder');
  const search = document.querySelector('#portfolioSearch'), message = document.querySelector('#portfolioStatus');
  const save = document.querySelector('#portfolioSaveButton');
  let identity = null, epoch = 0, sequence = 0, posts = [], selected = [], editing = null, creationKey = '', saving = false, activeRoute = '';
  function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
  function status(text = '', error = false) { message.textContent = text; message.hidden = !text; message.classList.toggle('notice-status-error', error); }
  function stopMedia() { output.querySelectorAll('video').forEach(video => video.pause()); output.replaceChildren(); }
  async function read(url, options, version) {
    const response = await window.portfolioAuth.fetch(url, options);
    let data; try { data = await response.json(); } catch { throw Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    if (version !== epoch) throw Error('로그인 계정이 변경되었습니다.');
    if (response.status === 401) window.portfolioAuth.expire();
    if (!response.ok || !data.success) throw Error(data.message || '포트폴리오를 처리하지 못했습니다.');
    return data;
  }
  function layout(value, items) {
    const images = items.filter(post => post.media?.some(media => media.type === 'image')).length;
    return value === 'auto' ? (images > 0 && images >= items.length / 2 ? 'gallery' : 'story') : value;
  }
  function renderPortfolio(data, preview = false) {
    if (window.portfolioPresentation) { stopMedia(); output.append(window.portfolioPresentation.render(data, window.portfolioAuth.mediaUrl, { originalLinks: !preview })); return; }
    stopMedia(); const root = node('div', undefined, 'curated-portfolio curated-' + layout(data.layout, data.posts));
    const hero = node('header', undefined, 'curated-hero');
    hero.append(node('p', preview ? 'PORTFOLIO PREVIEW' : 'PERSONAL PORTFOLIO', 'eyebrow'), node('h1', data.title));
    if (data.introduction) hero.append(node('p', data.introduction, 'curated-introduction'));
    hero.append(node('span', data.posts.length + ' WORKS · ' + (layout(data.layout, data.posts) === 'gallery' ? 'GALLERY' : 'STORY'), 'curated-meta'));
    root.append(hero);
    if (data.unavailableCount) root.append(node('p', '휴지통에 있거나 삭제된 게시글 ' + data.unavailableCount + '개는 표시되지 않습니다. 휴지통에서 복원하면 다시 표시됩니다.', 'portfolio-note'));
    if (!data.posts.length) root.append(node('p', '현재 표시할 게시글이 없습니다. 작업 아카이브 또는 휴지통에서 원본 게시글을 확인해주세요.', 'notice'));
    const projects = node('div', undefined, 'curated-projects');
    data.posts.forEach((post, index) => {
      const project = node('section', undefined, 'curated-project');
      const meta = node('div', undefined, 'curated-project-meta');
      meta.append(node('span', String(index + 1).padStart(2, '0')), node('span', post.category || '기타'));
      const title = node('h2', post.title);
      const open = node('a', '원본 게시글 보기 ↗', 'curated-original'); open.href = '#post/' + post._id;
      project.append(meta, title); window.portfolioPostBody(post, project); project.append(open); projects.append(project);
    });
    root.append(projects); output.append(root);
  }
  function values() { return { title: form.elements.title.value.trim(), ...window.portfolioCareer.builderValues(), layout: form.elements.layout.value, postIds: [...selected] }; }
  function renderOrder() {
    order.replaceChildren(); document.querySelector('#portfolioSelectionCount').textContent = selected.length + ' / 200개 선택';
    if (!selected.length) order.append(node('li', '왼쪽 목록에서 작업을 선택해주세요.', 'portfolio-note'));
    selected.forEach((id, index) => {
      const post = posts.find(item => item._id === id); const row = node('li', undefined, 'portfolio-order-item');
      row.append(node('span', (index + 1) + '. ' + post.title));
      const controls = node('div', undefined, 'portfolio-order-controls');
      [['↑', -1, '위로 이동'], ['↓', 1, '아래로 이동'], ['×', 0, '선택 해제']].forEach(([label, direction, action]) => {
        const button = node('button', label); button.type = 'button'; button.setAttribute('aria-label', post.title + ' ' + action);
        button.disabled = saving || direction === -1 && index === 0 || direction === 1 && index === selected.length - 1;
        button.addEventListener('click', () => {
          if (saving) return;
          if (!direction) selected = selected.filter(value => value !== id);
          else [selected[index], selected[index + direction]] = [selected[index + direction], selected[index]];
          stopMedia(); renderChoices(); renderOrder();
        }); controls.append(button);
      }); row.append(controls); order.append(row);
    });
    save.disabled = saving || !selected.length;
    window.portfolioCareer?.syncSelection(selected.map(id => posts.find(post => post._id === id)).filter(Boolean));
  }
  function renderChoices() {
    choices.replaceChildren(); const term = search.value.trim().toLocaleLowerCase();
    const visible = posts.filter(post => (post.title + ' ' + post.category).toLocaleLowerCase().includes(term));
    if (!visible.length) choices.append(node('p', posts.length ? '검색 결과가 없습니다.' : '먼저 작업 아카이브에서 게시글을 등록해주세요.', 'portfolio-note'));
    visible.forEach(post => {
      const label = node('label', undefined, 'portfolio-choice'); const checkbox = node('input'); checkbox.type = 'checkbox';
      checkbox.checked = selected.includes(post._id); checkbox.disabled = saving;
      const image = post.media?.find(item => item.type === 'image');
      if (image) { const thumb = node('img'); thumb.src = window.portfolioAuth.mediaUrl(image.url); thumb.alt = ''; thumb.loading = 'lazy'; label.append(thumb); }
      const caption = node('span'); caption.append(node('strong', post.title), node('small', post.category || '기타'));
      checkbox.addEventListener('change', () => {
        if (saving) return;
        if (checkbox.checked && selected.length >= 200) { checkbox.checked = false; status('한 포트폴리오에 최대 200개까지 선택할 수 있습니다.', true); return; }
        selected = checkbox.checked ? [...selected, post._id] : selected.filter(id => id !== post._id);
        stopMedia(); renderOrder();
      }); label.prepend(checkbox); label.append(caption); choices.append(label);
    });
  }
  function renderList(items) {
    if (!items.length) { list.append(node('p', '아직 만든 포트폴리오가 없습니다. 작업을 선택해 첫 포트폴리오를 만들어보세요.', 'notice')); return; }
    items.forEach(item => {
      const entry = node('article', undefined, 'portfolio-list-card');
      const open = node('a', undefined, 'portfolio-card-open'); open.href = '#portfolio/' + item.id;
      open.append(node('span', 'MY COLLECTION', 'eyebrow'), node('h3', item.title), node('p', item.introduction || '나의 작업 모음'));
      const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(item.updatedAt));
      open.append(node('small', item.postIds.length + '개 작업 · ' + date), node('span', '포트폴리오 열기 ↗'));
      const remove = node('button', '휴지통으로 이동', 'portfolio-trash-button'); remove.type = 'button';
      remove.setAttribute('aria-label', item.title + ' 포트폴리오 휴지통으로 이동');
      if (item.targetCompany || item.targetRole) open.append(node('small', [item.targetCompany, item.targetRole].filter(Boolean).join(' · '), 'career-target'));
      remove.addEventListener('click', () => moveToTrash(item, remove)); entry.append(open, duplicateButton(item), remove); list.append(entry);
    });
  }
  function duplicateButton(item) {
    const button = node('button', '회사별 복제', 'career-secondary'); button.type = 'button'; const key = crypto.randomUUID();
    button.addEventListener('click', async () => {
      const version = epoch, request = sequence; button.disabled = true; status('복제 중…');
      try {
        const data = await read('/api/portfolios/' + item.id + '/duplicate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creationKey: key }) }, version);
        if (version === epoch && request === sequence) location.hash = 'portfolio/' + data.portfolio.id + '/edit';
      } catch (error) { if (version === epoch && request === sequence) status(error.message, true); }
      finally { button.disabled = false; }
    }); return button;
  }
  function pdfButton() {
    const button = node('button', 'PDF 저장', 'career-secondary'); button.type = 'button';
    button.addEventListener('click', async () => {
      const root = output.querySelector('.curated-portfolio'); if (!root) return;
      const version = epoch, request = sequence;
      button.disabled = true; status('새 인쇄 화면에서 PDF 저장을 선택하세요. 영상은 링크 또는 안내 문구로 표시됩니다.');
      try { await window.portfolioPresentation.print(root, root.querySelector('h1')?.textContent); }
      catch (error) { if (version === epoch && request === sequence) status(error.message, true); } finally { button.disabled = false; }
    }); return button;
  }
  async function moveToTrash(item, button) {
    if (button.disabled || !window.confirm('“' + item.title + '” 포트폴리오를 휴지통으로 이동할까요? 30일 안에 복원할 수 있습니다. 원본 게시글은 유지됩니다.')) return;
    const version = epoch, request = sequence; button.disabled = true;
    try {
      await read('/api/portfolios/' + item.id, { method: 'DELETE' }, version);
      if (version !== epoch || request !== sequence) return;
      if (location.hash.startsWith('#portfolio/')) location.hash = 'portfolios';
      else { await setVisible(true, 'portfolios', true); status('포트폴리오를 휴지통으로 이동했습니다. 30일 안에 복원할 수 있습니다.'); }
    } catch (error) { if (version === epoch && request === sequence) status(error.message, true); }
    finally { button.disabled = false; }
  }
  async function setVisible(visible, route = 'portfolios', force = false) {
    // Background archive/session loading can repeat the same route. Do not
    // reinitialize a visible form and erase its unsaved work or creation key.
    if (visible && window.portfolioAuth.user && !page.hidden && activeRoute === route && !force) return;
    activeRoute = visible && window.portfolioAuth.user ? route : '';
    page.hidden = !visible || !window.portfolioAuth.user; const request = ++sequence, version = epoch;
    window.portfolioCareer?.leaveBuilder();
    stopMedia(); list.replaceChildren(); form.hidden = true; status('');
    if (page.hidden) return;
    status('불러오는 중…'); saving = false; editing = null;
    try {
      if (route === 'portfolios') {
        const data = await read('/api/portfolios', undefined, version);
        if (request !== sequence || version !== epoch) return; renderList(data.portfolios);
      } else if (route === 'portfolios/new' || /^portfolio\/[a-f\d]{24}\/edit$/i.test(route)) {
        const postData = await read('/api/posts', undefined, version);
        if (request !== sequence || version !== epoch) return;
        posts = postData.posts; selected = []; form.reset(); search.value = ''; creationKey = crypto.randomUUID();
        if (route.endsWith('/edit')) {
          const data = await read('/api/portfolios/' + route.split('/')[1], undefined, version);
          if (request !== sequence || version !== epoch) return;
          editing = data.portfolio; selected = editing.postIds.filter(id => posts.some(post => post._id === id));
          form.elements.title.value = editing.title; form.elements.layout.value = editing.layout;
        }
        window.portfolioCareer.openBuilder(editing);
        form.querySelectorAll('input,textarea,select,button').forEach(element => { element.disabled = false; });
        window.portfolioCareer.busyBuilder(false);
        save.textContent = editing ? '수정 내용 저장' : '만들기'; form.hidden = false; renderChoices(); renderOrder();
      } else if (/^portfolio\/[a-f\d]{24}\/preview$/i.test(route)) {
        const data = await read('/api/portfolios/' + route.split('/')[1] + '/preview', undefined, version);
        if (request !== sequence || version !== epoch) return;
        const actions = node('div', undefined, 'portfolio-view-actions');
        const back = node('a', '← 내 포트폴리오'); back.href = '#portfolio/' + route.split('/')[1];
        actions.append(back, node('span', '공유 전 미리보기 · 공개 링크를 만들지 않습니다.', 'portfolio-note'), pdfButton());
        const frame = node('div', undefined, 'career-preview-frame'); frame.append(window.portfolioPresentation.render(data, window.portfolioAuth.mediaUrl));
        const widths = node('div', undefined, 'career-actions');
        ['PC 화면', '모바일 화면'].forEach((label, index) => { const button = node('button', label, 'career-secondary'); button.type = 'button'; button.setAttribute('aria-pressed', String(!index));
          button.addEventListener('click', () => { frame.classList.toggle('career-preview-mobile', !!index); widths.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button))); }); widths.append(button); });
        output.append(actions, widths, frame);
      } else if (/^portfolio\/[a-f\d]{24}$/i.test(route)) {
        const data = await read('/api/portfolios/' + route.split('/')[1], undefined, version);
        if (request !== sequence || version !== epoch) return;
        const actions = node('div', undefined, 'portfolio-view-actions');
        const back = node('a', '← 내 포트폴리오'); back.href = '#portfolios';
        const edit = node('a', '구성 수정'); edit.href = '#portfolio/' + data.portfolio.id + '/edit';
        const remove = node('button', '휴지통으로 이동', 'portfolio-trash-button'); remove.type = 'button';
        const preview = node('a', '공유 화면 미리보기'); preview.href = '#portfolio/' + data.portfolio.id + '/preview';
        remove.addEventListener('click', () => moveToTrash(data.portfolio, remove)); actions.append(back, edit, preview, pdfButton(), duplicateButton(data.portfolio), window.portfolioShareButton('portfolio', data.portfolio.id), remove);
        renderPortfolio(data.portfolio); output.prepend(actions);
      } else throw Error('올바르지 않은 포트폴리오 주소입니다.');
      status(editing?.unavailableCount ? '휴지통에 있거나 삭제된 게시글은 선택 목록에서 제외했습니다. 저장하면 현재 선택한 게시글로 구성이 변경됩니다.' : '');
    } catch (error) { if (request === sequence && version === epoch) { activeRoute = ''; status(error.message, true); } }
  }
  window.portfolioBuilder = { setVisible };
  function syncUser(user) {
    const next = user ? user.id : null; if (next === identity) return;
    identity = next; epoch++; sequence++; posts = []; selected = []; editing = null; saving = false; activeRoute = '';
    form.reset(); choices.replaceChildren(); order.replaceChildren(); list.replaceChildren(); stopMedia(); status('');
    if (!user) { page.hidden = true; return; }
    const hash = location.hash.slice(1); if (hash === 'portfolios' || hash === 'portfolios/new' || hash.startsWith('portfolio/')) setVisible(true, hash);
  }
  document.addEventListener('portfolio:auth', event => syncUser(event.detail.user));
  window.portfolioAuth.ready.then(() => syncUser(window.portfolioAuth.user));
  search.addEventListener('input', renderChoices);
  document.querySelector('#portfolioPreviewButton').addEventListener('click', () => {
    if (!form.reportValidity() || !selected.length || saving) { if (!selected.length) status('미리 볼 게시글을 선택해주세요.', true); return; }
    try { const data = values(); data.posts = selected.map(id => posts.find(post => post._id === id)); renderPortfolio(data, true); output.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    catch (error) { status(error.message, true); }
  });
  form.addEventListener('input', () => stopMedia());
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (saving || !form.reportValidity()) return;
    if (!selected.length) { status('포트폴리오에 넣을 게시글을 선택해주세요.', true); return; }
    let data; try { data = values(); } catch (error) { status(error.message, true); return; }
    const version = epoch, request = sequence, currentEdit = editing;
    if (currentEdit) data.revision = currentEdit.revision; else data.creationKey = creationKey;
    saving = true; form.querySelectorAll('input,textarea,select,button').forEach(element => { element.disabled = true; }); save.textContent = '저장 중…'; status('');
    window.portfolioCareer.busyBuilder(true);
    try {
      const result = await read('/api/portfolios' + (currentEdit ? '/' + currentEdit.id : ''), { method: currentEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }, version);
      if (version !== epoch || request !== sequence) return;
      location.hash = 'portfolio/' + result.portfolio.id;
    } catch (error) { if (version === epoch && request === sequence) status(error.message, true); }
    finally { if (version === epoch && request === sequence) { saving = false; form.querySelectorAll('input,textarea,select,button').forEach(element => { element.disabled = false; }); window.portfolioCareer.busyBuilder(false); save.textContent = currentEdit ? '수정 내용 저장' : '만들기'; renderOrder(); } }
  });
})();
