// ============ 상태 ============
const params = new URLSearchParams(window.location.search);
const roomId = params.get('id');
let myProfile = null;
let myUid = null;
let isOwner = false;
let socket = null;
let currentMembers = [];

if (!roomId) window.location.href = '/';

// ============ 요소 ============
const roomTitleEl = document.getElementById('roomTitle');
const memberCountTag = document.getElementById('memberCountTag');
const messageArea = document.getElementById('messageArea');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');

const noticeBar = document.getElementById('noticeBar');
const noticeText = document.getElementById('noticeText');
const noticeEditBtn = document.getElementById('noticeEditBtn');
const noticeModal = document.getElementById('noticeModal');
const noticeInput = document.getElementById('noticeInput');
const noticeCancelBtn = document.getElementById('noticeCancelBtn');
const noticeSaveBtn = document.getElementById('noticeSaveBtn');

const plusBtn = document.getElementById('plusBtn');
const plusMenu = document.getElementById('plusMenu');
const menuImageBtn = document.getElementById('menuImageBtn');
const menuPollBtn = document.getElementById('menuPollBtn');
const fileInput = document.getElementById('fileInput');

const pollModal = document.getElementById('pollModal');
const pollQuestionInput = document.getElementById('pollQuestionInput');
const pollOptionsWrap = document.getElementById('pollOptionsWrap');
const addPollOptionBtn = document.getElementById('addPollOptionBtn');
const pollCancelBtn = document.getElementById('pollCancelBtn');
const pollSubmitBtn = document.getElementById('pollSubmitBtn');
const pollError = document.getElementById('pollError');

const memberListOpenBtn = document.getElementById('memberListOpenBtn');
const memberListCloseBtn = document.getElementById('memberListCloseBtn');
const memberPanel = document.getElementById('memberPanel');
const memberPanelOverlay = document.getElementById('memberPanelOverlay');
const memberListBody = document.getElementById('memberListBody');

const kickConfirmModal = document.getElementById('kickConfirmModal');
const kickTargetName = document.getElementById('kickTargetName');
const kickCancelBtn = document.getElementById('kickCancelBtn');
const kickConfirmBtn = document.getElementById('kickConfirmBtn');
let pendingKickSocketId = null;

const mediaViewer = document.getElementById('mediaViewer');
const mediaViewerContent = document.getElementById('mediaViewerContent');
const mediaViewerCloseBtn = document.getElementById('mediaViewerCloseBtn');

// ============ 초기화 ============
init();

async function init() {
  const profileRes = await fetch('/api/profile');
  const profileData = await profileRes.json();
  if (!profileData.success || !profileData.profile) {
    window.location.href = '/';
    return;
  }
  myProfile = profileData.profile;

  const uidRes = await fetch('/api/my-uid');
  const uidData = await uidRes.json();
  if (uidData.success) myUid = uidData.uid;

  const roomRes = await fetch(`/api/rooms/${roomId}`);
  const roomData = await roomRes.json();
  if (!roomData.success) {
    alert(roomData.message);
    window.location.href = '/';
    return;
  }

  isOwner = roomData.room.isOwner;
  roomTitleEl.textContent = roomData.room.title;
  if (isOwner) noticeEditBtn.classList.remove('hidden');
  updateNotice(roomData.room.notice);

  await loadPreviousMessages();
  connectSocket();
}

async function loadPreviousMessages() {
  const res = await fetch(`/api/rooms/${roomId}/messages`);
  const data = await res.json();
  if (data.success) {
    data.messages.forEach(renderMessage);
    scrollToBottom();
  }
}

function connectSocket() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('join-room', {
      roomId,
      nickname: myProfile.nickname,
      avatar: myProfile.avatar || ''
    });
  });

  socket.on('chat-message', (msg) => {
    renderMessage(msg);
    scrollToBottom();
  });

  socket.on('poll-updated', (msg) => {
    updatePollCard(msg);
  });

  socket.on('member-list', (members) => {
    currentMembers = members;
    memberCountTag.textContent = `${members.length}명 참여중`;
    renderMemberList();
  });

  socket.on('notice-updated', (notice) => {
    updateNotice(notice);
  });

  socket.on('kicked', (message) => {
    alert(message);
    window.location.href = '/';
  });

  socket.on('error-message', (message) => {
    console.error(message);
  });
}

// ============ 공지사항 ============
function updateNotice(notice) {
  if (notice && notice.trim()) {
    noticeText.textContent = notice;
    noticeBar.classList.remove('hidden');
  } else {
    noticeBar.classList.add('hidden');
  }
}

