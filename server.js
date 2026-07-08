const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatApp');

// 모델 정의
const Room = mongoose.model('Room', new mongoose.Schema({
    roomName: { type: String, unique: true },
    password: { type: String, default: '' },
    creator: String,
    bannedUsers: [String],
    announcement: String,
    poll: { question: String, options: Array, votes: Object }
}));

const User = mongoose.model('User', new mongoose.Schema({
    nickname: { type: String, unique: true },
    profilePic: String,
    friends: [String]
}));

io.on('connection', (socket) => {
    // 1. 방 목록 전송
    Room.find().then(rooms => socket.emit('updateRooms', rooms));

    // 2. 방 생성
    socket.on('createRoom', async (data) => {
        try { await new Room({ ...data, bannedUsers: [] }).save(); io.emit('updateRooms', await Room.find()); }
        catch (e) { socket.emit('alert', '방 생성 실패'); }
    });

    // 3. 방 입장 및 참여자 관리
    socket.on('joinRoom', async (data) => {
        const room = await Room.findOne({ roomName: data.roomName });
        if (room.bannedUsers.includes(data.nickname)) return socket.emit('alert', '강퇴당한 방입니다.');
        
        socket.join(data.roomName);
        socket.nickname = data.nickname;
        socket.room = data.roomName;
        
        io.to(data.roomName).emit('system', `${data.nickname}님이 입장했습니다.`);
        io.to(data.roomName).emit('refreshRoom', room);
    });

    // 4. 채팅 및 미디어
    socket.on('chat', (msg) => io.to(msg.room).emit('chat', msg));

    // 5. 관리자 기능 (강퇴/공지/투표)
    socket.on('kickUser', async (data) => {
        const room = await Room.findOne({ roomName: data.roomName });
        if (room.creator === data.admin) {
            room.bannedUsers.push(data.target);
            await room.save();
            io.to(data.roomName).emit('banned', data.target);
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
        room.poll.votes[data.option] = (room.poll.votes[data.option] || 0) + 1;
        await room.save();
        io.to(data.roomName).emit('refreshRoom', room);
    });
});

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
http.listen(3000, () => console.log('서버 실행 중'));
