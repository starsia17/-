const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// 데이터베이스 연결
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('데이터베이스 연결 성공!'))
  .catch(err => console.error('연결 실패:', err));

app.get('/', (req, res) => res.send('서버 작동 중'));

http.listen(process.env.PORT || 3000, () => console.log('서버 시작됨'));
