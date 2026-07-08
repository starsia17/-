const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// DB 연결
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatApp');

// 모델 정의
const Room = mongoose.model('Room', new mongoose.Schema({
    roomName: { type: String, unique: true },
    password: { type: String, default: '' } // 기본값을 빈 문자열로 설정
}));

io.on('connection', (socket) => {
    // 초기 접속 시 방 목록 전송
    Room.find().then(rooms => socket.emit('updateRooms', rooms));
    
    // 방 생성
    socket.on('createRoom', async (data) => {
        try { 
            await new Room({ 
                roomName: data.roomName, 
                password: data.password || '' // 비밀번호 없으면 빈 문자열
            }).save(); 
            io.emit('updateRooms', await Room.find()); 
        } catch (e) { socket.emit('alert', '방 생성 실패 (중복)'); }
    });

    // 방 입장
    socket.on('joinRoom', (data) => {
        socket.join(data.roomName);
        io.to(data.roomName).emit('chat', { sender: 'System', text: `${data.nickname}님이 입장했습니다.` });
    });

    // 채팅 전송
    socket.on('chat', (msg) => {
        io.to(msg.room).emit('chat', msg);
    });
});

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
http.listen(3000, () => console.log('서버 실행 중 (포트 3000)'));
