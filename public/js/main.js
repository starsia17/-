const postGrid = document.querySelector('#postGrid');
const emptyState = document.querySelector('#emptyState');
const postCount = document.querySelector('#postCount');
const postForm = document.querySelector('#postForm');
const mediaInput = document.querySelector('#mediaInput');
const previewList = document.querySelector('#previewList');
const formMessage = document.querySelector('#formMessage');
const submitButton = document.querySelector('#submitButton');
const loginPanel = document.querySelector('#loginPanel');
const loginForm = document.querySelector('#loginForm');
const loginMessage = document.querySelector('#loginMessage');
const dialog = document.querySelector('#mediaDialog');
const dialogMedia = document.querySelector('#dialogMedia');
const dialogCaption = document.querySelector('#dialogCaption');

const MAX_FILES = 10;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']);
let posts = [];
let activeFilter = '전체';
let selectedFiles = [];
let objectUrls = [];
let dialogPost = null;
let dialogIndex = 0;
let isAdmin = false;

loadPosts();
refreshAdminStatus();

async function refreshAdminStatus() {
  try {
    const response = await fetch('/api/admin/status');
    const status = await response.json();
    isAdmin = status.authenticated;
    loginPanel.hidden = status.authenticated;
    postForm.hidden = !status.authenticated;
    renderPosts();
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
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || '로그인하지 못했습니다.');
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
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || '게시물을 불러오지 못했습니다.');
    posts = data.posts || [];
    document.querySelector('#loadError').hidden = true;
    renderPosts();
  } catch (error) {
    document.querySelector('#loadError').textContent = '게시물을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
    document.querySelector('#loadError').hidden = false;
    emptyState.hidden = true;
  }
}

function renderPosts() {
  const query = document.querySelector('#searchInput').value.trim().toLocaleLowerCase();
  const visiblePosts = posts.filter(post => {
    const categoryMatch = activeFilter === '전체' || post.category === activeFilter;
    const searchMatch = !query || `${post.title} ${post.description} ${post.category}`.toLocaleLowerCase().includes(query);
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
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = `media-tile media-count-${Math.min(post.media.length, 4)}`;
      tile.setAttribute('aria-label', `${post.title} 미디어 ${mediaIndex + 1} 보기`);
      if (item.type === 'video') {
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
      tile.addEventListener('click', () => openMedia(post, mediaIndex));
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
  title.textContent = post.title;
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
    deleteButton.textContent = '게시물 삭제';
    deleteButton.setAttribute('aria-label', `${post.title} 게시물 삭제`);
    deleteButton.addEventListener('click', () => deletePost(post, deleteButton));
    info.append(deleteButton);
  }
  card.append(media, info);
  return card;
}

async function deletePost(post, button) {
  const confirmed = window.confirm(`“${post.title}” 게시물과 첨부된 사진·동영상을 삭제할까요? 삭제 후에는 복구할 수 없습니다.`);
  if (!confirmed) return;
  button.disabled = true;
  button.textContent = '삭제 중…';
  const archiveMessage = document.querySelector('#archiveMessage');
  archiveMessage.hidden = true;
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(post._id)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || '게시물을 삭제하지 못했습니다.');
    posts = posts.filter(item => item._id !== post._id);
    renderPosts();
    archiveMessage.textContent = '게시물과 첨부 미디어를 삭제했습니다.';
    archiveMessage.classList.remove('notice-error');
    archiveMessage.hidden = false;
  } catch (error) {
    archiveMessage.textContent = error.message || '게시물을 삭제하지 못했습니다. 다시 시도해 주세요.';
    archiveMessage.classList.add('notice-error');
    archiveMessage.hidden = false;
    button.disabled = false;
    button.textContent = '게시물 삭제';
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function openMedia(post, startIndex) {
  dialogPost = post;
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

mediaInput.addEventListener('change', () => {
  addFiles(mediaInput.files);
  mediaInput.value = '';
});
const dropZone = document.querySelector('#dropZone');
dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
  addFiles(event.dataTransfer.files);
});

function addFiles(fileList) {
  const incoming = Array.from(fileList || []);
  const current = new Set(selectedFiles.map(file => `${file.name}:${file.size}:${file.lastModified}`));
  const invalid = incoming.find(file => !ALLOWED_TYPES.has(file.type));
  if (invalid) return showFormMessage(`${invalid.name}: 지원하지 않는 사진 또는 동영상 형식입니다.`, true);
  const oversized = incoming.find(file => file.size > MAX_FILE_SIZE);
  if (oversized) return showFormMessage(`${oversized.name}: 파일당 최대 크기는 50MB입니다.`, true);
  const additions = [];
  incoming.forEach(file => {
    const identity = `${file.name}:${file.size}:${file.lastModified}`;
    if (!current.has(identity)) { current.add(identity); additions.push(file); }
  });
  if (selectedFiles.length + additions.length > MAX_FILES) return showFormMessage('한 게시물에는 최대 10개까지 첨부할 수 있어요.', true);
  selectedFiles.push(...additions);
  clearFormMessage();
  renderPreviews();
}

function renderPreviews() {
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  previewList.replaceChildren();
  selectedFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    const url = URL.createObjectURL(file);
    objectUrls.push(url);
    const preview = file.type.startsWith('video/') ? document.createElement('video') : document.createElement('img');
    preview.src = url;
    if (preview.tagName === 'VIDEO') { preview.muted = true; preview.playsInline = true; }
    else preview.alt = '';
    const details = document.createElement('div');
    details.className = 'preview-details';
    const name = document.createElement('strong');
    name.textContent = file.name;
    const size = document.createElement('span');
    size.textContent = `${file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE'} · ${formatBytes(file.size)}`;
    details.append(name, size);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-file';
    remove.setAttribute('aria-label', `${file.name} 첨부 취소`);
    remove.textContent = '×';
    remove.addEventListener('click', () => { selectedFiles.splice(index, 1); renderPreviews(); });
    item.append(preview, details, remove);
    previewList.append(item);
  });
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

postForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!postForm.reportValidity()) return;
  const payload = new FormData();
  payload.set('title', document.querySelector('#titleInput').value.trim());
  payload.set('category', document.querySelector('#categoryInput').value);
  payload.set('description', document.querySelector('#descriptionInput').value.trim());
  selectedFiles.forEach(file => payload.append('media', file));
  submitButton.disabled = true;
  submitButton.querySelector('span:first-child').textContent = '게시물을 저장하고 있어요…';
  clearFormMessage();
  try {
    const response = await fetch('/api/posts', { method: 'POST', body: payload });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || '게시물을 저장하지 못했습니다.');
    posts.unshift(data.post);
    postForm.reset();
    selectedFiles = [];
    renderPreviews();
    activeFilter = '전체';
    document.querySelectorAll('.filter-chip').forEach(button => button.classList.toggle('active', button.dataset.filter === '전체'));
    document.querySelector('#searchInput').value = '';
    renderPosts();
    showFormMessage('작업이 아카이브에 등록됐어요.');
    document.querySelector('#work').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showFormMessage(error.message || '게시물을 저장하지 못했습니다. 다시 시도해 주세요.', true);
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector('span:first-child').textContent = '게시물 등록하기';
  }
});

function showFormMessage(message, isError = false) {
  formMessage.textContent = message;
  formMessage.classList.toggle('error', isError);
  formMessage.hidden = false;
}
function clearFormMessage() { formMessage.hidden = true; formMessage.textContent = ''; }

document.querySelector('#closeDialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => { dialogMedia.replaceChildren(); dialogPost = null; });

