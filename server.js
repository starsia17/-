const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// 데이터베이스 연결
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('데이터베이스 연결 성공!'))
  .catch(err => console.error('데이터베이스 연결 실패:', err));

// 데이터 모델 정의
const Room = mongoose.model('Room', new mongoose.Schema({
    roomName: String,
    creator: String
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    room: String,
    username: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
}));

// 소켓 통신 로직
io.on('connection', (socket) => {
    
    // 1. 접속하자마자 현재 존재하는 방 목록을 전달
    Room.find().then(rooms => {
        socket.emit('initialRooms', rooms);
    });

    // 2. 방 만들기 요청 처리
    socket.on('createRoom', async (data) => {
        const newRoom = new Room({ roomName: data.roomName, creator: data.nickname });
        await newRoom.save();
        // 모든 사용자에게 새 방이 생겼음을 알림
        io.emit('roomCreated', newRoom); 
    });

    // 3. 방 입장 처리
    socket.on('joinRoom', (roomName) => {
        socket.join(roomName);
    });

    // 4. 채팅 메시지 저장 및 전송
    socket.on('chat message', async (msg) => {
        const newMessage = new Message({
            room: msg.room,
            username: msg.username,
            text: msg.text
        });
        await newMessage.save();
        // 해당 방에 있는 사람들에게만 메시지 전송
        io.to(msg.room).emit('chat message', msg);
    });
});

// 기본 경로 설정
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// 서버 실행
http.listen(process.env.PORT || 3000, () => {
    console.log('서버가 성공적으로 시작되었습니다.');
});
