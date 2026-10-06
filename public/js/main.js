const postGrid = document.querySelector('#postGrid');
const emptyState = document.querySelector('#emptyState');
const postCount = document.querySelector('#postCount');
const postForm = document.querySelector('#postForm');
const previewList = document.querySelector('#previewList');
const formMessage = document.querySelector('#formMessage');
const submitButton = document.querySelector('#submitButton');
const loginPanel = document.querySelector('#loginPanel');
const loginForm = document.querySelector('#loginForm');
const loginMessage = document.querySelector('#loginMessage');
const dialog = document.querySelector('#mediaDialog');
const dialogMedia = document.querySelector('#dialogMedia');
const dialogCaption = document.querySelector('#dialogCaption');
const editor = document.querySelector('#editor');
const detailView = document.querySelector('#postDetail');
const trashSection = document.querySelector('#trashSection');
const composerPage = document.querySelector('#write');
const trashList = document.querySelector('#trashList');
const trashBulkActions = document.querySelector('#trashBulkActions');
const selectAllTrash = document.querySelector('#selectAllTrash');
const trashSelectionCount = document.querySelector('#trashSelectionCount');
const restoreSelectedButton = document.querySelector('#restoreSelectedButton');

const MAX_FILES = 10;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
let posts = [];
let activeFilter = '전체';
const composerUploads = [];
const savedEditorRanges = new WeakMap();
const editorToolbars = new WeakMap();
let activeRichEditor = null;
let dialogPost = null;
let dialogIndex = 0;
let isAdmin = false;
let selectedTrashIds = new Set();

loadPosts();
refreshAdminStatus();

async function refreshAdminStatus() {
  try {
    const response = await fetch('/api/admin/status');
    const status = await response.json();
    isAdmin = status.authenticated;
    loginPanel.hidden = status.authenticated;
    postForm.hidden = !status.authenticated;
    document.querySelector('#trashNav').hidden = !status.authenticated;
    renderPosts();
    syncPageFromHash();
    if (!status.configured) {
      document.querySelector('#loginDescription').textContent = '서버 환경 변수 PORTFOLIO_ADMIN_PASSWORD와 ADMIN_SESSION_SECRET 설정이 필요합니다.';
      loginForm.hidden = true;
    }
  } catch {
    isAdmin = false;
    loginPanel.hidden = false;
    document.querySelector('#loginDescription').textContent = '관리자 로그인 상태를 확인하지 못했습니다. 페이지를 새로고침해 주세요.';
    loginForm.hidden = true;
  }
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const loginButton = document.querySelector('#loginButton');
  loginButton.disabled = true;
  loginMessage.hidden = true;
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.querySelector('#adminPassword').value })
    });
    const data = await readApiResponse(response);
    loginForm.reset();
    await refreshAdminStatus();
  } catch (error) {
    loginMessage.textContent = error.message;
    loginMessage.classList.add('error');
    loginMessage.hidden = false;
  } finally {
    loginButton.disabled = false;
  }
});

document.querySelector('#logoutButton').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  await refreshAdminStatus();
});

async function loadPosts() {
  try {
    const response = await fetch('/api/posts');
    const data = await readApiResponse(response);
    posts = data.posts || [];
    document.querySelector('#loadError').hidden = true;
    renderPosts();
    syncPageFromHash();
  } catch (error) {
    document.querySelector('#loadError').textContent = error.message || '게시물을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
    document.querySelector('#loadError').hidden = false;
    emptyState.hidden = true;
  }
}

function renderPosts() {
  const query = document.querySelector('#searchInput').value.trim().toLocaleLowerCase();
  const visiblePosts = posts.filter(post => {
    const categoryMatch = activeFilter === '전체' || post.category === activeFilter;
    const searchMatch = !query || `${post.title} ${post.description} ${plainText(post.bodyHtml)} ${post.category}`.toLocaleLowerCase().includes(query);
    return categoryMatch && searchMatch;
  });
  postGrid.replaceChildren();
  postCount.textContent = String(posts.length).padStart(2, '0');
  visiblePosts.forEach((post, index) => postGrid.append(createPostCard(post, index)));
  emptyState.hidden = visiblePosts.length > 0;
  if (visiblePosts.length === 0 && posts.length > 0) {
    emptyState.querySelector('h3').textContent = '검색 결과가 없어요';
    emptyState.querySelector('p').textContent = '다른 단어나 분류로 다시 찾아보세요.';
    emptyState.querySelector('.text-link').hidden = true;
  } else {
    emptyState.querySelector('h3').textContent = '아직 기록된 작업이 없어요';
    emptyState.querySelector('p').textContent = '첫 번째 작업을 올려 아카이브를 시작해 보세요.';
    emptyState.querySelector('.text-link').hidden = false;
  }
}

