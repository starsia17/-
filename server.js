const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');
const path = require('path');

app.use(express.json());
app.use(express.static(__dirname));

// MongoDB 연결 (본인의 DB URI로 변경 필요)
mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/familytalk");

const UserSchema = new mongoose.Schema({
    ip: { type: String, unique: true },
    nickname: String,
    profileImage: String,
    friends: [{ userId: String, nickname: String, addedAt: Date, lastUpdated: Date }],
    requests: [String]
});
const User = mongoose.model('User', UserSchema);

// API 라우트
app.post('/api/update-profile', async (req, res) => {
    const { ip, nickname } = req.body;
    const user = await User.findOneAndUpdate({ ip }, { nickname, lastUpdated: new Date() }, { upsert: true, new: true });
    res.json(user);
});

// 소켓 통신
io.on('connection', (socket) => {
    socket.on('send_message', (data) => io.emit('receive_message', data));
});

http.listen(process.env.PORT || 3000, () => console.log('Server running on 3000'));
