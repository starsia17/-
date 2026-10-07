(() => {
  const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  function embed(value) {
    let url; try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.replace(/^www\./, '');
    if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'youtu.be'].includes(host)) {
      const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})/)?.[1];
      return /^[\w-]{11}$/.test(id || '') ? 'https://www.youtube-nocookie.com/embed/' + id : null;
    }
    if (['vimeo.com', 'player.vimeo.com'].includes(host)) { const id = url.pathname.match(/\/(?:video\/)?(\d+)/)?.[1]; return id ? 'https://player.vimeo.com/video/' + id : null; }
    return null;
  }
  function body(post, root, mediaUrl) {
    const article = node('article', undefined, 'blog-article');
    if (post.bodyHtml) article.innerHTML = post.bodyHtml;
    else article.append(node('p', post.description || ''));
    const used = new Set(Array.from(article.querySelectorAll('[src],a[href]'), e => e.getAttribute('src') || e.getAttribute('href')));
    article.querySelectorAll('img[src],video[src],a[href]').forEach(e => {
      const attr = e.tagName === 'A' ? 'href' : 'src', value = e.getAttribute(attr);
      if (value?.startsWith('/api/media/')) e.setAttribute(attr, mediaUrl(value));
      if (e.tagName === 'IMG') e.loading = 'lazy';
      if (e.tagName === 'VIDEO') { e.controls = true; e.playsInline = true; e.preload = 'metadata'; }
    });
    article.querySelectorAll('a[href]').forEach(link => {
      const src = embed(link.href); if (!src) return;
      const figure = node('figure', undefined, 'external-video-embed'), frame = node('iframe');
      frame.src = src; frame.loading = 'lazy'; frame.title = '외부 동영상'; frame.referrerPolicy = 'no-referrer'; frame.allowFullscreen = true; figure.append(frame); link.replaceWith(figure);
    }); root.append(article);
    const media = node('div', undefined, 'detail-media-list');
    (post.media || []).filter(item => !used.has(item.url)).forEach(item => {
      const e = node(item.type === 'file' ? 'a' : item.type === 'video' ? 'video' : 'img');
      if (item.type === 'file') { e.href = mediaUrl(item.url); e.textContent = '↓ ' + (item.name || '첨부 파일'); e.className = 'detail-file-link'; }
      else { e.src = mediaUrl(item.url); if (item.type === 'video') { e.controls = true; e.playsInline = true; e.preload = 'metadata'; } else { e.alt = item.name || post.title; e.loading = 'lazy'; } }
      media.append(e);
    }); if (media.childElementCount) root.append(media);
  }
  function resumeCard(profile) {
    const section = node('section', undefined, 'career-resume'); section.append(node('p', 'PROFILE & RESUME', 'eyebrow'));
    if (profile.name) section.append(node('h2', profile.name));
    if (profile.role) section.append(node('p', profile.role, 'career-role'));
    const contact = node('div', undefined, 'career-contact');
    if (profile.email) { const a = node('a', profile.email); a.href = 'mailto:' + profile.email; contact.append(a); }
    if (profile.phone) contact.append(node('span', profile.phone));
    if (profile.website) { const a = node('a', profile.website); a.href = profile.website; a.target = '_blank'; a.rel = 'noopener noreferrer'; contact.append(a); }
    section.append(contact);
    if (profile.bodyHtml) { const article = node('article', undefined, 'blog-article'); article.innerHTML = profile.bodyHtml; section.append(article); }
    return section;
  }
  function render(data, mediaUrl = value => value, options = {}) {
    const posts = data.posts || [], images = posts.filter(post => post.media?.some(media => media.type === 'image')).length;
    const layout = data.layout === 'auto' ? images > 0 && images >= posts.length / 2 ? 'gallery' : 'story' : data.layout || 'story';
    const collection = node('div', undefined, 'curated-portfolio curated-' + layout), hero = node('header', undefined, 'curated-hero');
    hero.append(node('p', data.type === 'post' ? 'PROJECT ARCHIVE' : 'PERSONAL PORTFOLIO', 'eyebrow'), node('h1', data.title));
    if (data.introductionHtml) { const intro = node('article', undefined, 'blog-article curated-introduction'); intro.innerHTML = data.introductionHtml; hero.append(intro); }
    else if (data.introduction) hero.append(node('p', data.introduction, 'curated-introduction'));
    collection.append(hero);
    if (data.resume) collection.append(resumeCard(data.resume));
    if (data.unavailableCount) collection.append(node('p', '휴지통 또는 삭제된 작업 ' + data.unavailableCount + '개는 표시되지 않습니다.', 'portfolio-note'));
    const projects = node('div', undefined, 'curated-projects');
    const notes = new Map((data.projectNotes || []).map(note => [note.postId, note.bodyHtml]));
    posts.forEach((post, index) => {
      const section = node('section', undefined, 'curated-project'); section.append(node('p', String(index + 1).padStart(2, '0') + ' · ' + (post.category || '기타'), 'curated-project-meta'));
      if (data.type !== 'post') section.append(node('h2', post.title));
      const description = post.projectHtml || notes.get(post._id);
      if (description) { const article = node('article', undefined, 'blog-article career-project-description'); article.innerHTML = description; section.append(article); }
      body(post, section, mediaUrl);
      if (options.originalLinks && post._id) { const original = node('a', '원본 게시글 보기 ↗', 'curated-original'); original.href = '#post/' + post._id; section.append(original); }
      projects.append(section);
    });
    if (!posts.length && !data.resume) projects.append(node('p', '현재 표시할 작업이 없습니다.'));
    collection.append(projects); return collection;
  }
  let printWindow = null, generation = 0, identity = window.portfolioAuth?.user?.id || null;
  function cleanup() {
    generation++;
    if (printWindow && !printWindow.closed) { printWindow.document.body.replaceChildren(); printWindow.close(); }
    printWindow = null;
  }
  async function print(root, title) {
    // Open synchronously from the user's click. The editor and its selection
    // stay in the original document, including when printing is cancelled.
    cleanup();
    const popup = window.open('', '_blank');
    if (!popup) throw Error('인쇄 화면을 열 수 없습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러주세요.');
    printWindow = popup; const version = generation;
    popup.opener = null;
    const doc = popup.document;
    doc.open(); doc.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>포트폴리브</title></head><body></body></html>'); doc.close();
    const base = doc.createElement('base'); base.href = location.origin + '/'; doc.head.append(base);
    doc.title = title || '포트폴리브';
    const styles = [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => {
      // Loaded link/image clones can carry state from the editor's document.
      // Create fresh resource elements in the print document instead.
      const copy = doc.createElement('link'); copy.rel = 'stylesheet'; copy.href = link.href;
      const loaded = new Promise(resolve => { copy.onload = resolve; copy.onerror = resolve; }); doc.head.append(copy); return loaded;
    });
    const controls = node('div', undefined, 'career-print-controls'), button = node('button', 'PDF 저장 · 인쇄', 'career-primary'); button.type = 'button'; button.disabled = true;
    const message = node('p', '인쇄 문서를 준비하는 중…'); message.setAttribute('role', 'status');
    controls.append(button, message); doc.body.append(controls);
    const copy = doc.createElement(root.tagName), container = node('div', undefined, 'career-print-output'); container.id = 'careerPrintOutput';
    for (const attribute of root.attributes) copy.setAttribute(attribute.name, attribute.value);
    copy.innerHTML = root.innerHTML;
    copy.querySelectorAll('.curated-original').forEach(link => link.remove());
    copy.querySelectorAll('iframe,video').forEach(e => {
      const note = node('p', '영상은 웹 포트폴리오에서 확인해주세요.', 'pdf-media-note');
      if (e.tagName === 'IFRAME') { const a = node('a', '외부 영상 보기'); a.href = e.src; note.append(document.createTextNode(' '), a); }
      e.replaceWith(note);
    });
    copy.querySelectorAll('a[href]').forEach(a => { if (new URL(a.href, location.origin).pathname.startsWith('/api/media/')) { a.removeAttribute('href'); a.removeAttribute('download'); a.append(document.createTextNode(' · 웹에서 열기')); } });
    copy.querySelectorAll('[contenteditable]').forEach(e => e.removeAttribute('contenteditable'));
    container.append(copy); doc.body.append(container); doc.body.classList.add('career-print-document');
    try {
      const images = [...copy.querySelectorAll('img')]; images.forEach(img => { img.loading = 'eager'; });
      let timer;
      await Promise.race([Promise.all(styles).then(() => { copy.getBoundingClientRect(); return Promise.all([doc.fonts?.ready, ...images.map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); }))]); }), new Promise(resolve => { timer = setTimeout(resolve, 12000); })]);
      clearTimeout(timer);
      if (version !== generation || popup.closed) return;
      const missing = images.some(img => !img.complete || !img.naturalWidth);
      message.textContent = 'PDF 저장 · 인쇄를 눌러 대상에서 PDF 저장을 선택하세요. iPhone·iPad는 인쇄 미리보기를 확대한 뒤 공유 메뉴로 파일에 저장할 수 있어요.' + (missing ? ' 일부 이미지가 불러와지지 않았습니다. 연결 상태를 확인한 뒤 이 화면을 다시 열어주세요.' : '');
      button.disabled = false;
      const invoke = () => {
        if (version !== generation || popup.closed) return;
        if (typeof popup.print !== 'function') { message.textContent = '이 브라우저는 인쇄를 지원하지 않습니다. Safari 또는 Chrome에서 다시 열어주세요.'; return; }
        popup.focus(); popup.print();
      };
      button.addEventListener('click', invoke);
      // On phones keep the print button available as a fresh user gesture.
      if (!window.matchMedia('(max-width: 760px)').matches) invoke();
    } catch (error) { if (version === generation) cleanup(); throw error; }
  }
  window.addEventListener('pagehide', cleanup);
  document.addEventListener('portfolio:auth', event => {
    const next = event.detail.user?.id || null;
    if (next !== identity) { identity = next; cleanup(); }
  });
  window.portfolioPresentation = { render, resumeCard, print, cleanup };
})();