function createPostCard(post, index) {
  const card = document.createElement('article');
  card.className = 'post-card';
  card.style.setProperty('--card-delay', `${Math.min(index, 8) * 55}ms`);

  const media = document.createElement('div');
  media.className = 'post-media';
  if (post.media?.length) {
    post.media.slice(0, 4).forEach((item, mediaIndex) => {
      const tile = item.type === 'file' ? document.createElement('a') : document.createElement('button');
      if (item.type !== 'file') tile.type = 'button';
      tile.className = `media-tile media-count-${Math.min(post.media.length, 4)}`;
      if (item.type === 'file') {
        tile.classList.add('file-media-tile');
        tile.href = item.url;
        tile.setAttribute('aria-label', `${item.name || '첨부 파일'} 다운로드`);
        const icon = document.createElement('span'); icon.className = 'file-media-icon'; icon.textContent = '↓';
        const name = document.createElement('span'); name.className = 'file-media-name'; name.textContent = item.name || '첨부 파일';
        tile.append(icon, name);
      } else if (item.type === 'video') {
        tile.setAttribute('aria-label', `${post.title} 동영상 ${mediaIndex + 1} 보기`);
        const video = document.createElement('video');
        video.src = item.url;
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        tile.append(video);
        const play = document.createElement('span');
        play.className = 'video-indicator';
        play.textContent = '▶';
        tile.append(play);
      } else {
        tile.setAttribute('aria-label', `${post.title} 사진 ${mediaIndex + 1} 보기`);
        const image = document.createElement('img');
        image.src = item.url;
        image.alt = item.name || post.title;
        image.loading = 'lazy';
        tile.append(image);
      }
      if (mediaIndex === 3 && post.media.length > 4) {
        const more = document.createElement('span');
        more.className = 'media-more';
        more.textContent = `+${post.media.length - 4}`;
        tile.append(more);
      }
      if (item.type !== 'file') {
        const visualIndex = post.media.slice(0, mediaIndex).filter(mediaItem => mediaItem.type !== 'file').length;
        tile.addEventListener('click', () => openMedia(post, visualIndex));
      }
      media.append(tile);
    });
  } else {
    media.classList.add('post-media-empty');
    const motif = document.createElement('span');
    motif.className = 'empty-motif';
    motif.textContent = ['✳', '◒', '⌘', '✷'][index % 4];
    media.append(motif);
    const mediaLabel = document.createElement('span');
    mediaLabel.className = 'empty-media-label';
    mediaLabel.textContent = 'A NOTE FROM THE PROCESS';
    media.append(mediaLabel);
  }

  const info = document.createElement('div');
  info.className = 'post-info';
  const meta = document.createElement('div');
  meta.className = 'post-meta';
  const category = document.createElement('span');
  category.className = 'category-tag';
  category.textContent = post.category || '기타';
  const date = document.createElement('time');
  date.dateTime = post.createdAt;
  date.textContent = formatDate(post.createdAt);
  meta.append(category, date);
  const title = document.createElement('h3');
  const titleLink = document.createElement('a');
  titleLink.href = `#post/${post._id}`;
  titleLink.textContent = post.title;
  title.append(titleLink);
  info.append(meta, title);
  if (post.description) {
    const description = document.createElement('p');
    description.className = 'post-description';
    description.textContent = post.description;
    info.append(description);
  }
  if (post.media?.length) {
    const attachmentCount = document.createElement('span');
    attachmentCount.className = 'attachment-count';
    attachmentCount.textContent = `${String(post.media.length).padStart(2, '0')} ATTACHMENTS`;
    info.append(attachmentCount);
  }
  if (isAdmin) {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-post-button';
    deleteButton.textContent = '휴지통으로 이동';
    deleteButton.setAttribute('aria-label', `${post.title} 게시물 삭제`);
    deleteButton.addEventListener('click', () => deletePost(post, deleteButton));
    info.append(deleteButton);
  }
  card.append(media, info);
  return card;
}

