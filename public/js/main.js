// ============ 상태 ============
let myProfile = null;
let currentPage = 1;
let pendingJoinRoomId = null;

// ============ 요소 ============
const profileScreen = document.getElementById('profileScreen');
const mainScreen = document.getElementById('mainScreen');
const avatarInput = document.getElementById('avatarInput');
const avatarPreview = document.getElementById('avatarPreview');
const avatarPlaceholder = document.getElementById('avatarPlaceholder');
const nicknameInput = document.getElementById('nicknameInput');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const profileError = document.getElementById('profileError');

const myAvatar = document.getElementById('myAvatar');
const myAvatarFallback = document.getElementById('myAvatarFallback');
const myNickname = document.getElementById('myNickname');

const roomList = document.getElementById('roomList');
const emptyRooms = document.getElementById('emptyRooms');
const pagination = document.getElementById('pagination');

const createRoomOpenBtn = document.getElementById('createRoomOpenBtn');
const createRoomModal = document.getElementById('createRoomModal');
const createRoomCancelBtn = document.getElementById('createRoomCancelBtn');
const createRoomSubmitBtn = document.getElementById('createRoomSubmitBtn');
const roomTitleInput = document.getElementById('roomTitleInput');
const roomPasswordInput = document.getElementById('roomPasswordInput');
const createRoomError = document.getElementById('createRoomError');

const passwordModal = document.getElementById('passwordModal');
const passwordRoomTitle = document.getElementById('passwordRoomTitle');
const passwordInput = document.getElementById('passwordInput');
const passwordCancelBtn = document.getElementById('passwordCancelBtn');
const passwordSubmitBtn = document.getElementById('passwordSubmitBtn');
const passwordError = document.getElementById('passwordError');

let selectedAvatarBase64 = '';

// ============ 초기화 ============
init();

async function init() {
  const res = await fetch('/api/profile');
  const data = await res.json();
  if (data.success && data.profile) {
    myProfile = data.profile;
    showMainScreen();
  } else {
    profileScreen.classList.remove('hidden');
  }
}

// ============ 프로필 이미지 선택 ============
document.querySelector('.avatar-picker').addEventListener('click', () => avatarInput.click());

avatarInput.addEventListener('change', () => {
  const file = avatarInput.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) {
    profileError.textContent = '이미지 용량은 3MB 이하로 선택해주세요.';
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    selectedAvatarBase64 = e.target.result;
    avatarPreview.src = selectedAvatarBase64;
    avatarPreview.classList.remove('hidden');
    avatarPlaceholder.classList.add('hidden');
  };
  reader.readAsDataURL(file);
});

// ============ 프로필 저장 ============
saveProfileBtn.addEventListener('click', async () => {
  const nickname = nicknameInput.value.trim();
  profileError.textContent = '';
  if (!nickname) {
    profileError.textContent = '닉네임을 입력해주세요.';
    return;
  }
  saveProfileBtn.disabled = true;
  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, avatar: selectedAvatarBase64 })
    });
    const data = await res.json();
    if (!data.success) {
      profileError.textContent = data.message;
      // 이미 프로필이 있는 경우 -> 해당 프로필로 진행
      if (data.profile) {
        myProfile = data.profile;
        setTimeout(showMainScreen, 800);
      }
      return;
    }
    myProfile = data.profile;
    showMainScreen();
  } catch (err) {
    profileError.textContent = '오류가 발생했습니다. 다시 시도해주세요.';
  } finally {
    saveProfileBtn.disabled = false;
  }
});

function showMainScreen() {
  profileScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  myNickname.textContent = myProfile.nickname;
  if (myProfile.avatar) {
    myAvatar.src = myProfile.avatar;
    myAvatar.classList.remove('hidden');
    myAvatarFallback.classList.add('hidden');
  }
  loadRooms(1);
}

// ============ 채팅방 목록 ============
async function loadRooms(page) {
  currentPage = page;
  const res = await fetch(`/api/rooms?page=${page}`);
  const data = await res.json();
  if (!data.success) return;

  roomList.innerHTML = '';
  if (data.rooms.length === 0) {
    emptyRooms.classList.remove('hidden');
  } else {
    emptyRooms.classList.add('hidden');
    data.rooms.forEach(room => {
      const card = document.createElement('div');
      card.className = 'room-card';
      card.innerHTML = `
        <div class="room-card-info">
          <div class="room-card-title">${escapeHtml(room.title)} ${room.hasPassword ? '<span class="lock-badge">🔒</span>' : ''}</div>
          <div class="room-card-meta">만든이 ${escapeHtml(room.creatorNickname)} · ${room.memberCount}명 참여중</div>
        </div>
        <button class="room-card-enter">입장</button>
      `;
      card.querySelector('.room-card-enter').addEventListener('click', () => tryJoinRoom(room._id, room.title, room.hasPassword));
      roomList.appendChild(card);
    });
  }

  renderPagination(data.currentPage, data.totalPages);
}

function renderPagination(current, total) {
  pagination.innerHTML = '';
  for (let i = 1; i <= total; i++) {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (i === current ? ' active' : '');
    btn.textContent = i;
    btn.addEventListener('click', () => loadRooms(i));
    pagination.appendChild(btn);
  }
}

// ============ 채팅방 입장 ============
async function tryJoinRoom(roomId, title, hasPassword) {
  if (hasPassword) {
    pendingJoinRoomId = roomId;
    passwordRoomTitle.textContent = title;
    passwordInput.value = '';
    passwordError.textContent = '';
    passwordModal.classList.remove('hidden');
    return;
  }
  await joinRoom(roomId, null);
}

async function joinRoom(roomId, password) {
  const res = await fetch(`/api/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const data = await res.json();
  if (!data.success) {
    if (data.needPassword) {
      passwordError.textContent = data.message;
      passwordModal.classList.remove('hidden');
    } else {
      alert(data.message);
    }
    return;
  }
  window.location.href = `/room.html?id=${roomId}`;
}

passwordCancelBtn.addEventListener('click', () => passwordModal.classList.add('hidden'));
passwordSubmitBtn.addEventListener('click', () => {
  if (!passwordInput.value) {
    passwordError.textContent = '비밀번호를 입력해주세요.';
    return;
  }
  joinRoom(pendingJoinRoomId, passwordInput.value);
});

// ============ 채팅방 생성 ============
createRoomOpenBtn.addEventListener('click', () => {
  roomTitleInput.value = '';
  roomPasswordInput.value = '';
  createRoomError.textContent = '';
  createRoomModal.classList.remove('hidden');
});
createRoomCancelBtn.addEventListener('click', () => createRoomModal.classList.add('hidden'));

createRoomSubmitBtn.addEventListener('click', async () => {
  const title = roomTitleInput.value.trim();
  if (!title) {
    createRoomError.textContent = '채팅방 제목을 입력해주세요.';
    return;
  }
  createRoomSubmitBtn.disabled = true;
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, password: roomPasswordInput.value })
    });
    const data = await res.json();
    if (!data.success) {
      createRoomError.textContent = data.message;
      return;
    }
    window.location.href = `/room.html?id=${data.room._id}`;
  } catch (err) {
    createRoomError.textContent = '오류가 발생했습니다.';
  } finally {
    createRoomSubmitBtn.disabled = false;
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
