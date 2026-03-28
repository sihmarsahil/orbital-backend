const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors'); // CORS ko import karein

const app = express();

// 1. Express CORS enable karein
app.use(cors());

const server = http.createServer(app);

// 2. Socket.io settings ko update kiya cloud ke liye
const io = new Server(server, { 
  cors: { 
    origin: "*", 
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'] // Connection stability ke liye
});

const rooms = new Map();
const socketToRoom = new Map();

// Test route (Check karne ke liye ki backend zinda hai)
app.get('/', (req, res) => {
    res.send("Orbital Nexus Server is Live!");
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('create-room', ({ roomId, passcode }) => {
    rooms.set(roomId, { passcode: String(passcode).trim(), host: socket.id, viewers: new Set() });
    socketToRoom.set(socket.id, roomId);
    socket.join(roomId);
    console.log(`Enterprise Room [${roomId}] created by Host ${socket.id}`);
  });

  socket.on('join-room', ({ roomId, passcode }) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit('error', 'Room not found');
    
    if (String(room.passcode).trim() !== String(passcode).trim()) {
        console.log(`Failed Auth on ${roomId}`);
        return socket.emit('error', 'Invalid passcode');
    }
    
    room.viewers.add(socket.id);
    socketToRoom.set(socket.id, roomId);
    socket.join(roomId);

    console.log(`Viewer ${socket.id} joined Room ${roomId}`);
    socket.to(room.host).emit('viewer-joined', socket.id);
  });

  socket.on('signal', ({ target, type, payload }) => {
    socket.to(target).emit('signal', { sender: socket.id, type, payload });
  });

  socket.on('os-control', ({ roomId, x, y, type }) => {
    const room = rooms.get(roomId);
    if (room && room.viewers.has(socket.id)) {
        socket.to(room.host).emit('os-control', { viewer: socket.id, x, y, type });
    }
  });

  socket.on('telemetry', (data) => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (room && room.host === socket.id) {
        socket.to(roomId).emit('telemetry', data);
    }
  });

  socket.on('chat-message', (data) => {
      const roomId = socketToRoom.get(socket.id);
      if (roomId) socket.to(roomId).emit('chat-message', data);
  });

  socket.on('voice-message', (data) => {
      const roomId = socketToRoom.get(socket.id);
      if (roomId) socket.to(roomId).emit('voice-message', data);
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom.get(socket.id);
    if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
            if (room.host === socket.id) {
                io.to(roomId).emit('error', 'Host ended the broadcast.');
                rooms.delete(roomId);
                console.log(`Room [${roomId}] dismantled.`);
            } else if (room.viewers.has(socket.id)) {
                room.viewers.delete(socket.id);
                io.to(room.host).emit('viewer-left', socket.id);
            }
        }
        socketToRoom.delete(socket.id);
    }
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
// 3. Listen on 0.0.0.0 (Cloud environment requirement)
server.listen(PORT, '0.0.0.0', () => console.log(`Running on port ${PORT}`));
