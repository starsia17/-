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
  let printing = false, priorTitle = '';
  function cleanup() {
    document.querySelector('#careerPrintOutput')?.remove(); document.body.classList.remove('career-printing');
    if (printing) document.title = priorTitle; printing = false;
  }
  async function print(root, title) {
    if (printing) throw Error('인쇄 창을 닫은 뒤 다시 시도해주세요.');
    cleanup(); priorTitle = document.title; printing = true;
    const copy = root.cloneNode(true), container = node('div', undefined, 'career-print-output'); container.id = 'careerPrintOutput';
    copy.querySelectorAll('.curated-original').forEach(link => link.remove());
    copy.querySelectorAll('iframe,video').forEach(e => {
      const note = node('p', '영상은 웹 포트폴리오에서 확인해주세요.', 'pdf-media-note');
      if (e.tagName === 'IFRAME') { const a = node('a', '외부 영상 보기'); a.href = e.src; note.append(document.createTextNode(' '), a); }
      e.replaceWith(note);
    });
    copy.querySelectorAll('a[href]').forEach(a => { if (new URL(a.href, location.origin).pathname.startsWith('/api/media/')) { a.removeAttribute('href'); a.removeAttribute('download'); a.append(document.createTextNode(' · 웹에서 열기')); } });
    container.append(copy); document.body.append(container);
    try {
      const images = [...copy.querySelectorAll('img')]; images.forEach(img => { img.loading = 'eager'; });
      await Promise.race([Promise.all([document.fonts?.ready, ...images.map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); }))]), new Promise(resolve => setTimeout(resolve, 12000))]);
      if (!printing) return;
      document.title = title || '포트폴리브'; document.body.classList.add('career-printing'); window.print();
    } catch (error) { cleanup(); throw error; }
  }
  window.addEventListener('afterprint', cleanup);
  window.addEventListener('pagehide', cleanup);
  document.addEventListener('portfolio:auth', event => { if (!event.detail.user) cleanup(); });
  window.portfolioPresentation = { render, resumeCard, print, cleanup };
})();
