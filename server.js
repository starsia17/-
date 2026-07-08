const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// DB 연결
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('DB 연결 성공'))
  .catch(err => console.error('DB 연결 실패:', err));

// 모델 정의
const User = mongoose.model('User', new mongoose.Schema({
    nickname: { type: String, unique: true },
    profilePic: String,
    friends: [String],
    pendingRequests: [String]
}));

const Room = mongoose.model('Room', new mongoose.Schema({
    roomName: String,
    creator: String,
    password: { type: String, default: '' }
}));

// 소켓 연결 관리
const userSockets = {}; // { nickname: socketId }

io.on('connection', (socket) => {
    // 닉네임/프로필 설정 및 접속 알림
    socket.on('join', async (data) => {
        userSockets[data.nickname] = socket.id;
        let user = await User.findOne({ nickname: data.nickname });
        if (!user) user = await new User({ nickname: data.nickname, profilePic: data.profilePic }).save();
        socket.emit('initUser', user);
    });

    // 친구 신청
    socket.on('friendRequest', async (data) => {
        const target = await User.findOne({ nickname: data.target });
        if (target && !target.pendingRequests.includes(data.sender)) {
            target.pendingRequests.push(data.sender);
            await target.save();
            io.to(userSockets[data.target]).emit('friendAlert', { sender: data.sender });
        }
    });

    // 친구 수락
    socket.on('acceptFriend', async (data) => {
        const user = await User.findOne({ nickname: data.myNickname });
        const friend = await User.findOne({ nickname: data.friendNickname });
        user.friends.push(data.friendNickname);
        user.pendingRequests = user.pendingRequests.filter(n => n !== data.friendNickname);
        friend.friends.push(data.myNickname);
        await user.save(); await friend.save();
        io.to(userSockets[data.friendNickname]).emit('friendAccepted', data.myNickname);
    });

    // 채팅 및 파일 전송
    socket.on('chat message', (msg) => {
        io.to(msg.room).emit('chat message', msg);
    });

    socket.on('joinRoom', (data) => {
        socket.join(data.roomName);
        io.to(data.roomName).emit('system', `${data.nickname}님이 입장했습니다.`);
    });
});

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
http.listen(process.env.PORT || 3000, () => console.log('서버 실행 중'));
