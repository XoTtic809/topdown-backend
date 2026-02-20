// multiplayer/socketHandler.js
// Handles all Socket.io events for multiplayer rooms

const jwt = require('jsonwebtoken');
const { createRoom, joinRoom, leaveRoom, startGame, handleInput } = require('./gameServer');

function initSocketHandler(io) {

  // ─── Auth middleware ──────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // { uid, username, activeSkin, isAdmin }
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.user.username} (${socket.id})`);

    // ── Create a room ───────────────────────────────────────────
    socket.on('create_room', () => {
      try {
        const room = createRoom(socket, socket.user);
        socket.join(room.code);
        socket.emit('room_created', {
          code:     room.code,
          username: socket.user.username,
        });
      } catch (err) {
        socket.emit('error', { message: 'Failed to create room' });
      }
    });

    // ── Join a room ─────────────────────────────────────────────
    socket.on('join_room', ({ code }) => {
      if (!code) return socket.emit('error', { message: 'Room code required' });

      const result = joinRoom(code, socket, socket.user);
      if (result.error) return socket.emit('error', { message: result.error });

      socket.join(result.room.code);

      // Tell the joining player they're in
      socket.emit('room_joined', {
        code:     result.room.code,
        username: socket.user.username,
      });

      // Tell all players in the room who's here now
      const players = Object.values(result.room.players).map(p => ({
        socketId: p.socketId,
        username: p.username,
        skin:     p.skin,
        isHost:   p.isHost,
      }));

      io.to(result.room.code).emit('room_updated', { players });

      // If room is now full (2 players), start a countdown
      if (players.length === 2) {
        let countdown = 3;
        io.to(result.room.code).emit('countdown', { seconds: countdown });

        const timer = setInterval(() => {
          countdown--;
          if (countdown > 0) {
            io.to(result.room.code).emit('countdown', { seconds: countdown });
          } else {
            clearInterval(timer);
            startGame(result.room);
          }
        }, 1000);
      }
    });

    // ── Player input ────────────────────────────────────────────
    socket.on('input', (input) => {
      // Basic validation
      if (typeof input !== 'object') return;
      handleInput(socket.id, {
        up:       !!input.up,
        down:     !!input.down,
        left:     !!input.left,
        right:    !!input.right,
        shooting: !!input.shooting,
        dash:     !!input.dash,
        mouseX:   typeof input.mouseX === 'number' ? input.mouseX : 0,
        mouseY:   typeof input.mouseY === 'number' ? input.mouseY : 0,
      });
    });

    // ── Disconnect ──────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${socket.user?.username} (${socket.id})`);
      leaveRoom(socket.id);
    });
  });

  console.log('[Socket] Handler initialized');
}

module.exports = { initSocketHandler };
