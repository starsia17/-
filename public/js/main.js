const postGrid = document.querySelector('#postGrid');
const emptyState = document.querySelector('#emptyState');
const postCount = document.querySelector('#postCount');
const postForm = document.querySelector('#postForm');
const imageInput = document.querySelector('#imageInput');
const videoInput = document.querySelector('#videoInput');
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
const trashList = document.querySelector('#trashList');
const trashBulkActions = document.querySelector('#trashBulkActions');
const selectAllTrash = document.querySelector('#selectAllTrash');
const trashSelectionCount = document.querySelector('#trashSelectionCount');
const restoreSelectedButton = document.querySelector('#restoreSelectedButton');

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
let selectedTrashIds = new Set();
let editingPostId = null;

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
    syncPageFromHash();
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
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || '게시물을 삭제하지 못했습니다.');
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

let savedEditorRange = null;
document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (selection?.rangeCount && editor.contains(selection.anchorNode)) savedEditorRange = selection.getRangeAt(0).cloneRange();
});
function restoreEditorSelection() {
  if (!savedEditorRange || !editor.contains(savedEditorRange.commonAncestorContainer)) return;
  editor.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedEditorRange);
}
function styleSelection(property, value) {
  restoreEditorSelection();
  if (!savedEditorRange || savedEditorRange.collapsed) return;
  const span = document.createElement('span');
  span.style[property] = value;
  span.append(savedEditorRange.extractContents());
  savedEditorRange.insertNode(span);
  const selection = window.getSelection();
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(span);
  selection.addRange(range);
  savedEditorRange = range.cloneRange();
}
const editorToolbar = document.querySelector('.editor-toolbar');
editorToolbar.addEventListener('mousedown', event => {
  if (event.target.closest('button')) event.preventDefault();
});
editorToolbar.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => {
  restoreEditorSelection();
  document.execCommand(button.dataset.command, false);
  editor.focus();
}));
editorToolbar.querySelectorAll('[data-align]').forEach(button => button.addEventListener('click', () => {
  restoreEditorSelection();
  document.execCommand(`justify${button.dataset.align[0].toUpperCase()}${button.dataset.align.slice(1)}`, false);
  editor.focus();
}));
document.querySelector('[data-block="h2"]').addEventListener('click', () => {
  restoreEditorSelection();
  document.execCommand('formatBlock', false, 'h2');
  editor.focus();
});
document.querySelector('#fontFamily').addEventListener('change', event => styleSelection('fontFamily', event.target.value));
document.querySelector('#fontSize').addEventListener('change', event => {
  const input = event.currentTarget;
  const size = Math.min(48, Math.max(12, Number.parseInt(input.value, 10) || 16));
  input.value = String(size);
  styleSelection('fontSize', `${size}px`);
});
document.querySelector('#fontColor').addEventListener('input', event => styleSelection('color', event.target.value));

window.addEventListener('hashchange', syncPageFromHash);
syncPageFromHash();

