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

// 미들웨어 설정
app.use(express.json());

// 정적 파일 서빙 (이미지 등)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

// [중요] 메인 페이지 접속 시 index.html을 강제로 보내주는 루팅 추가
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 업로드 디렉토리 생성
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) { fs.mkdirSync(uploadsDir); }

// MongoDB 연결 (Render 환경에서는 환경변수나 실제 DB 주소가 필요할 수 있습니다)
mongoose.connect("mongodb://127.0.0.1:27017/chatapp", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB 연결 성공"))
  .catch((err) => console.log("MongoDB 연결 에러:", err));

// --- 스키마 설정 ---
const UserSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true },
  nickname: { type: String, default: "익명" },
  profileImage: { type: String, default: "/default-profile.png" },
  isAdmin: { type: Boolean, default: false },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  friendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  lastProfileUpdate: { type: Date, default: Date.now },
  newFriendAdded: { type: Date },
});
const User = mongoose.model("User", UserSchema);

const MessageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  content: String,
  timestamp: { type: Date, default: Date.now },
  isNotice: { type: Boolean, default: false },
});
const Message = mongoose.model("Message", MessageSchema);

// 이미지 업로드 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, "uploads/"); },
  filename: (req, file, cb) => { cb(null, Date.now() + path.extname(file.originalname)); },
});
const upload = multer({ storage: storage });

// --- API 경로 ---
app.get("/api/user", async (req, res) => {
  let ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  if (ip === "::1") ip = "127.0.0.1";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  try {
    let user = await User.findOne({ ip });
    if (!user) {
      user = new User({ ip, nickname: `사용자_${Math.floor(Math.random() * 1000)}` });
      await user.save();
    }
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/user/update", upload.single("profileImage"), async (req, res) => {
  let ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const { nickname } = req.body;
  let updateData = {};
  if (nickname) updateData.nickname = nickname;
  if (req.file) updateData.profileImage = `/uploads/${req.file.filename}`;
  updateData.lastProfileUpdate = Date.now();
  try {
    const user = await User.findOneAndUpdate({ ip: ip.includes("::ffff:") ? ip.slice(7) : (ip === "::1" ? "127.0.0.1" : ip) }, updateData, { new: true });
    io.emit("profile_updated", { userId: user._id });
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 친구 관련 API
app.post("/api/friends/request", async (req, res) => {
  const { fromId, toNickname } = req.body;
  try {
    const toUser = await User.findOne({ nickname: toNickname });
    if (!toUser) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    if (!toUser.friendRequests.includes(fromId)) {
      toUser.friendRequests.push(fromId);
      await toUser.save();
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/friends/list/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).populate("friends");
    res.json(user.friends);
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