async function deletePost(post, button) {
  const confirmed = window.confirm(`“${post.title}” 게시물을 휴지통으로 이동할까요? 30일 안에 복원할 수 있습니다.`);
  if (!confirmed) return;
  button.disabled = true;
  button.textContent = '삭제 중…';
  const archiveMessage = document.querySelector('#archiveMessage');
  archiveMessage.hidden = true;
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(post._id)}`, { method: 'DELETE' });
    await readApiResponse(response);
    posts = posts.filter(item => item._id !== post._id);
    renderPosts();
    archiveMessage.textContent = '게시물을 휴지통으로 이동했습니다. 30일 안에 복원할 수 있어요.';
    archiveMessage.classList.remove('notice-error');
    archiveMessage.hidden = false;
  } catch (error) {
    archiveMessage.textContent = error.message || '게시물을 삭제하지 못했습니다. 다시 시도해 주세요.';
    archiveMessage.classList.add('notice-error');
    archiveMessage.hidden = false;
    button.disabled = false;
    button.textContent = '휴지통으로 이동';
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function openMedia(post, startIndex) {
  dialogPost = { ...post, media: post.media.filter(item => item.type !== 'file') };
  dialogIndex = startIndex;
  renderDialogMedia();
  dialog.showModal();
}

function renderDialogMedia() {
  if (!dialogPost) return;
  const post = dialogPost;
  const startIndex = dialogIndex;
  const item = post.media[startIndex];
  if (!item) return;
  dialogMedia.replaceChildren();
  const media = item.type === 'video' ? document.createElement('video') : document.createElement('img');
  media.src = item.url;
  if (item.type === 'video') {
    media.controls = true;
    media.autoplay = true;
    media.playsInline = true;
  } else {
    media.alt = item.name || post.title;
  }
  dialogMedia.append(media);
  dialogCaption.textContent = `${post.title} · ${startIndex + 1} / ${post.media.length}`;
  document.querySelector('#previousMedia').disabled = post.media.length < 2;
  document.querySelector('#nextMedia').disabled = post.media.length < 2;
}

document.querySelector('#previousMedia').addEventListener('click', () => {
  if (!dialogPost?.media.length) return;
  dialogIndex = (dialogIndex - 1 + dialogPost.media.length) % dialogPost.media.length;
  renderDialogMedia();
});
document.querySelector('#nextMedia').addEventListener('click', () => {
  if (!dialogPost?.media.length) return;
  dialogIndex = (dialogIndex + 1) % dialogPost.media.length;
  renderDialogMedia();
});
dialog.addEventListener('keydown', event => {
  if (!dialogPost?.media.length) return;
  if (event.key === 'ArrowLeft') document.querySelector('#previousMedia').click();
  if (event.key === 'ArrowRight') document.querySelector('#nextMedia').click();
});

document.querySelectorAll('.filter-chip').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelector('.filter-chip.active')?.classList.remove('active');
    button.classList.add('active');
    activeFilter = button.dataset.filter;
    renderPosts();
  });
});
document.querySelector('#searchInput').addEventListener('input', renderPosts);

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (activeRichEditor && selection?.rangeCount && activeRichEditor.contains(selection.anchorNode)) {
    savedEditorRanges.set(activeRichEditor, selection.getRangeAt(0).cloneRange());
    syncEditorToolbar(activeRichEditor);
  }
});

function syncEditorToolbar(target) {
  const toolbar = editorToolbars.get(target);
  const range = savedEditorRanges.get(target);
  if (!toolbar || !range || toolbar.contains(document.activeElement)) return;
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!node || !target.contains(node)) node = target;
  const style = window.getComputedStyle(node);
  const size = toolbar.querySelector('[data-font-size]');
  const weight = toolbar.querySelector('[data-font-weight]');
  const family = toolbar.querySelector('[data-font-family]');
  if (size) size.value = String(Math.round(Number.parseFloat(style.fontSize)) || 16);
  if (weight) {
    const computedWeight = Number.parseInt(style.fontWeight, 10) || 400;
    weight.value = String([300, 400, 500, 600, 700, 800, 900].reduce((closest, value) =>
      Math.abs(value - computedWeight) < Math.abs(closest - computedWeight) ? value : closest, 300));
  }
  if (family) {
    const computedFamily = style.fontFamily.replace(/^["']|["']$/g, '').split(',')[0].trim();
    const match = Array.from(family.options).find(option => option.value.toLowerCase() === computedFamily.toLowerCase());
    if (match) family.value = match.value;
  }
}

function restoreEditorSelection(target) {
  const range = savedEditorRanges.get(target);
  if (!range || !target.contains(range.commonAncestorContainer)) return null;
  target.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

function styleSelection(target, property, value) {
  const range = restoreEditorSelection(target);
  if (!range || range.collapsed) return;
  const span = document.createElement('span');
  span.style[property] = value;
  span.append(range.extractContents());
  range.insertNode(span);
  const selection = window.getSelection();
  selection.removeAllRanges();
  const selected = document.createRange();
  selected.selectNodeContents(span);
  selection.addRange(selected);
  savedEditorRanges.set(target, selected.cloneRange());
}

function wireEditorToolbar(toolbar, target, queue, queueChanged, existingMediaCount = 0) {
  editorToolbars.set(target, toolbar);
  target.addEventListener('focusin', () => { activeRichEditor = target; });
  toolbar.addEventListener('mousedown', event => {
    if (event.target.closest('button')) event.preventDefault();
  });
  toolbar.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => {
    restoreEditorSelection(target);
    document.execCommand(button.dataset.command, false);
    target.focus();
  }));
  toolbar.querySelectorAll('[data-align]').forEach(button => button.addEventListener('click', () => {
    restoreEditorSelection(target);
    document.execCommand(`justify${button.dataset.align[0].toUpperCase()}${button.dataset.align.slice(1)}`, false);
    target.focus();
  }));
  toolbar.querySelector('[data-block="h2"]')?.addEventListener('click', () => {
    restoreEditorSelection(target);
    document.execCommand('formatBlock', false, 'h2');
    target.focus();
  });
  toolbar.querySelector('[data-font-family]')?.addEventListener('change', event => styleSelection(target, 'fontFamily', event.currentTarget.value));
  toolbar.querySelector('[data-font-weight]')?.addEventListener('change', event => styleSelection(target, 'fontWeight', event.currentTarget.value));
  const sizeInput = toolbar.querySelector('[data-font-size]');
  sizeInput?.addEventListener('input', event => {
    const input = event.currentTarget;
    const parsed = Number.parseInt(input.value, 10);
    if (!Number.isFinite(parsed) || parsed < 12 || parsed > 48) return;
    const size = parsed;
    styleSelection(target, 'fontSize', `${size}px`);
    input.dataset.appliedSize = String(size);
  });
  sizeInput?.addEventListener('change', event => {
    const input = event.currentTarget;
    const parsed = Number.parseInt(input.value, 10);
    const size = Math.min(48, Math.max(12, Number.isFinite(parsed) ? parsed : 16));
    input.value = String(size);
    if (input.dataset.appliedSize !== String(size)) styleSelection(target, 'fontSize', `${size}px`);
    delete input.dataset.appliedSize;
  });
  toolbar.querySelector('[data-font-color]')?.addEventListener('input', event => styleSelection(target, 'color', event.currentTarget.value));
  toolbar.querySelectorAll('[data-open-picker]').forEach(button => button.addEventListener('click', () => {
    toolbar.querySelector(`[data-file-input="${button.dataset.openPicker}"]`)?.click();
  }));
  toolbar.querySelectorAll('[data-file-input]').forEach(input => input.addEventListener('change', () => {
    queueInlineFiles(input.files, input.dataset.fileInput, target, queue, queueChanged, existingMediaCount);
    input.value = '';
  }));
}

function queueInlineFiles(fileList, pickerType, target, queue, queueChanged, existingMediaCount = 0) {
  const files = Array.from(fileList || []);
  const rejected = files.find(file => file.size > MAX_FILE_SIZE ||
    (pickerType === 'image' && !ALLOWED_IMAGE_TYPES.has(file.type)) ||
    (pickerType === 'video' && !ALLOWED_VIDEO_TYPES.has(file.type)));
  if (rejected) {
    showEditorFeedback(target, `${rejected.name}: ${rejected.size > MAX_FILE_SIZE ? '파일당 최대 크기는 50MB입니다.' : '지원하지 않는 형식입니다.'}`, true);
    return;
  }
  const duplicates = new Set(queue.map(item => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
  const additions = files.filter(file => {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (duplicates.has(key)) return false;
    duplicates.add(key); return true;
  });
  if (existingMediaCount + queue.length + additions.length > MAX_FILES) {
    showEditorFeedback(target, '한 게시물에는 최대 10개까지 첨부할 수 있어요.', true);
    return;
  }
  additions.forEach(file => {
    const type = ALLOWED_IMAGE_TYPES.has(file.type) ? 'image' : ALLOWED_VIDEO_TYPES.has(file.type) ? 'video' : 'file';
    const token = globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const value = Math.random() * 16 | 0; return (char === 'x' ? value : (value & 0x3 | 0x8)).toString(16);
    });
    const item = { file, token, type, element: null, previewUrl: type === 'file' ? '' : URL.createObjectURL(file) };
    item.element = makeInlineAttachment(item);
    insertNodeAtEditorSelection(target, item.element, type === 'file');
    queue.push(item);
  });
  showEditorFeedback(target, '', false);
  queueChanged();
}

function showEditorFeedback(target, text, isError) {
  if (target.closest('#postDetail')) {
    const message = detailView.querySelector('.inline-edit-message');
    if (message) { message.textContent = text; message.classList.toggle('notice-error', isError); message.hidden = !text; }
    return;
  }
  if (text) showFormMessage(text, isError); else clearFormMessage();
}

function makeInlineAttachment(item) {
  let node;
  if (item.type === 'image') {
    node = document.createElement('img');
    node.src = item.previewUrl; node.alt = item.file.name; node.loading = 'lazy'; node.className = 'inline-body-image';
  } else if (item.type === 'video') {
    node = document.createElement('video');
    node.src = item.previewUrl; node.controls = true; node.playsInline = true; node.preload = 'metadata'; node.className = 'inline-body-video';
  } else {
    node = document.createElement('a');
    node.href = '#'; node.textContent = `↓ ${item.file.name}`; node.className = 'inline-body-file';
    node.addEventListener('click', event => event.preventDefault());
  }
  node.dataset.uploadToken = item.token;
  node.dataset.originalName = item.file.name;
  return node;
}

function insertNodeAtEditorSelection(target, node, isFile) {
  target.focus();
  let range = savedEditorRanges.get(target);
  if (!range || !target.contains(range.commonAncestorContainer)) {
    range = document.createRange(); range.selectNodeContents(target); range.collapse(false);
  }
  range.deleteContents();
  range.insertNode(node);
  if (isFile) {
    const spacer = document.createTextNode('\u00a0');
    node.after(spacer);
    range.setStartAfter(spacer);
  } else {
    const lineBreak = document.createElement('br');
    node.after(lineBreak);
    range.setStartAfter(lineBreak);
  }
  range.collapse(true);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  savedEditorRanges.set(target, range.cloneRange());
  activeRichEditor = target;
}

function renderUploadQueue(container, queue, target) {
  container.replaceChildren();
  queue.forEach(item => {
    const row = document.createElement('div'); row.className = 'preview-item';
    if (item.type !== 'file') {
      const preview = item.type === 'video' ? document.createElement('video') : document.createElement('img');
      preview.src = item.previewUrl;
      if (item.type === 'video') { preview.muted = true; preview.playsInline = true; }
      else preview.alt = '';
      row.append(preview);
    } else {
      const icon = document.createElement('span'); icon.className = 'queued-file-icon'; icon.textContent = 'FILE'; row.append(icon);
    }
    const details = document.createElement('div'); details.className = 'preview-details';
    const name = document.createElement('strong'); name.textContent = item.file.name;
    const size = document.createElement('span'); size.textContent = `${item.type.toUpperCase()} · ${formatBytes(item.file.size)}`;
    details.append(name, size);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-file'; remove.setAttribute('aria-label', `${item.file.name} 첨부 취소`); remove.textContent = '×';
    remove.addEventListener('click', () => {
      item.element.remove();
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      queue.splice(queue.indexOf(item), 1);
      renderUploadQueue(container, queue, target);
    });
    row.append(details, remove); container.append(row);
  });
}

function renderPreviews() { renderUploadQueue(previewList, composerUploads, editor); }
function clearUploadQueue(queue) {
  queue.forEach(item => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
  queue.length = 0;
}
wireEditorToolbar(document.querySelector('#composerToolbar'), editor, composerUploads, renderPreviews);

window.addEventListener('hashchange', syncPageFromHash);
syncPageFromHash();

function syncPageFromHash() {
  const hash = decodeURIComponent(location.hash.slice(1));
  const isDetail = hash.startsWith('post/');
  const isTrash = hash === 'trash';
  const isComposer = hash === 'write';
  document.querySelectorAll('main > section:not(.page-view)').forEach(section => { section.hidden = isDetail || isTrash || isComposer; });
  detailView.hidden = !isDetail;
  trashSection.hidden = !isTrash;
  composerPage.hidden = !isComposer;
  if (isComposer) requestAnimationFrame(() => composerPage.scrollIntoView({ block: 'start' }));
  if (isDetail) loadPostDetail(hash.slice('post/'.length));
  if (isTrash) loadTrash();
}

async function loadPostDetail(id) {
  detailView.replaceChildren();
  const cached = posts.find(post => post._id === id);
  try {
    let post = cached;
    if (!post) {
      const response = await fetch(`/api/posts/${encodeURIComponent(id)}`);
      const data = await readApiResponse(response);
      post = data.post;
    }
    if (location.hash !== `#post/${id}`) return;
    const back = document.createElement('a');
    back.href = '#work'; back.className = 'detail-back'; back.textContent = '← 작업 아카이브';
    const meta = document.createElement('div'); meta.className = 'post-meta detail-meta';
    const category = document.createElement('span'); category.className = 'category-tag'; category.textContent = post.category || '기타';
    const categoryEditor = document.createElement('select'); categoryEditor.className = 'detail-category-editor'; categoryEditor.setAttribute('aria-label', '게시물 분류');
    ['디자인', '사진', '영상', '개발', '기타'].forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value; categoryEditor.append(option); });
    categoryEditor.value = post.category || '기타'; categoryEditor.hidden = true;
    const date = document.createElement('time'); date.dateTime = post.createdAt; date.textContent = formatDate(post.createdAt);
    meta.append(category, categoryEditor, date);
    const title = document.createElement('h1'); title.className = 'detail-title'; title.textContent = post.title;
    const article = document.createElement('article'); article.className = 'blog-article';
    if (post.bodyHtml) article.innerHTML = post.bodyHtml;
    else if (post.description) { const paragraph = document.createElement('p'); paragraph.textContent = post.description; article.append(paragraph); }
    const media = document.createElement('div'); media.className = 'detail-media-list';
    const bodyTemplate = document.createElement('template'); bodyTemplate.innerHTML = post.bodyHtml || '';
    const embeddedUrls = new Set(Array.from(bodyTemplate.content.querySelectorAll('img[src],video[src],a[href]'), node => node.getAttribute('src') || node.getAttribute('href')));
    (post.media || []).filter(item => !embeddedUrls.has(item.url)).forEach(item => {
      if (item.type === 'file') {
        const link = document.createElement('a'); link.className = 'detail-file-link'; link.href = item.url; link.textContent = `↓ ${item.name || '첨부 파일 다운로드'}`; media.append(link); return;
      }
      const node = item.type === 'video' ? document.createElement('video') : document.createElement('img');
      node.src = item.url;
      if (item.type === 'video') { node.controls = true; node.playsInline = true; }
      else { node.alt = item.name || post.title; node.loading = 'lazy'; }
      media.append(node);
    });
    detailView.append(back, meta, title);
    if (media.childElementCount) detailView.append(media);
    detailView.append(article);
    if (isAdmin) {
      const actions = document.createElement('div'); actions.className = 'detail-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'edit-post-button'; edit.textContent = '게시물 수정';
      edit.addEventListener('click', () => beginInlinePostEdit(post, { title, category, categoryEditor, article }));
      actions.append(edit);
      const remove = document.createElement('button'); remove.className = 'delete-post-button'; remove.textContent = '휴지통으로 이동';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`“${post.title}” 게시물을 휴지통으로 이동할까요? 30일 안에 복원할 수 있습니다.`)) return;
        try {
          const response = await fetch(`/api/posts/${encodeURIComponent(post._id)}`, { method: 'DELETE' });
          await readApiResponse(response);
          location.hash = 'work'; loadPosts();
        } catch (error) { window.alert(error.message || '게시물을 이동하지 못했습니다.'); }
      });
      actions.append(remove);
      detailView.append(actions);
    }
  } catch (error) {
    const message = document.createElement('p'); message.className = 'notice notice-error'; message.textContent = error.message;
    const back = document.createElement('a'); back.href = '#work'; back.className = 'detail-back'; back.textContent = '← 작업 아카이브';
    detailView.append(back, message);
  }
}

