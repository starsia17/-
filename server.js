const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// --- 설정 및 미들웨어 ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

// IP 주소 추출 유틸리티 함수 (일관성 유지)
const getIp = (req) => {
  let ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  if (ip === "::1" || ip === "::ffff:127.0.0.1") return "127.0.0.1";
  return ip.replace("::ffff:", "");
};

// 업로드 디렉토리 설정
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) { fs.mkdirSync(uploadsDir); }

// MongoDB 연결
mongoose.connect("mongodb://127.0.0.1:27017/chatapp")
  .then(() => console.log("MongoDB 연결 성공"))
  .catch((err) => console.log("MongoDB 연결 에러:", err));

// --- 스키마 설정 ---
const UserSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true },
  nickname: { type: String, default: "익명" },
  profileImage: { type: String, default: "/default-profile.png" },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  friendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
});
const User = mongoose.model("User", UserSchema);

const MessageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  content: String,
  timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model("Message", MessageSchema);

// Multer 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, "uploads/"); },
  filename: (req, file, cb) => { cb(null, Date.now() + path.extname(file.originalname)); },
});
const upload = multer({ storage: storage });

// --- API 경로 ---
app.get("/", (req, res) => { res.sendFile(path.join(__dirname, "public", "index.html")); });

// 사용자 조회 및 생성
app.get("/api/user", async (req, res) => {
  try {
    let user = await User.findOne({ ip: getIp(req) });
    if (!user) {
      user = new User({ ip: getIp(req), nickname: `사용자_${Math.floor(Math.random() * 1000)}` });
      await user.save();
    }
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 프로필 업데이트
app.post("/api/user/update", upload.single("profileImage"), async (req, res) => {
  const { nickname } = req.body;
  let updateData = {};
  if (nickname) updateData.nickname = nickname;
  if (req.file) updateData.profileImage = `/uploads/${req.file.filename}`;
  try {
    const user = await User.findOneAndUpdate({ ip: getIp(req) }, updateData, { new: true });
    io.emit("profile_updated", { userId: user._id });
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 친구 요청
app.post("/api/friends/request", async (req, res) => {
  const { fromId, toNickname } = req.body;
  try {
    const toUser = await User.findOne({ nickname: toNickname });
    if (!toUser) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    if (!toUser.friendRequests.includes(fromId) && toUser._id.toString() !== fromId) {
      toUser.friendRequests.push(fromId);
      await toUser.save();
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 친구 수락 (새로 추가됨)
app.post("/api/friends/accept", async (req, res) => {
    const { userId, friendId } = req.body;
    try {
        const user = await User.findById(userId);
        const friend = await User.findById(friendId);
        if (!user || !friend) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
        
        user.friendRequests = user.friendRequests.filter(id => id.toString() !== friendId);
        user.friends.push(friendId);
        friend.friends.push(userId);
        
        await user.save();
        await friend.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 소켓 통신 ---
let activeUsers = {};
io.on("connection", (socket) => {
  socket.on("join", async (userData) => {
    activeUsers[socket.id] = { ...userData, socketId: socket.id };
    io.emit("user_list_update", Object.values(activeUsers));
    const messages = await Message.find({ receiverId: null }).sort({ timestamp: -1 }).limit(50).populate("senderId");
    socket.emit("recent_messages", messages.reverse());
  });

  socket.on("send_message", async (data) => {
    const { senderId, receiverId, content } = data;
    const msg = new Message({ senderId, receiverId, content });
    await msg.save();
    const populatedMsg = await Message.findById(msg._id).populate("senderId");
    if (receiverId) {
      const target = Object.values(activeUsers).find(u => u.id === receiverId);
      if (target) io.to(target.socketId).emit("receive_private_message", populatedMsg);
      socket.emit("receive_private_message", populatedMsg);
    } else {
      io.emit("receive_message", populatedMsg);
    }
  });

  socket.on("disconnect", () => {
    delete activeUsers[socket.id];
    io.emit("user_list_update", Object.values(activeUsers));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`); });
