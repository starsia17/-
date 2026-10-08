(() => {
  const supported = value => {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (/^(www\.)?(youtube\.com|m\.youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)$/.test(u.hostname) || /\.(mp4|webm|mov)$/i.test(u.pathname)); } catch { return false; }
  };
  const blockOf = (editor, node) => { let block = node.nodeType === 1 ? node : node.parentElement; while (block && block.parentNode !== editor) block = block.parentElement; return block?.parentNode === editor ? block : null; };
  function normalize(editor) {
    let paragraph = null;
    for (const child of [...editor.childNodes]) {
      if (child.nodeType === 1 && /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|FIGURE|IMG|VIDEO)$/.test(child.tagName)) { paragraph = null; continue; }
      if (!paragraph) { paragraph = document.createElement('p'); editor.insertBefore(paragraph, child); }
      paragraph.append(child);
    }
  }
  function insert(editor, range, link) {
    range.deleteContents();
    const marker = document.createTextNode(''); range.insertNode(marker); normalize(editor); range.setStartBefore(marker); range.collapse(true); marker.remove();
    const figure = document.createElement('figure'); figure.dataset.externalVideo = 'true'; figure.style.textAlign = 'center'; figure.append(link);
    const block = blockOf(editor, range.startContainer);
    if (block && /^(P|DIV|H[1-3]|BLOCKQUOTE|UL|OL|LI)$/.test(block.tagName) && !block.matches('[data-external-video]')) {
      const tail = document.createRange(); tail.setStart(range.startContainer, range.startOffset); tail.setEnd(block, block.childNodes.length);
      const after = block.cloneNode(false); after.removeAttribute('id'); after.append(tail.extractContents()); if (!after.childNodes.length) after.append(document.createElement('br'));
      block.after(figure, after);
      if (!block.textContent.trim() && !block.querySelector('img,video,a')) block.remove();
      place(editor, after);
    } else { range.insertNode(figure); const after = document.createElement('p'); after.append(document.createElement('br')); figure.after(after); place(editor, after); }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function place(editor, block) { editor.focus(); const r = document.createRange(); r.selectNodeContents(block); r.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(r); }
  function mount(toolbar, editor) {
    if (toolbar.querySelector('[data-video-position]')) return;
    const panel = document.createElement('div'); panel.dataset.videoPosition = ''; panel.className = 'video-position-tools'; panel.contentEditable = 'false';
    const label = document.createElement('label'); label.textContent = '이동할 외부 동영상'; const select = document.createElement('select'); select.setAttribute('aria-label', '이동할 외부 동영상'); label.append(select); panel.append(label);
    const status = document.createElement('span'); status.setAttribute('aria-live', 'polite');
    let links = [], selected = null;
    const buttons = [];
    function refresh() {
      links = [...editor.querySelectorAll('a[href]')].filter(a => a.closest('figure[data-external-video="true"]') || supported(a.href));
      if (!links.includes(selected)) selected = links[0] || null;
      select.replaceChildren(); links.forEach((a, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${i + 1}. ${new URL(a.href).hostname}`; o.selected = a === selected; select.append(o); });
      select.disabled = !links.length; buttons.forEach(b => { b.disabled = !links.length || editor.contentEditable === 'false'; }); panel.hidden = !links.length;
    }
    function videoBlock() {
      if (!selected || !editor.contains(selected)) return null;
      normalize(editor);
      let figure = selected.closest('figure[data-external-video]');
      if (!figure) {
        const range = document.createRange(); range.selectNode(selected);
        insert(editor, range, selected);
        figure = selected.closest('figure[data-external-video]');
      }
      return figure;
    }
    const action = (text, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', () => { if (editor.contentEditable === 'false') return; const block = videoBlock(); if (!block) return; fn(block); editor.dispatchEvent(new Event('input', { bubbles: true })); refresh(); }); buttons.push(b); panel.append(b); };
    action('동영상 위로 이동', block => { const previous = block.previousElementSibling; if (previous) { previous.before(block); status.textContent = '동영상을 위로 이동했습니다.'; } });
    action('동영상 아래로 이동', block => { const next = block.nextElementSibling; if (next) { next.after(block); status.textContent = '동영상을 아래로 이동했습니다.'; } });
    [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']].forEach(([align, text]) => action('동영상 ' + text + ' 정렬', block => { block.style.textAlign = align; status.textContent = text + ' 정렬을 적용했습니다.'; }));
    panel.append(status); toolbar.after(panel); select.addEventListener('change', () => { selected = links[Number(select.value)]; });
    editor.addEventListener('input', refresh); editor.addEventListener('focusin', refresh);
    editor.addEventListener('click', event => { const link = event.target.closest('a'); if (links.includes(link)) { selected = link; refresh(); } });
    new MutationObserver(refresh).observe(editor, { childList: true, subtree: true }); refresh();
  }
  window.portfolioVideoPosition = { insert, mount };
})();