function beginInlinePostEdit(post, elements) {
  if (!isAdmin) return;
  const queue = [];
  const toolbar = document.querySelector('#composerToolbar').cloneNode(true);
  toolbar.removeAttribute('id'); toolbar.classList.add('detail-editor-toolbar');
  elements.title.contentEditable = 'true'; elements.title.classList.add('title-editing');
  elements.title.setAttribute('role', 'textbox'); elements.title.setAttribute('aria-label', '게시물 제목');
  elements.category.hidden = true; elements.categoryEditor.hidden = false;
  elements.article.contentEditable = 'true'; elements.article.setAttribute('role', 'textbox'); elements.article.setAttribute('aria-label', '게시물 본문 편집');
  elements.article.classList.add('article-editing');
  const queuePanel = document.createElement('div'); queuePanel.className = 'preview-list inline-edit-uploads';
  const message = document.createElement('p'); message.className = 'inline-edit-message'; message.hidden = true; message.setAttribute('role', 'status');
  const actions = document.createElement('div'); actions.className = 'inline-edit-actions';
  const save = document.createElement('button'); save.type = 'button'; save.className = 'edit-post-button'; save.textContent = '수정 내용 저장';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'cancel-edit-button'; cancel.textContent = '취소';
  actions.append(save, cancel);
  elements.article.before(toolbar);
  elements.article.after(queuePanel, message, actions);
  const updateQueue = () => renderUploadQueue(queuePanel, queue, elements.article);
  wireEditorToolbar(toolbar, elements.article, queue, updateQueue, (post.media || []).length);
  activeRichEditor = elements.article;
  save.addEventListener('click', () => saveInlinePostEdit(post, elements, queue, save, cancel, message));
  cancel.addEventListener('click', () => {
    clearUploadQueue(queue);
    loadPostDetail(post._id);
  });
  elements.article.focus({ preventScroll: true });
}