noticeEditBtn.addEventListener('click', () => {
  noticeInput.value = noticeText.textContent === '' ? '' : (noticeBar.classList.contains('hidden') ? '' : noticeText.textContent);
  noticeModal.classList.remove('hidden');
});
noticeCancelBtn.addEventListener('click', () => noticeModal.classList.add('hidden'));
noticeSaveBtn.addEventListener('click', () => {
  socket.emit('notice-update', { roomId, notice: noticeInput.value.trim() });
  noticeModal.classList.add('hidden');
});

// ============ 메세지 전송 ============
sendBtn.addEventListener('click', sendTextMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendTextMessage();
});

function sendTextMessage() {
  const content = messageInput.value.trim();
  if (!content) return;
  socket.emit('chat-message', {
    roomId, type: 'text', content,
    nickname: myProfile.nickname, avatar: myProfile.avatar || ''
  });
  messageInput.value = '';
}

// ============ + 버튼 메뉴 ============
plusBtn.addEventListener('click', () => plusMenu.classList.toggle('hidden'));
document.addEventListener('click', (e) => {
  if (!plusMenu.contains(e.target) && e.target !== plusBtn) plusMenu.classList.add('hidden');
});

menuImageBtn.addEventListener('click', () => {
  plusMenu.classList.add('hidden');
  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || '업로드에 실패했습니다.');
      return;
    }
    socket.emit('chat-message', {
      roomId, type: data.type, fileUrl: data.fileUrl,
      nickname: myProfile.nickname, avatar: myProfile.avatar || ''
    });
  } catch (err) {
    alert('업로드 중 오류가 발생했습니다.');
  } finally {
    fileInput.value = '';
  }
});

// ============ 투표 생성 ============
menuPollBtn.addEventListener('click', () => {
  plusMenu.classList.add('hidden');
  pollQuestionInput.value = '';
  pollOptionsWrap.innerHTML = `
    <input type="text" class="poll-option-input" placeholder="항목 1" maxlength="50">
    <input type="text" class="poll-option-input" placeholder="항목 2" maxlength="50">
  `;
  pollError.textContent = '';
  pollModal.classList.remove('hidden');
});
pollCancelBtn.addEventListener('click', () => pollModal.classList.add('hidden'));

addPollOptionBtn.addEventListener('click', () => {
  const count = pollOptionsWrap.children.length;
  if (count >= 8) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'poll-option-input';
  input.maxLength = 50;
  input.placeholder = `항목 ${count + 1}`;
  pollOptionsWrap.appendChild(input);
});

pollSubmitBtn.addEventListener('click', () => {
  const question = pollQuestionInput.value.trim();
  const options = Array.from(document.querySelectorAll('.poll-option-input'))
    .map(i => i.value.trim())
    .filter(Boolean);

  if (!question) {
    pollError.textContent = '투표 주제를 입력해주세요.';
    return;
  }
  if (options.length < 2) {
    pollError.textContent = '항목을 2개 이상 입력해주세요.';
    return;
  }

  socket.emit('poll-create', {
    roomId, question, options,
    nickname: myProfile.nickname, avatar: myProfile.avatar || ''
  });
  pollModal.classList.add('hidden');
});

// ============ 메세지 렌더링 ============
function renderMessage(msg) {
  if (msg.type === 'system') {
    const div = document.createElement('div');
    div.className = 'system-msg';
    div.textContent = msg.content;
    messageArea.appendChild(div);
    return;
  }

  const mine = isMineMessage(msg);

  const row = document.createElement('div');
  row.className = 'msg-row' + (mine ? ' mine' : '');
  row.dataset.messageId = msg._id;

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'avatar';
  if (msg.senderAvatar) {
    avatarDiv.innerHTML = `<img src="${msg.senderAvatar}" alt="">`;
  } else {
    avatarDiv.textContent = '👤';
  }

  const body = document.createElement('div');
  body.className = 'msg-body';

  const nicknameDiv = document.createElement('div');
  nicknameDiv.className = 'msg-nickname';
  nicknameDiv.textContent = msg.senderNickname || '';

  let bubble;
  if (msg.type === 'text') {
    bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = msg.content;
  } else if (msg.type === 'image') {
    bubble = document.createElement('div');
    bubble.className = 'bubble media-bubble';
    bubble.innerHTML = `<img class="chat-media" src="${msg.fileUrl}" alt="">`;
    bubble.querySelector('img').addEventListener('click', () => openMediaViewer('image', msg.fileUrl));
  } else if (msg.type === 'video') {
    bubble = document.createElement('div');
    bubble.className = 'bubble media-bubble';
    bubble.innerHTML = `<video class="chat-media" src="${msg.fileUrl}" muted></video>`;
    bubble.querySelector('video').addEventListener('click', () => openMediaViewer('video', msg.fileUrl));
  } else if (msg.type === 'poll') {
    bubble = buildPollCard(msg);
  }

  const timeDiv = document.createElement('div');
  timeDiv.className = 'msg-time';
  timeDiv.textContent = formatTime(msg.createdAt);

  if (!mine) body.appendChild(nicknameDiv);
  body.appendChild(bubble);
  body.appendChild(timeDiv);

  row.appendChild(avatarDiv);
  row.appendChild(body);
  messageArea.appendChild(row);
}

