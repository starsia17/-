const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// DB 연결
mongoose.connect(process.env.MONGODB_URI);
mongoose.connection.once('open', () => { console.log('데이터베이스 연결 성공!'); });

// 모델 정의
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

// 소켓 통신
io.on('connection', (socket) => {
    // 1. 방 목록 불러오기 (접속하자마자 기존 방들을 보여줌)
    Room.find().then(rooms => socket.emit('initialRooms', rooms));

    // 2. 방 만들기
    socket.on('createRoom', async (data) => {
        const newRoom = new Room({ roomName: data.roomName, creator: data.nickname });
        await newRoom.save();
        io.emit('roomCreated', newRoom); // 모든 사용자에게 새 방 알림
    });

    // 3. 방 입장
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
        io.to(msg.room).emit('chat message', msg); // 해당 방 사람들에게만 전송
    });
});

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

http.listen(process.env.PORT || 3000, () => { console.log('서버 시작됨'); });
