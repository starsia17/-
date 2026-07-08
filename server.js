const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI);

// 1. 방 모델
const Room = mongoose.model('Room', new mongoose.Schema({
    roomName: { type: String, unique: true },
    password: { type: String, default: '' },
    creator: String
}));

// 2. 유저 모델 (프로필 + 친구 관리)
const User = mongoose.model('User', new mongoose.Schema({
    nickname: { type: String, unique: true },
    profilePic: String,
    friends: [String],
    pendingRequests: [String]
}));

io.on('connection', (socket) => {
    // 방 목록 & 유저 초기화
    Room.find().then(rooms => socket.emit('updateRoomList', rooms));

    // 프로필 저장/업데이트
    socket.on('saveProfile', async (data) => {
        let user = await User.findOne({ nickname: data.nickname });
        if (!user) user = new User({ nickname: data.nickname, profilePic: data.profilePic });
        else user.profilePic = data.profilePic;
        await user.save();
    });

    // 친구 시스템 (요청)
    socket.on('friendRequest', async (data) => {
        const target = await User.findOne({ nickname: data.target });
        if (target && !target.pendingRequests.includes(data.sender)) {
            target.pendingRequests.push(data.sender);
            await target.save();
            // 실제 서비스 시 해당 유저 소켓을 찾아 알림 전송 로직 추가 필요
        }
    });

    // 방 만들기/입장
    socket.on('createRoom', async (data) => {
        try { await new Room(data).save(); io.emit('updateRoomList', await Room.find()); }
        catch (err) { socket.emit('error', '방 이름이 중복되었습니다.'); }
    });

    socket.on('joinRoom', (data) => {
        socket.join(data.roomName);
        io.to(data.roomName).emit('system', `${data.nickname}님이 입장했습니다.`);
    });

    socket.on('chat message', (msg) => {
        io.to(msg.room).emit('chat message', msg);
    });
});

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
http.listen(process.env.PORT || 3000, () => console.log('서버 실행 중'));