function isMineMessage(msg) {
  if (msg.senderUid && myUid) return msg.senderUid === myUid;
  return msg.senderNickname === myProfile.nickname; // 예비 로직
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  h = h % 12 || 12;
  return `${ampm} ${h}:${m}`;
}

function scrollToBottom() {
  messageArea.scrollTop = messageArea.scrollHeight;
}

// ============ 투표 카드 ============
function buildPollCard(msg) {
  const card = document.createElement('div');
  card.className = 'poll-card';
  card.dataset.pollId = msg._id;
  renderPollContent(card, msg);
  return card;
}

function renderPollContent(card, msg) {
  const totalVotes = msg.poll.options.reduce((sum, o) => sum + o.count, 0);

  card.innerHTML = `<div class="poll-question">📊 ${escapeHtml(msg.poll.question)}</div>`;
  msg.poll.options.forEach((opt, idx) => {
    const pct = totalVotes ? Math.round((opt.count / totalVotes) * 100) : 0;
    const optDiv = document.createElement('div');
    optDiv.className = 'poll-option';
    optDiv.innerHTML = `
      <div class="poll-option-fill" style="width:${pct}%"></div>
      <div class="poll-option-content">
        <span>${escapeHtml(opt.text)}</span>
        <span>${opt.count}표</span>
      </div>
    `;
    optDiv.addEventListener('click', () => {
      socket.emit('poll-vote', { roomId, messageId: msg._id, optionIndex: idx });
    });
    card.appendChild(optDiv);
  });
  const totalDiv = document.createElement('div');
  totalDiv.className = 'poll-total';
  totalDiv.textContent = `총 ${totalVotes}명 참여`;
  card.appendChild(totalDiv);
}

function updatePollCard(msg) {
  const card = document.querySelector(`.poll-card[data-poll-id="${msg._id}"]`);
  if (card) renderPollContent(card, msg);
}

// ============ 미디어 뷰어 ============
function openMediaViewer(type, url) {
  mediaViewerContent.innerHTML = type === 'image'
    ? `<img src="${url}" alt="">`
    : `<video src="${url}" controls autoplay></video>`;
  mediaViewer.classList.remove('hidden');
}
mediaViewerCloseBtn.addEventListener('click', () => {
  mediaViewerContent.innerHTML = '';
  mediaViewer.classList.add('hidden');
});

// ============ 참여자 목록 ============
memberListOpenBtn.addEventListener('click', () => {
  memberPanel.classList.remove('hidden');
  memberPanelOverlay.classList.remove('hidden');
});
function closeMemberPanel() {
  memberPanel.classList.add('hidden');
  memberPanelOverlay.classList.add('hidden');
}
memberListCloseBtn.addEventListener('click', closeMemberPanel);
memberPanelOverlay.addEventListener('click', closeMemberPanel);

function renderMemberList() {
  memberListBody.innerHTML = '';
  currentMembers.forEach(member => {
    const row = document.createElement('div');
    row.className = 'member-row';

    const isMe = socket && member.socketId === socket.id;

    row.innerHTML = `
      <div class="avatar">${member.avatar ? `<img src="${member.avatar}" alt="">` : '👤'}</div>
      <div class="member-name">${escapeHtml(member.nickname)}${isMe ? ' (나)' : ''}</div>
    `;

    // 방장에게만 강퇴 버튼 노출 (본인 제외)
    if (isOwner && !isMe) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'kick-btn';
      kickBtn.textContent = '강퇴';
      kickBtn.addEventListener('click', () => {
        pendingKickSocketId = member.socketId;
        kickTargetName.textContent = `${member.nickname}님을 강퇴합니다.`;
        kickConfirmModal.classList.remove('hidden');
      });
      row.appendChild(kickBtn);
    }

    memberListBody.appendChild(row);
  });
}

kickCancelBtn.addEventListener('click', () => kickConfirmModal.classList.add('hidden'));
kickConfirmBtn.addEventListener('click', () => {
  if (pendingKickSocketId) {
    socket.emit('kick-user', { roomId, targetSocketId: pendingKickSocketId });
  }
  kickConfirmModal.classList.add('hidden');
});

// ============ 방 나가기 ============
leaveRoomBtn.addEventListener('click', () => {
  if (socket) socket.emit('leave-room');
  window.location.href = '/';
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