async function saveInlinePostEdit(post, elements, queue, saveButton, cancelButton, message) {
  const title = elements.title.innerText.trim();
  const bodyText = elements.article.innerText.trim();
  if (!title) { message.textContent = '게시물 제목을 입력해주세요.'; message.hidden = false; return; }
  if (bodyText.length > 5000 || elements.article.innerHTML.length > 30000) { message.textContent = '본문은 5,000자까지 작성할 수 있어요.'; message.hidden = false; return; }
  const form = new FormData();
  form.set('title', title); form.set('category', elements.categoryEditor.value); form.set('bodyHtml', elements.article.innerHTML);
  form.set('inlineMedia', JSON.stringify(queue.map(item => ({ token: item.token }))));
  queue.forEach(item => form.append('media', item.file));
  saveButton.disabled = true; cancelButton.disabled = true; saveButton.textContent = '저장 중…'; message.hidden = true;
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(post._id)}`, { method: 'PUT', body: form });
    const data = await readApiResponse(response);
    if (!response.ok || !data.success) throw new Error(data.message || '게시물을 수정하지 못했습니다.');
    const index = posts.findIndex(item => item._id === data.post._id);
    if (index >= 0) posts[index] = data.post; else posts.unshift(data.post);
    clearUploadQueue(queue);
    renderPosts();
    loadPostDetail(data.post._id);
  } catch (error) {
    message.textContent = error.message || '게시물을 수정하지 못했습니다.'; message.hidden = false;
    saveButton.disabled = false; cancelButton.disabled = false; saveButton.textContent = '수정 내용 저장';
  }
}

async function loadTrash() {
  trashList.replaceChildren();
  selectedTrashIds = new Set();
  selectAllTrash.checked = false;
  selectAllTrash.indeterminate = false;
  trashBulkActions.hidden = true;
  updateTrashSelection(0);
  document.querySelector('#trashEmpty').hidden = true;
  if (!isAdmin) {
    trashList.textContent = '휴지통은 관리자 로그인 후 확인할 수 있습니다.';
    return;
  }
  try {
    const response = await fetch('/api/trash');
    const data = await readApiResponse(response);
    trashBulkActions.hidden = data.posts.length === 0;
    data.posts.forEach(post => {
      const row = document.createElement('article'); row.className = 'trash-row';
      const selection = document.createElement('label'); selection.className = 'trash-select-label';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'trash-select';
      checkbox.value = post._id; checkbox.setAttribute('aria-label', `게시물 ${post.title} 선택`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedTrashIds.add(post._id);
        else selectedTrashIds.delete(post._id);
        updateTrashSelection(data.posts.length);
      });
      selection.append(checkbox);
      const info = document.createElement('div'); info.className = 'trash-row-info';
      const title = document.createElement('strong'); title.textContent = post.title;
      const expiration = document.createElement('span');
      const days = Math.max(0, Math.ceil((new Date(post.expiresAt) - Date.now()) / 86400000));
      expiration.textContent = `${formatDate(post.deletedAt)} 삭제 · ${days}일 후 영구 삭제`;
      info.append(title, expiration);
      const summary = document.createElement('div'); summary.className = 'trash-row-summary';
      summary.append(selection, info);
      const actions = document.createElement('div'); actions.className = 'trash-actions';
      const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'restore-button'; restore.textContent = '복원';
      restore.addEventListener('click', () => restorePost(post));
      const erase = document.createElement('button'); erase.type = 'button'; erase.className = 'purge-button'; erase.textContent = '완전히 삭제';
      erase.addEventListener('click', () => permanentlyDeletePost(post));
      actions.append(restore, erase); row.append(summary, actions); trashList.append(row);
    });
    updateTrashSelection(data.posts.length);
    document.querySelector('#trashEmpty').hidden = data.posts.length > 0;
  } catch (error) {
    const message = document.querySelector('#trashMessage'); message.textContent = error.message; message.hidden = false;
  }
}

function updateTrashSelection(total) {
  const selected = selectedTrashIds.size;
  trashSelectionCount.textContent = selected ? `선택된 게시물 ${selected}개` : '선택된 게시물 없음';
  restoreSelectedButton.disabled = selected === 0;
  restoreSelectedButton.textContent = selected ? `선택한 게시물 ${selected}개 복원` : '선택한 게시물 복원';
  selectAllTrash.checked = total > 0 && selected === total;
  selectAllTrash.indeterminate = selected > 0 && selected < total;
}

selectAllTrash.addEventListener('change', () => {
  const checkboxes = trashList.querySelectorAll('.trash-select');
  selectedTrashIds = new Set(selectAllTrash.checked ? Array.from(checkboxes, checkbox => checkbox.value) : []);
  checkboxes.forEach(checkbox => { checkbox.checked = selectAllTrash.checked; });
  updateTrashSelection(checkboxes.length);
});

restoreSelectedButton.addEventListener('click', restoreSelectedPosts);

async function restoreSelectedPosts() {
  const ids = Array.from(selectedTrashIds);
  if (!ids.length) return;
  restoreSelectedButton.disabled = true;
  try {
    let restored = 0;
    for (let index = 0; index < ids.length; index += 100) {
      const response = await fetch('/api/trash/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids.slice(index, index + 100) })
      });
      const data = await readApiResponse(response);
      restored += data.restored;
    }
    const message = document.querySelector('#trashMessage');
    message.textContent = `${restored}개 게시물을 원래 내용과 함께 홈에 복원했습니다.`;
    message.hidden = false;
    await Promise.all([loadTrash(), loadPosts()]);
  } catch (error) {
    window.alert(error.message || '게시물을 복원하지 못했습니다.');
    restoreSelectedButton.disabled = false;
  }
}

async function restorePost(post) {
  try {
    const response = await fetch(`/api/trash/${encodeURIComponent(post._id)}/restore`, { method: 'POST' });
    await readApiResponse(response);
    document.querySelector('#trashMessage').textContent = '게시물을 복원했습니다.';
    document.querySelector('#trashMessage').hidden = false;
    await Promise.all([loadTrash(), loadPosts()]);
  } catch (error) { window.alert(error.message || '복원하지 못했습니다.'); }
}

async function permanentlyDeletePost(post) {
  if (!window.confirm(`“${post.title}” 게시물과 첨부 파일을 완전히 삭제할까요? 복구할 수 없습니다.`)) return;
  try {
    const response = await fetch(`/api/trash/${encodeURIComponent(post._id)}`, { method: 'DELETE' });
    await readApiResponse(response);
    await loadTrash();
  } catch (error) { window.alert(error.message || '완전히 삭제하지 못했습니다.'); }
}

function plainText(html) {
  const element = document.createElement('div'); element.innerHTML = html || ''; return element.textContent || '';
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

postForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!postForm.reportValidity()) return;
  const bodyText = editor.innerText.trim();
  if (bodyText.length > 5000) return showFormMessage('본문은 5,000자까지 작성할 수 있어요.', true);
  const payload = new FormData();
  payload.set('title', document.querySelector('#titleInput').value.trim());
  payload.set('category', document.querySelector('#categoryInput').value);
  payload.set('bodyHtml', editor.innerHTML);
  payload.set('inlineMedia', JSON.stringify(composerUploads.map(item => ({ token: item.token }))));
  composerUploads.forEach(item => payload.append('media', item.file));
  submitButton.disabled = true;
  document.querySelector('#submitButtonLabel').textContent = '게시물을 저장하고 있어요…';
  clearFormMessage();
  try {
    const response = await fetch('/api/posts', { method: 'POST', body: payload });
    const data = await readApiResponse(response);
    if (!response.ok || !data.success) throw new Error(data.message || '게시물을 저장하지 못했습니다.');
    posts.unshift(data.post);
    postForm.reset();
    editor.innerHTML = '';
    savedEditorRanges.delete(editor);
    activeRichEditor = null;
    clearUploadQueue(composerUploads);
    renderPreviews();
    document.querySelector('#submitButtonLabel').textContent = '게시물 등록하기';
    activeFilter = '전체';
    document.querySelectorAll('.filter-chip').forEach(button => button.classList.toggle('active', button.dataset.filter === '전체'));
    document.querySelector('#searchInput').value = '';
    renderPosts();
    location.hash = `post/${data.post._id}`;
  } catch (error) {
    showFormMessage(error.message || '게시물을 저장하지 못했습니다. 다시 시도해 주세요.', true);
  } finally {
    submitButton.disabled = false;
    document.querySelector('#submitButtonLabel').textContent = '게시물 등록하기';
  }
});

function showFormMessage(message, isError = false) {
  formMessage.textContent = message;
  formMessage.classList.toggle('error', isError);
  formMessage.hidden = false;
}
async function readApiResponse(response) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(text.trim().slice(0, 240) || `서버 응답을 읽지 못했습니다. (HTTP ${response.status})`); }
  if (!response.ok || data.success === false) {
    const error = new Error(data.message || `요청을 처리하지 못했습니다. (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}
function clearFormMessage() { formMessage.hidden = true; formMessage.textContent = ''; }

document.querySelector('#closeDialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => { dialogMedia.replaceChildren(); dialogPost = null; });