function syncPageFromHash() {
  const hash = decodeURIComponent(location.hash.slice(1));
  const isDetail = hash.startsWith('post/');
  const isTrash = hash === 'trash';
  document.querySelectorAll('main > section:not(.page-view)').forEach(section => { section.hidden = isDetail || isTrash; });
  detailView.hidden = !isDetail;
  trashSection.hidden = !isTrash;
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
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || '게시물을 찾을 수 없습니다.');
      post = data.post;
    }
    if (location.hash !== `#post/${id}`) return;
    const back = document.createElement('a');
    back.href = '#work'; back.className = 'detail-back'; back.textContent = '← 작업 아카이브';
    const meta = document.createElement('div'); meta.className = 'post-meta detail-meta';
    const category = document.createElement('span'); category.className = 'category-tag'; category.textContent = post.category || '기타';
    const date = document.createElement('time'); date.dateTime = post.createdAt; date.textContent = formatDate(post.createdAt);
    meta.append(category, date);
    const title = document.createElement('h1'); title.className = 'detail-title'; title.textContent = post.title;
    const article = document.createElement('article'); article.className = 'blog-article';
    if (post.bodyHtml) article.innerHTML = post.bodyHtml;
    else if (post.description) { const paragraph = document.createElement('p'); paragraph.textContent = post.description; article.append(paragraph); }
    const media = document.createElement('div'); media.className = 'detail-media-list';
    (post.media || []).forEach(item => {
      const node = item.type === 'video' ? document.createElement('video') : document.createElement('img');
      node.src = item.url;
      if (item.type === 'video') { node.controls = true; node.playsInline = true; }
      else { node.alt = item.name || post.title; node.loading = 'lazy'; }
      media.append(node);
    });
    detailView.append(back, meta, title, media, article);
    if (isAdmin) {
      const actions = document.createElement('div'); actions.className = 'detail-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'edit-post-button'; edit.textContent = '게시물 수정';
      edit.addEventListener('click', () => beginPostEdit(post));
      actions.append(edit);
      const remove = document.createElement('button'); remove.className = 'delete-post-button'; remove.textContent = '휴지통으로 이동';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`“${post.title}” 게시물을 휴지통으로 이동할까요? 30일 안에 복원할 수 있습니다.`)) return;
        try {
          const response = await fetch(`/api/posts/${encodeURIComponent(post._id)}`, { method: 'DELETE' });
          const data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.message || '게시물을 이동하지 못했습니다.');
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

function beginPostEdit(post) {
  if (!isAdmin) return;
  editingPostId = post._id;
  postForm.reset();
  document.querySelector('#titleInput').value = post.title || '';
  document.querySelector('#categoryInput').value = post.category || '기타';
  editor.innerHTML = post.bodyHtml || '';
  if (!post.bodyHtml && post.description) {
    const paragraph = document.createElement('p'); paragraph.textContent = post.description; editor.append(paragraph);
  }
  savedEditorRange = null;
  selectedFiles = [];
  renderPreviews();
  clearFormMessage();
  const existingMediaNotice = document.querySelector('#existingMediaNotice');
  const mediaCount = (post.media || []).length;
  existingMediaNotice.textContent = mediaCount ? `기존 첨부 파일 ${mediaCount}개는 그대로 유지됩니다. 새 파일을 추가로 첨부할 수도 있어요.` : '';
  existingMediaNotice.hidden = mediaCount === 0;
  document.querySelector('#writeModeLabel').textContent = 'EDIT PROJECT ENTRY';
  document.querySelector('#submitButtonLabel').textContent = '수정 사항 저장';
  document.querySelector('#cancelEditButton').hidden = false;
  location.hash = 'write';
  window.setTimeout(() => document.querySelector('#titleInput').focus({ preventScroll: true }), 0);
}

document.querySelector('#cancelEditButton').addEventListener('click', () => {
  const postId = editingPostId;
  editingPostId = null;
  postForm.reset();
  editor.replaceChildren();
  savedEditorRange = null;
  selectedFiles = [];
  renderPreviews();
  document.querySelector('#existingMediaNotice').hidden = true;
  document.querySelector('#writeModeLabel').textContent = 'NEW PROJECT ENTRY';
  document.querySelector('#submitButtonLabel').textContent = '게시물 등록하기';
  document.querySelector('#cancelEditButton').hidden = true;
  clearFormMessage();
  location.hash = postId ? `post/${postId}` : 'write';
});

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
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || '휴지통을 불러오지 못했습니다.');
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
    const response = await fetch('/api/trash/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || '게시물을 복원하지 못했습니다.');
    const message = document.querySelector('#trashMessage');
    message.textContent = `${data.restored}개 게시물을 원래 내용과 함께 홈에 복원했습니다.`;
    message.hidden = false;
    await Promise.all([loadTrash(), loadPosts()]);
  } catch (error) {
    window.alert(error.message || '게시물을 복원하지 못했습니다.');
    restoreSelectedButton.disabled = false;
  }
}

async function restorePost(post) {
  const response = await fetch(`/api/trash/${encodeURIComponent(post._id)}/restore`, { method: 'POST' });
  const data = await response.json();
  if (!response.ok || !data.success) { window.alert(data.message || '복원하지 못했습니다.'); return; }
  document.querySelector('#trashMessage').textContent = '게시물을 복원했습니다.';
  document.querySelector('#trashMessage').hidden = false;
  await Promise.all([loadTrash(), loadPosts()]);
}

