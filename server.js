require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { Server } = require('socket.io');

const User = require('./models/User');
const Room = require('./models/Room');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/family-talk';

// ---------- 미들웨어 ----------
app.set('trust proxy', true); // Render는 프록시 뒤에 있으므로 실제 IP를 얻기 위해 필요
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 실제 접속 IP 추출
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || req.ip;
}

// ---------- 파일 업로드 (이미지 / 동영상) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB 제한
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|webm|mov|quicktime/;
    const isValid = allowed.test(file.mimetype);
    cb(isValid ? null : new Error('지원하지 않는 파일 형식입니다.'), isValid);
  }
});

// 내 익명 식별자 확인 (내 메세지/참여자 구분용, IP는 노출하지 않음)
app.get('/api/my-uid', async (req, res) => {
  const ip = getClientIp(req);
  const user = await User.findOne({ ip });
  res.json({ success: true, uid: user ? user.uid : null });
});

// ================= 프로필 API =================

// 내 프로필 조회 (IP 기준)
app.get('/api/profile', async (req, res) => {
  try {
    const ip = getClientIp(req);
    const user = await User.findOne({ ip });
    res.json({ success: true, profile: user || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 프로필 생성 (IP당 1개 제한)
app.post('/api/profile', async (req, res) => {
  try {
    const ip = getClientIp(req);
    const { nickname, avatar } = req.body;

    if (!nickname || !nickname.trim()) {
      return res.status(400).json({ success: false, message: '닉네임을 입력해주세요.' });
    }

    const existing = await User.findOne({ ip });
    if (existing) {
      // 이미 이 IP로 만든 프로필이 있으면 새로 만들지 않고 기존 프로필 반환
      return res.status(409).json({ success: false, message: '이미 이 IP로 생성된 프로필이 있습니다.', profile: existing });
    }

    const user = await User.create({ ip, nickname: nickname.trim(), avatar: avatar || '' });
    res.json({ success: true, profile: user });
  } catch (err) {
    if (err.code === 11000) {
      const existing = await User.findOne({ ip: getClientIp(req) });
      return res.status(409).json({ success: false, message: '이미 프로필이 존재합니다.', profile: existing });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// 프로필 수정 (닉네임/사진 변경, 같은 IP만 가능)
app.put('/api/profile', async (req, res) => {
  try {
    const ip = getClientIp(req);
    const { nickname, avatar } = req.body;
    const user = await User.findOne({ ip });
    if (!user) return res.status(404).json({ success: false, message: '프로필이 없습니다.' });

    if (nickname && nickname.trim()) user.nickname = nickname.trim();
    if (avatar !== undefined) user.avatar = avatar;
    await user.save();
    res.json({ success: true, profile: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= 채팅방 API =================

// 채팅방 목록 (페이지네이션, 페이지당 10개)
app.get('/api/rooms', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = 10;
    const skip = (page - 1) * limit;

    const [rooms, total] = await Promise.all([
      Room.find().sort({ createdAt: -1 }).skip(skip).limit(limit)
        .select('title creatorNickname memberCount createdAt passwordHash'),
      Room.countDocuments()
    ]);

    const roomList = rooms.map(r => ({
      _id: r._id,
      title: r.title,
      creatorNickname: r.creatorNickname,
      memberCount: r.memberCount,
      createdAt: r.createdAt,
      hasPassword: !!r.passwordHash
    }));

    res.json({
      success: true,
      rooms: roomList,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      currentPage: page
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 채팅방 생성
app.post('/api/rooms', async (req, res) => {
  try {
    const ip = getClientIp(req);
    const { title, password } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: '채팅방 제목을 입력해주세요.' });
    }

    const user = await User.findOne({ ip });
    if (!user) {
      return res.status(400).json({ success: false, message: '먼저 프로필을 생성해주세요.' });
    }

    let passwordHash = null;
    if (password && password.trim()) {
      passwordHash = await bcrypt.hash(password.trim(), 10);
    }

    const room = await Room.create({
      title: title.trim(),
      passwordHash,
      creatorIp: ip,
      creatorNickname: user.nickname
    });

    res.json({ success: true, room: { _id: room._id, title: room.title, hasPassword: !!passwordHash } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 채팅방 입장 시도 (비밀번호 확인 + 강퇴 IP 확인)
app.post('/api/rooms/:id/join', async (req, res) => {
  try {
    const ip = getClientIp(req);
    const { password } = req.body;
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ success: false, message: '존재하지 않는 채팅방입니다.' });

    if (room.bannedIps.includes(ip)) {
      return res.status(403).json({ success: false, message: '이 채팅방에서 강퇴되어 입장할 수 없습니다.' });
    }

    if (room.passwordHash) {
      if (!password) return res.status(401).json({ success: false, message: '비밀번호를 입력해주세요.', needPassword: true });
      const match = await bcrypt.compare(password, room.passwordHash);
      if (!match) return res.status(401).json({ success: false, message: '비밀번호가 일치하지 않습니다.', needPassword: true });
    }

    res.json({ success: true, room: { _id: room._id, title: room.title, isOwner: room.creatorIp === ip, notice: room.notice } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 채팅방 정보 (새로고침 시 등)
app.get('/api/rooms/:id', async (req, res) => {
  try {
    const ip = getClientIp(req);
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ success: false, message: '존재하지 않는 채팅방입니다.' });
    if (room.bannedIps.includes(ip)) {
      return res.status(403).json({ success: false, message: '강퇴된 채팅방입니다.' });
    }
    res.json({
      success: true,
      room: {
        _id: room._id,
        title: room.title,
        isOwner: room.creatorIp === ip,
        notice: room.notice,
        hasPassword: !!room.passwordHash
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 이전 채팅 내역 조회 (새로 들어온 사용자용)
app.get('/api/rooms/:id/messages', async (req, res) => {
  try {
    const messages = await Message.find({ roomId: req.params.id })
      .sort({ createdAt: 1 })
      .limit(300); // 최근 300개까지
    res.json({ success: true, messages: messages.map(sanitizeMessage) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 파일 업로드 (이미지/동영상)
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: '파일이 없습니다.' });
  const fileUrl = `/uploads/${req.file.filename}`;
  const type = req.file.mimetype.startsWith('video') ? 'video' : 'image';
  res.json({ success: true, fileUrl, type });
});

// 클라이언트로 내보내기 전, IP 등 민감 정보를 제거한 안전한 형태로 변환
function sanitizeMessage(msgDoc) {
  const msg = msgDoc.toObject ? msgDoc.toObject() : { ...msgDoc };
  delete msg.senderIp;
  if (msg.poll && msg.poll.options) {
    msg.poll.options = msg.poll.options.map(opt => ({
      text: opt.text,
      count: opt.voters.length
    }));
  }
  return msg;
}

// ================= Socket.io 실시간 로직 =================

// 방별 현재 접속자 관리: { roomId: Map<socketId, {ip, nickname, avatar}> }
const roomMembers = {};

// 다른 사용자에게 IP를 노출하지 않기 위해 공개용 목록에서는 ip 필드를 제외
function getMemberList(roomId) {
  const map = roomMembers[roomId];
  if (!map) return [];
  return Array.from(map.values()).map(({ ip, ...publicInfo }) => publicInfo);
}

// 소켓 핸드셰이크에서 실제 접속 IP 추출 (클라이언트 값을 신뢰하지 않음)
function getSocketIp(socket) {
  const xff = socket.handshake.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return socket.handshake.address;
}

io.on('connection', (socket) => {
  const socketIp = getSocketIp(socket);

  socket.on('join-room', async ({ roomId }) => {
    const ip = socketIp;
    try {
      const user = await User.findOne({ ip });
      if (!user) return socket.emit('error-message', '프로필을 먼저 생성해주세요.');

      const room = await Room.findById(roomId);
      if (!room) return socket.emit('error-message', '존재하지 않는 채팅방입니다.');
      if (room.bannedIps.includes(ip)) {
        return socket.emit('kicked', '강퇴된 채팅방에는 입장할 수 없습니다.');
      }

      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.ip = ip;
      socket.data.nickname = user.nickname;

      if (!roomMembers[roomId]) roomMembers[roomId] = new Map();
      roomMembers[roomId].set(socket.id, { ip, uid: user.uid, nickname: user.nickname, avatar: user.avatar, socketId: socket.id });

      room.memberCount = roomMembers[roomId].size;
      await room.save();

      // 입장 시스템 메세지
      const sysMsg = await Message.create({
        roomId, type: 'system', content: `${user.nickname}님이 입장했습니다.`
      });
      io.to(roomId).emit('chat-message', sanitizeMessage(sysMsg));

      // 참여자 목록 브로드캐스트
      io.to(roomId).emit('member-list', getMemberList(roomId));
      // 방장에게 관리자 권한 여부 전달은 join API에서 이미 처리됨
    } catch (err) {
      socket.emit('error-message', err.message);
    }
  });

  // 텍스트 / 이미지 / 동영상 메세지
  socket.on('chat-message', async (data) => {
    try {
      const { roomId, type, content, fileUrl } = data;
      const ip = socketIp;
      if (!roomId) return;
      const user = await User.findOne({ ip });
      if (!user) return socket.emit('error-message', '프로필을 먼저 생성해주세요.');

      const msg = await Message.create({
        roomId, type, content: content || '', fileUrl: fileUrl || '',
        senderIp: ip, senderUid: user.uid, senderNickname: user.nickname, senderAvatar: user.avatar || ''
      });
      io.to(roomId).emit('chat-message', sanitizeMessage(msg));
    } catch (err) {
      socket.emit('error-message', err.message);
    }
  });

  // 투표 생성
  socket.on('poll-create', async (data) => {
    try {
      const { roomId, question, options } = data;
      const ip = socketIp;
      if (!question || !options || options.length < 2) {
        return socket.emit('error-message', '투표 주제와 2개 이상의 항목이 필요합니다.');
      }
      const user = await User.findOne({ ip });
      if (!user) return socket.emit('error-message', '프로필을 먼저 생성해주세요.');

      const msg = await Message.create({
        roomId,
        type: 'poll',
        senderIp: ip,
        senderUid: user.uid,
        senderNickname: user.nickname,
        senderAvatar: user.avatar || '',
        poll: {
          question,
          options: options.map(text => ({ text, voters: [] }))
        }
      });
      io.to(roomId).emit('chat-message', sanitizeMessage(msg));
    } catch (err) {
      socket.emit('error-message', err.message);
    }
  });

  // 투표하기
  socket.on('poll-vote', async ({ roomId, messageId, optionIndex }) => {
    const ip = socketIp;
    try {
      const msg = await Message.findById(messageId);
      if (!msg || msg.type !== 'poll') return;

      // 이미 투표한 항목이 있으면 제거 후 새 항목에 투표 (항목 변경 허용)
      msg.poll.options.forEach(opt => {
        opt.voters = opt.voters.filter(v => v !== ip);
      });
      msg.poll.options[optionIndex].voters.push(ip);
      await msg.save();

      io.to(roomId).emit('poll-updated', sanitizeMessage(msg));
    } catch (err) {
      socket.emit('error-message', err.message);
    }
  });

  // 공지사항 업데이트 (관리자만 -> 클라이언트에서 isOwner 체크 후 호출, 서버에서도 재검증)
  socket.on('notice-update', async ({ roomId, notice }) => {
    const ip = socketIp;
    try {
      const room = await Room.findById(roomId);
      if (!room) return;
      if (room.creatorIp !== ip) {
        return socket.emit('error-message', '공지사항은 방장만 작성할 수 있습니다.');
      }
      room.notice = notice;
      await room.save();
      io.to(roomId).emit('notice-updated', notice);
    } catch (err) {
      socket.emit('error-message', err.message);
    }
  });

  // 강퇴 (관리자만)
  socket.on('kick-user', async ({ roomId, targetSocketId }) => {
    const ip = socketIp;
    try {
      const room = await Room.findById(roomId);
      if (!room) return;
      if (room.creatorIp !== ip) {
        return socket.emit('error-message', '강퇴 권한이 없습니다.');
      }

      const map = roomMembers[roomId];
      if (!map || !map.has(targetSocketId)) return;
      const target = map.get(targetSocketId);

      // IP 밴 처리
      if (!room.bannedIps.includes(target.ip)) {
        room.bannedIps.push(target.ip);
        await room.save();
      }

      // 대상에게 강퇴 알림 후 연결 해제
      io.to(targetSocketId).emit('kicked', '방장에 의해 강퇴되었습니다.');
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.leave(roomId);
        targetSocket.disconnect(true);
      }

      map.delete(targetSocketId);
      room.memberCount = map.size;
      await room.save();

      const sysMsg = await Message.create({
        roomId, type: 'system', content: `${target.nickname}님이 강퇴되었습니다.`
      });
      io.to(roomId).emit('chat-message', sanitizeMessage(sysMsg));
      io.to(roomId).emit('member-list', getMemberList(roomId));
    } catch (err) {
      socket.emit('error-message', err.message);
    }
  });

  socket.on('leave-room', async () => {
    await handleLeave(socket);
  });

  socket.on('disconnect', async () => {
    await handleLeave(socket);
  });

  async function handleLeave(socket) {
    const roomId = socket.data.roomId;
    if (!roomId || !roomMembers[roomId]) return;
    const member = roomMembers[roomId].get(socket.id);
    roomMembers[roomId].delete(socket.id);

    try {
      const room = await Room.findById(roomId);
      if (room) {
        room.memberCount = roomMembers[roomId].size;
        await room.save();
      }
      if (member) {
        const sysMsg = await Message.create({
          roomId, type: 'system', content: `${member.nickname}님이 퇴장했습니다.`
        });
        io.to(roomId).emit('chat-message', sanitizeMessage(sysMsg));
      }
      io.to(roomId).emit('member-list', getMemberList(roomId));
    } catch (err) {
      // 방이 이미 삭제된 경우 등은 무시
    }
  }
});

// ---------- MongoDB 연결 & 서버 시작 ----------
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB 연결 성공');
    server.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB 연결 실패:', err.message);
    process.exit(1);
  });
