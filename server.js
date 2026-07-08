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
const Room = mongoose.model('Room', new mongoose.Schema({
    roomName: String,
    creator: String,
    password: { type: String, default: '' },
    announcement: { type: String, default: '' },
    poll: { question: String, options: [String], votes: [Number] }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    room: String,
    username: String,
    text: String,
    isImage: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
}));

io.on('connection', (socket) => {
    Room.find().then(rooms => socket.emit('initialRooms', rooms));

    // 방 만들기 (중복 방지 기능 포함)
    socket.on('createRoom', async (data) => {
        const existing = await Room.findOne({ roomName: data.roomName });
        if (existing) {
            socket.emit('error', '이미 존재하는 방 이름입니다.');
            return;
        }
        const newRoom = new Room({ 
            roomName: data.roomName, 
            creator: data.nickname, 
            password: data.password 
        });
        await newRoom.save();
        io.emit('roomCreated', newRoom);
    });

    socket.on('joinRoom', async (data) => {
        const room = await Room.findOne({ roomName: data.roomName });
        if (room && (!room.password || room.password === data.password)) {
            socket.join(data.roomName);
            socket.emit('joinResult', { success: true, roomData: room });
        } else {
            socket.emit('joinResult', { success: false, message: '비밀번호가 틀렸습니다.' });
        }
    });

    // 관리 기능
    socket.on('setAnnouncement', async (data) => {
        const room = await Room.findOne({ roomName: data.roomName });
        if (room && room.creator === data.nickname) {
            room.announcement = data.text;
            await room.save();
            io.to(data.roomName).emit('updateAnnouncement', data.text);
        }
    });

    socket.on('createPoll', async (data) => {
        const room = await Room.findOne({ roomName: data.roomName });
        if (room && room.creator === data.nickname) {
            room.poll = { question: data.question, options: data.options, votes: new Array(data.options.length).fill(0) };
            await room.save();
            io.to(data.roomName).emit('updatePoll', room.poll);
        }
    });

    socket.on('vote', async (data) => {
        const room = await Room.findOne({ roomName: data.roomName });
        if (room && room.poll) {
            room.poll.votes[data.optionIndex]++;
            await room.save();
            io.to(data.roomName).emit('updatePoll', room.poll);
        }
    });

    socket.on('chat message', async (msg) => {
        const newMessage = new Message({ room: msg.room, username: msg.username, text: msg.text, isImage: msg.isImage });
        await newMessage.save();
        io.to(msg.room).emit('chat message', msg);
    });

    socket.on('deleteRoom', async (data) => {
        const room = await Room.findOne({ roomName: data.roomName });
        if (room && room.creator === data.nickname) {
            await Room.deleteOne({ roomName: data.roomName });
            io.emit('roomDeleted', data.roomName);
        }
    });
});

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
http.listen(process.env.PORT || 3000, () => console.log('서버 실행 중'));
