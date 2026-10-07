(() => {
  const root = document.querySelector('#sharedOutput'), status = document.querySelector('#shareStatus'); let request = 0;
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
  function embed(value) {
    let url; try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'https:') return null; const host = url.hostname.replace(/^www\./, '');
    if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'youtu.be'].includes(host)) {
      const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})/)?.[1];
      return /^[\w-]{11}$/.test(id || '') ? 'https://www.youtube-nocookie.com/embed/' + id : null;
    }
    if (['vimeo.com', 'player.vimeo.com'].includes(host)) { const id = url.pathname.match(/\/(?:video\/)?(\d+)/)?.[1]; return id ? 'https://player.vimeo.com/video/' + id : null; } return null;
  }
  async function load() {
    const sequence = ++request; root.replaceChildren(); status.hidden = false; status.textContent = '공유된 작업을 불러오는 중입니다.';
    const token = location.hash.slice(1); if (!/^[\w-]{43}$/.test(token)) { status.textContent = '올바르지 않은 공유 주소입니다.'; return; }
    try {
      const response = await fetch('/api/shared/' + token, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }); const data = await response.json();
      if (sequence !== request) return; if (!response.ok || !data.success) throw Error(data.message || '공유된 작업을 확인할 수 없습니다.');
      const images = data.posts.filter(post => post.media.some(media => media.type === 'image')).length;
      const layout = data.layout === 'auto' ? images > 0 && images >= data.posts.length / 2 ? 'gallery' : 'story' : data.layout;
      const collection = node('div', undefined, 'curated-portfolio curated-' + layout), hero = node('header', undefined, 'curated-hero');
      hero.append(node('p', data.type === 'portfolio' ? 'SHARED PORTFOLIO' : 'SHARED PROJECT', 'eyebrow'), node('h1', data.title));
      if (data.introduction) hero.append(node('p', data.introduction, 'curated-introduction')); collection.append(hero);
      const projects = node('div', undefined, 'curated-projects');
      data.posts.forEach((post, index) => {
        const project = node('section', undefined, 'curated-project'); project.append(node('p', String(index + 1).padStart(2, '0') + ' · ' + post.category, 'curated-project-meta'));
        if (data.type === 'portfolio') project.append(node('h2', post.title));
        const article = node('article', undefined, 'blog-article');
        if (post.bodyHtml) article.innerHTML = post.bodyHtml; else article.append(node('p', post.description));
        const used = new Set(Array.from(article.querySelectorAll('[src],a[href]'), item => item.getAttribute('src') || item.getAttribute('href')));
        article.querySelectorAll('a[href]').forEach(link => { const src = embed(link.href); if (!src) return;
          const figure = node('figure', undefined, 'external-video-embed'), frame = node('iframe'); frame.src = src; frame.loading = 'lazy'; frame.title = '외부 동영상'; frame.referrerPolicy = 'no-referrer'; frame.allowFullscreen = true; figure.append(frame); link.replaceWith(figure);
        }); project.append(article);
        const mediaRoot = node('div', undefined, 'detail-media-list');
        post.media.filter(media => !used.has(media.url)).forEach(media => {
          const item = node(media.type === 'file' ? 'a' : media.type === 'video' ? 'video' : 'img');
          if (media.type === 'file') { item.href = media.url; item.textContent = '↓ ' + (media.name || '첨부 파일'); item.className = 'detail-file-link'; }
          else { item.src = media.url; if (media.type === 'video') { item.controls = true; item.playsInline = true; item.preload = 'metadata'; } else { item.alt = media.name || post.title; item.loading = 'lazy'; } }
          mediaRoot.append(item);
        }); project.append(mediaRoot); projects.append(project);
      });
      if (!data.posts.length) projects.append(node('p', '현재 표시할 작업이 없습니다.')); collection.append(projects); root.append(collection); status.hidden = true;
    } catch (error) { if (sequence === request) status.textContent = error.message; }
  }
  window.addEventListener('hashchange', load); load();
})();
