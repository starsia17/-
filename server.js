const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// MongoDB Connection
mongoose
  .connect("mongodb://127.0.0.1:27017/chatapp", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log(err));

// MongoDB Schemas
const UserSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true },
  nickname: { type: String, default: "Anonymous" },
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
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, // For 1:1 chat
  content: String,
  timestamp: { type: Date, default: Date.now },
  isNotice: { type: Boolean, default: false },
});
const Message = mongoose.model("Message", MessageSchema);

// Multer Setup for Image Upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

// API Routes
app.get("/api/user", async (req, res) => {
  let ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  // Normalize IPv6 localhost to IPv4
  if (ip === "::1") ip = "127.0.0.1";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);

  try {
    let user = await User.findOne({ ip });
    if (!user) {
      user = new User({ ip, nickname: `User_${Math.floor(Math.random() * 1000)}` });
      await user.save();
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/user/update", upload.single("profileImage"), async (req, res) => {
  let ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  if (ip === "::1") ip = "127.0.0.1";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);

  const { nickname } = req.body;
  let updateData = {};
  if (nickname) updateData.nickname = nickname;
  if (req.file) updateData.profileImage = `/uploads/${req.file.filename}`;
  updateData.lastProfileUpdate = Date.now(); // Update timestamp

  try {
    const user = await User.findOneAndUpdate({ ip }, updateData, { new: true });
    // Notify all connected clients about profile update
    io.emit("profile_updated", { userId: user._id, nickname: user.nickname, profileImage: user.profileImage, lastProfileUpdate: user.lastProfileUpdate });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Friend System APIs
app.post("/api/friends/request", async (req, res) => {
  const { fromId, toNickname } = req.body;
  try {
    const toUser = await User.findOne({ nickname: toNickname });
    if (!toUser) return res.status(404).json({ error: "User not found" });
    if (toUser._id.toString() === fromId) return res.status(400).json({ error: "Cannot add yourself" });

    if (!toUser.friendRequests.includes(fromId) && !toUser.friends.includes(fromId)) {
      toUser.friendRequests.push(fromId);
      await toUser.save();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/friends/requests/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).populate(
      "friendRequests",
      "nickname profileImage"
    );
    res.json(user.friendRequests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/friends/accept", async (req, res) => {
  const { userId, requesterId } = req.body;
  try {
    const user = await User.findById(userId);
    const requester = await User.findById(requesterId);

    user.friendRequests = user.friendRequests.filter(
      (id) => id.toString() !== requesterId
    );
    if (!user.friends.includes(requesterId)) user.friends.push(requesterId);
    if (!requester.friends.includes(userId)) requester.friends.push(userId);

    // Set newFriendAdded timestamp for both users
    user.newFriendAdded = Date.now();
    requester.newFriendAdded = Date.now();

    await user.save();
    await requester.save();

    // Notify both users about new friend status
    io.emit("friend_status_update", { userId: user._id, friendId: requester._id, status: "accepted" });
    io.emit("friend_status_update", { userId: requester._id, friendId: user._id, status: "accepted" });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/friends/reject", async (req, res) => {
  const { userId, requesterId } = req.body;
  try {
    const user = await User.findById(userId);
    user.friendRequests = user.friendRequests.filter(
      (id) => id.toString() !== requesterId
    );
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/friends/list/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).populate(
      "friends",
      "nickname profileImage ip lastProfileUpdate newFriendAdded"
    );
    res.json(user.friends);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin APIs
app.post("/api/admin/notice", async (req, res) => {
  const { adminId, content } = req.body;
  try {
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) return res.status(403).json({ error: "Unauthorized" });

    const notice = new Message({ senderId: adminId, content, isNotice: true });
    await notice.save();
    io.emit("receive_notice", { content, timestamp: notice.timestamp });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/kick", async (req, res) => {
  const { adminId, targetNickname } = req.body;
  try {
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) return res.status(403).json({ error: "Unauthorized" });

    const target = await User.findOne({ nickname: targetNickname });
    if (target) {
      io.emit("kicked", { targetId: target._id });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/makeadmin", async (req, res) => {
  const { adminId, targetNickname } = req.body;
  try {
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) return res.status(403).json({ error: "Unauthorized" });

    await User.findOneAndUpdate({ nickname: targetNickname }, { isAdmin: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Make first user admin for testing
app.get("/api/setup-admin/:userId", async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.userId, { isAdmin: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.IO
let activeUsers = {}; // socketId -> user info
let voteStore = {}; // voteId -> vote data

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", async (userData) => {
    activeUsers[socket.id] = { ...userData, socketId: socket.id };
    io.emit("user_list_update", Object.values(activeUsers));

    // Send recent general messages
    const messages = await Message.find({ receiverId: null })
      .sort({ timestamp: -1 })
      .limit(50)
      .populate("senderId", "nickname profileImage");
    socket.emit("recent_messages", messages.reverse());
  });

  socket.on("send_message", async (data) => {
    const { senderId, receiverId, content } = data;
    try {
      const msg = new Message({ senderId, receiverId, content });
      await msg.save();
      const populatedMsg = await Message.findById(msg._id).populate(
        "senderId",
        "nickname profileImage"
      );

      if (receiverId) {
        // 1:1 chat
        const targetSocketId = Object.values(activeUsers).find(u => u.id === receiverId)?.socketId;
        if (targetSocketId) {
          io.to(targetSocketId).emit("receive_private_message", populatedMsg);
          io.to(socket.id).emit("receive_private_message", populatedMsg); // Send to sender too
        }
      } else {
        // General chat
        io.emit("receive_message", populatedMsg);
      }
    } catch (err) {
      console.error(err);
    }
  });

  // In-memory vote store per server instance
  socket.on("cast_vote", (data) => {
    const { voteId, optionIdx, userId } = data;
    // Use server-side vote store
    if (!voteStore[voteId]) return;
    const vote = voteStore[voteId];
    // Remove previous vote if any
    const prevIdx = vote.voters[userId];
    if (prevIdx !== undefined && prevIdx !== optionIdx) {
      vote.options[prevIdx].count = Math.max(0, vote.options[prevIdx].count - 1);
    }
    if (prevIdx !== optionIdx) {
      vote.options[optionIdx].count += 1;
      vote.voters[userId] = optionIdx;
    }
    io.emit("vote_update", { voteId, options: vote.options, voters: vote.voters });
  });

  socket.on("create_vote", (voteData) => {
    voteStore[voteData.voteId] = voteData;
    io.emit("receive_vote", voteData);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    delete activeUsers[socket.id];
    io.emit("user_list_update", Object.values(activeUsers));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
