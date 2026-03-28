const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// In-memory room store (Room ID -> { passcode, host, viewers: Set() })
const rooms = new Map();
// Reverse map (Socket ID -> Room ID) to handle instantaneous disconnect tracking
const socketToRoom = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('create-room', ({ roomId, passcode }) => {
    rooms.set(roomId, { passcode, host: socket.id, viewers: new Set() });
    socketToRoom.set(socket.id, roomId);
    socket.join(roomId);
    console.log(`Enterprise Room [${roomId}] created by Host ${socket.id}`);
  });

  socket.on('join-room', ({ roomId, passcode }) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit('error', 'Room not found');
    if (String(room.passcode).trim() !== String(passcode).trim()) {
        console.log(`Failed Auth on ${roomId}: Expected '${room.passcode}', got '${passcode}'`);
        return socket.emit('error', 'Invalid passcode');
    }
    
    room.viewers.add(socket.id);
    socketToRoom.set(socket.id, roomId);
    socket.join(roomId);

    console.log(`Viewer ${socket.id} joined Room ${roomId}. Total Viewers: ${room.viewers.size}`);
    // Directly notify the Host that a specific new viewer demands an Uplink P2P connection!
    socket.to(room.host).emit('viewer-joined', socket.id);
  });

  socket.on('signal', ({ roomId, target, type, payload }) => {
    // Pass precise P2P payloads directly exclusively to target
    socket.to(target).emit('signal', { sender: socket.id, type, payload });
  });

  // OS Control Relay to Host
  socket.on('os-control', ({ roomId, x, y, type }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    // Allow viewers to send OS control to the host
    if (room.viewers.has(socket.id)) {
        socket.to(room.host).emit('os-control', { viewer: socket.id, x, y, type });
    }
  });

  // Host Telemetry Relay to Viewers
  socket.on('telemetry', (data) => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (room && room.host === socket.id) {
        // Broadcast telemetry to all viewers in the room
        socket.to(roomId).emit('telemetry', data);
    }
  });

  // Chat Broker
  socket.on('chat-message', (data) => {
      const roomId = socketToRoom.get(socket.id);
      if (roomId) socket.to(roomId).emit('chat-message', data);
  });

  // Voice Walkie-Talkie Broker
  socket.on('voice-message', (data) => {
      const roomId = socketToRoom.get(socket.id);
      if (roomId) socket.to(roomId).emit('voice-message', data);
  });

  // AI Action Trigger Relay
  socket.on('ai-action', ({ roomId, action, payload }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      if (room.viewers.has(socket.id)) {
          socket.to(room.host).emit('ai-action', { action, payload });
      }
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom.get(socket.id);
    if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
            // If the HOST disconnects, close room
            if (room.host === socket.id) {
                io.to(roomId).emit('error', 'Host ended the broadcast.');
                rooms.delete(roomId);
                console.log(`Room [${roomId}] dismantled.`);
            } 
            // If a VIEWER disconnects, explicitly tell Host to kill that single P2P pipeline
            else if (room.viewers.has(socket.id)) {
                room.viewers.delete(socket.id);
                io.to(room.host).emit('viewer-left', socket.id);
                console.log(`Viewer ${socket.id} left Room ${roomId}. Total Viewers: ${room.viewers.size}`);
            }
        }
        socketToRoom.delete(socket.id);
    }
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Multiuser Signaling Grid running on port ${PORT}`));
