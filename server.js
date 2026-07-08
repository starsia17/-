const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// DB 연결
mongoose.connect(process.env.MONGODB_URI);

// 1. 화면(index.html) 보내주기
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// 2. 채팅 주고받기
io.on('connection', (socket) => {
  socket.on('chat message', (msg) => {
    io.emit('chat message', msg);
  });
});

http.listen(process.env.PORT || 3000, () => console.log('서버 시작됨'));