async function permanentlyDeletePost(post) {
  if (!window.confirm(`“${post.title}” 게시물과 첨부 파일을 완전히 삭제할까요? 복구할 수 없습니다.`)) return;
  const response = await fetch(`/api/trash/${encodeURIComponent(post._id)}`, { method: 'DELETE' });
  const data = await response.json();
  if (!response.ok || !data.success) { window.alert(data.message || '완전히 삭제하지 못했습니다.'); return; }
  await loadTrash();
}

function plainText(html) {
  const element = document.createElement('div'); element.innerHTML = html || ''; return element.textContent || '';
}

document.querySelector('#chooseImages').addEventListener('click', () => imageInput.click());
document.querySelector('#chooseVideos').addEventListener('click', () => videoInput.click());
[[imageInput, 'image/'], [videoInput, 'video/']].forEach(([input, expectedType]) => {
  input.addEventListener('change', () => {
    addFiles(input.files, expectedType);
    input.value = '';
  });
});
const dropZone = document.querySelector('#dropZone');
dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
  addFiles(event.dataTransfer.files);
});

function addFiles(fileList, expectedType = '') {
  const incoming = Array.from(fileList || []);
  const current = new Set(selectedFiles.map(file => `${file.name}:${file.size}:${file.lastModified}`));
  const invalid = incoming.find(file => !ALLOWED_TYPES.has(file.type) || (expectedType && !file.type.startsWith(expectedType)));
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
  const isEditing = Boolean(editingPostId);
  const postId = editingPostId;
  const bodyText = editor.innerText.trim();
  if (bodyText.length > 5000) return showFormMessage('본문은 5,000자까지 작성할 수 있어요.', true);
  const payload = new FormData();
  payload.set('title', document.querySelector('#titleInput').value.trim());
  payload.set('category', document.querySelector('#categoryInput').value);
  payload.set('bodyHtml', editor.innerHTML);
  selectedFiles.forEach(file => payload.append('media', file));
  submitButton.disabled = true;
  document.querySelector('#submitButtonLabel').textContent = '게시물을 저장하고 있어요…';
  clearFormMessage();
  try {
    const response = await fetch(isEditing ? `/api/posts/${encodeURIComponent(postId)}` : '/api/posts', { method: isEditing ? 'PUT' : 'POST', body: payload });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || (isEditing ? '게시물을 수정하지 못했습니다.' : '게시물을 저장하지 못했습니다.'));
    if (isEditing) {
      const index = posts.findIndex(post => post._id === data.post._id);
      if (index >= 0) posts[index] = data.post;
      else posts.unshift(data.post);
      editingPostId = null;
    } else posts.unshift(data.post);
    postForm.reset();
    editor.innerHTML = '';
    savedEditorRange = null;
    selectedFiles = [];
    renderPreviews();
    document.querySelector('#existingMediaNotice').hidden = true;
    document.querySelector('#writeModeLabel').textContent = 'NEW PROJECT ENTRY';
    document.querySelector('#submitButtonLabel').textContent = '게시물 등록하기';
    document.querySelector('#cancelEditButton').hidden = true;
    activeFilter = '전체';
    document.querySelectorAll('.filter-chip').forEach(button => button.classList.toggle('active', button.dataset.filter === '전체'));
    document.querySelector('#searchInput').value = '';
    renderPosts();
    if (isEditing) {
      location.hash = `post/${data.post._id}`;
    } else {
      showFormMessage('작업이 아카이브에 등록됐어요.');
      document.querySelector('#work').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (error) {
    showFormMessage(error.message || (isEditing ? '게시물을 수정하지 못했습니다. 다시 시도해 주세요.' : '게시물을 저장하지 못했습니다. 다시 시도해 주세요.'), true);
  } finally {
    submitButton.disabled = false;
    document.querySelector('#submitButtonLabel').textContent = editingPostId ? '수정 사항 저장' : '게시물 등록하기';
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

