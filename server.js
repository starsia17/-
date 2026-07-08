const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatApp');

// 모델 정의
const User = mongoose.model('User', new mongoose.Schema({
    nickname: { type: String, unique: true },
    ip: { type: String, unique: true },
    profilePic: String
}));

const Room = mongoose.model('Room', new mongoose.Schema({
    roomName: { type: String, unique: true },
    password: { type: String, default: '' },
    creator: String,
    bannedUsers: [String],
    participants: [String],
    announcement: String,
    poll: { question: String, options: Array, votes: Object }
}));

io.on('connection', (socket) => {
    const clientIp = socket.handshake.address;

    // 프로필 등록 (IP당 1개 제한)
    socket.on('register', async (data) => {
        try {
            const existing = await User.findOne({ ip: clientIp });
            if (existing) return socket.emit('alert', '이미 이 기기에서 생성된 프로필이 있습니다.');
            await new User({ nickname: data.nickname, ip: clientIp, profilePic: data.profilePic }).save();
            socket.emit('registered', { success: true });
        } catch (e) { socket.emit('alert', '닉네임 중복 또는 등록 실패'); }
    });

    // 방 관리
    Room.find().then(rooms => socket.emit('updateRooms', rooms));

    socket.on('createRoom', async (data) => {
        try { await new Room({ ...data, bannedUsers: [], participants: [] }).save(); io.emit('updateRooms', await Room.find()); }
        catch (e) { socket.emit('alert', '방 생성 실패'); }
    });

    socket.on('joinRoom', async (data) => {
        const room = await Room.findOne({ roomName: data.roomName });
        if (room.bannedUsers.includes(data.nickname)) return socket.emit('alert', '강퇴당한 방입니다.');
        
        socket.join(data.roomName);
        if (!room.participants.includes(data.nickname)) {
            room.participants.push(data.nickname);
            await room.save();
        }
        io.to(data.roomName).emit('refreshRoom', room);
    });

    // 관리자 기능 (강퇴/공지/투표)
    socket.on('kickUser', async (data) => {
        const room = await Room.findOne({ roomName: data.roomName });
        if (room.creator === data.admin) {
            room.bannedUsers.push(data.target);
            room.participants = room.participants.filter(p => p !== data.target);
            await room.save();
            io.to(data.roomName).emit('banned', data.target);
            io.to(data.roomName).emit('refreshRoom', room);
        }
    });

    socket.on('postAnnouncement', async (data) => {
        const room = await Room.findOne({ roomName: data.roomName });
        if (room.creator === data.admin) {
            room.announcement = data.text;
            room.poll = data.poll;
            await room.save();
            io.to(data.roomName).emit('refreshRoom', room);
        }
    });

    socket.on('vote', async (data) => {
        const room = await Room.findOne({ roomName: data.roomName });
        if (room.poll) {
            room.poll.votes[data.option] = (room.poll.votes[data.option] || 0) + 1;
            await room.save();
            io.to(data.roomName).emit('refreshRoom', room);
        }
    });

    // 채팅/미디어
    socket.on('chat', (msg) => io.to(msg.room).emit('chat', msg));
});

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
http.listen(3000, () => console.log('서버 실행 중'));
