// multiplayer/gameServer.js
// Server-authoritative game logic for 2-player co-op
// Handles rooms, enemies, wave progression, and state sync

const TICK_RATE       = 20;          // 20 updates/sec to clients
const TICK_MS         = 1000 / TICK_RATE;
const CANVAS_W        = 900;
const CANVAS_H        = 600;
const PLAYER_SPEED    = 250;
const PLAYER_MAX_HP   = 100;
const BULLET_SPEED    = 520;
const BULLET_RADIUS   = 5;
const ENEMY_RADIUS    = 18;
const PLAYER_RADIUS   = 18;
const WAVE_BREAK_TIME = 5;           // seconds between waves
const MAX_ENEMIES     = 60;

// ─── Enemy stats by type ──────────────────────────────────────
const ENEMY_STATS = {
  basic:    { hp: 30,  speed: 90,  damage: 10, score: 10,  radius: 18, color: '#e74c3c' },
  fast:     { hp: 15,  speed: 170, damage: 8,  score: 15,  radius: 12, color: '#e67e22' },
  tank:     { hp: 90,  speed: 55,  damage: 20, score: 25,  radius: 26, color: '#8e44ad' },
  shooter:  { hp: 35,  speed: 75,  damage: 10, score: 20,  radius: 16, color: '#2980b9' },
  miniboss: { hp: 200, speed: 60,  damage: 25, score: 75,  radius: 30, color: '#c0392b' },
};

let nextId = 1;
function uid() { return (nextId++).toString(36); }

// ─── Room manager ─────────────────────────────────────────────
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateRoomCode() : code;
}

function createRoom(hostSocket, hostUser) {
  const code = generateRoomCode();
  const room = {
    code,
    state:   'waiting',   // waiting | countdown | playing | gameover
    players: {},
    enemies: {},
    bullets: {},
    wave:         1,
    waveClearTimer: 0,
    spawnTimer:   0,
    score:        0,
    coins:        0,
    tick:         0,
    intervalId:   null,
    lastTick:     Date.now(),
  };

  _addPlayer(room, hostSocket, hostUser, true);
  rooms.set(code, room);
  console.log(`[MP] Room created: ${code} by ${hostUser.username}`);
  return room;
}

function joinRoom(code, socket, user) {
  const room = rooms.get(code.toUpperCase());
  if (!room)                           return { error: 'Room not found' };
  if (room.state !== 'waiting')        return { error: 'Game already started' };
  if (Object.keys(room.players).length >= 2) return { error: 'Room is full' };

  _addPlayer(room, socket, user, false);
  console.log(`[MP] ${user.username} joined room ${code}`);
  return { room };
}

function leaveRoom(socketId) {
  for (const [code, room] of rooms.entries()) {
    if (room.players[socketId]) {
      delete room.players[socketId];
      console.log(`[MP] Player left room ${code}`);

      if (Object.keys(room.players).length === 0) {
        _destroyRoom(code);
      } else {
        // Notify remaining player
        _broadcastToRoom(room, 'partner_left', {});
        if (room.state === 'playing') _endGame(room, 'partner_disconnected');
      }
      return;
    }
  }
}

function _addPlayer(room, socket, user, isHost) {
  const startX = isHost ? 300 : 600;
  room.players[socket.id] = {
    socketId:  socket.id,
    uid:       user.uid,
    username:  user.username,
    skin:      user.activeSkin || 'agent',
    x:         startX,
    y:         CANVAS_H / 2,
    vx:        0,
    vy:        0,
    hp:        PLAYER_MAX_HP,
    maxHp:     PLAYER_MAX_HP,
    angle:     0,
    alive:     true,
    isHost,
    input:     { up: false, down: false, left: false, right: false, shooting: false, mouseX: startX, mouseY: CANVAS_H / 2 },
    shootCooldown: 0,
    reviveTimer:   0,
    score:         0,
    kills:         0,
    socket,
  };
}

function _destroyRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.intervalId) clearInterval(room.intervalId);
  rooms.delete(code);
  console.log(`[MP] Room destroyed: ${code}`);
}

// ─── Game start ───────────────────────────────────────────────
function startGame(room) {
  room.state = 'playing';
  room.lastTick = Date.now();
  room.intervalId = setInterval(() => _tick(room), TICK_MS);
  _broadcastToRoom(room, 'game_start', { wave: room.wave });
  console.log(`[MP] Game started in room ${room.code}`);
}

// ─── Main tick ────────────────────────────────────────────────
function _tick(room) {
  if (room.state !== 'playing') return;

  const now = Date.now();
  const dt  = Math.min((now - room.lastTick) / 1000, 0.1); // seconds, capped at 100ms
  room.lastTick = now;
  room.tick++;

  _updatePlayers(room, dt);
  _updateBullets(room, dt);
  _updateEnemies(room, dt);
  _checkCollisions(room);
  _updateWave(room, dt);

  // Send state to all players every tick
  _broadcastState(room);
}

// ─── Player update ────────────────────────────────────────────
function _updatePlayers(room, dt) {
  for (const p of Object.values(room.players)) {
    if (!p.alive) {
      // Revive countdown
      if (p.reviveTimer > 0) {
        p.reviveTimer -= dt;
        if (p.reviveTimer <= 0) _revivePlayer(room, p);
      }
      continue;
    }

    const { up, down, left, right } = p.input;
    let dx = 0, dy = 0;
    if (up)    dy -= 1;
    if (down)  dy += 1;
    if (left)  dx -= 1;
    if (right) dx += 1;

    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    if (dx !== 0 || dy !== 0) {
      p.x += (dx / len) * PLAYER_SPEED * dt;
      p.y += (dy / len) * PLAYER_SPEED * dt;
    }

    p.x = Math.max(PLAYER_RADIUS, Math.min(CANVAS_W - PLAYER_RADIUS, p.x));
    p.y = Math.max(PLAYER_RADIUS, Math.min(CANVAS_H - PLAYER_RADIUS, p.y));

    p.angle = Math.atan2(p.input.mouseY - p.y, p.input.mouseX - p.x);

    // Shooting
    p.shootCooldown = Math.max(0, p.shootCooldown - dt);
    if (p.input.shooting && p.shootCooldown <= 0) {
      _spawnBullet(room, p);
      p.shootCooldown = 0.15; // 150ms between shots
    }
  }
}

function _spawnBullet(room, player) {
  const id = uid();
  room.bullets[id] = {
    id,
    ownerId: player.socketId,
    x:  player.x,
    y:  player.y,
    vx: Math.cos(player.angle) * BULLET_SPEED,
    vy: Math.sin(player.angle) * BULLET_SPEED,
    life: 2.0, // seconds before auto-removal
  };
}

// ─── Bullet update ────────────────────────────────────────────
function _updateBullets(room, dt) {
  for (const [id, b] of Object.entries(room.bullets)) {
    b.x    += b.vx * dt;
    b.y    += b.vy * dt;
    b.life -= dt;

    if (b.life <= 0 || b.x < -50 || b.x > CANVAS_W + 50 || b.y < -50 || b.y > CANVAS_H + 50) {
      delete room.bullets[id];
    }
  }
}

// ─── Enemy update ─────────────────────────────────────────────
function _updateEnemies(room, dt) {
  const playerList = Object.values(room.players).filter(p => p.alive);

  for (const [id, e] of Object.entries(room.enemies)) {
    if (!e.alive) { delete room.enemies[id]; continue; }

    // Move toward nearest player
    let nearest = null, nearestDist = Infinity;
    for (const p of playerList) {
      const dist = Math.hypot(p.x - e.x, p.y - e.y);
      if (dist < nearestDist) { nearestDist = dist; nearest = p; }
    }

    if (nearest) {
      const dx = nearest.x - e.x;
      const dy = nearest.y - e.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      e.x += (dx / len) * e.speed * dt;
      e.y += (dy / len) * e.speed * dt;
    }
  }
}

// ─── Collision detection ──────────────────────────────────────
function _checkCollisions(room) {
  const playerList = Object.values(room.players);

  // Bullets vs enemies
  for (const [bid, b] of Object.entries(room.bullets)) {
    for (const [eid, e] of Object.entries(room.enemies)) {
      if (!e.alive) continue;
      const dist = Math.hypot(b.x - e.x, b.y - e.y);
      if (dist < BULLET_RADIUS + e.radius) {
        e.hp -= 20; // bullet damage
        delete room.bullets[bid];

        if (e.hp <= 0) {
          e.alive = false;
          room.score  += e.score;
          room.coins  += Math.floor(e.score * 0.5);

          // Credit the shooter
          const shooter = room.players[b.ownerId];
          if (shooter) { shooter.score += e.score; shooter.kills++; }
        }
        break;
      }
    }
  }

  // Enemies vs players
  for (const e of Object.values(room.enemies)) {
    if (!e.alive) continue;
    for (const p of playerList) {
      if (!p.alive) continue;
      const dist = Math.hypot(p.x - e.x, p.y - e.y);
      if (dist < PLAYER_RADIUS + e.radius) {
        p.hp -= e.damage * 0.016; // damage per frame equivalent
        if (p.hp <= 0) _killPlayer(room, p);
      }
    }
  }
}

// ─── Player death / revive ────────────────────────────────────
function _killPlayer(room, player) {
  player.alive      = false;
  player.hp         = 0;
  player.reviveTimer = 10; // 10 second auto-revive

  _broadcastToRoom(room, 'player_died', { socketId: player.socketId, username: player.username });

  // Check if both players are dead
  const allDead = Object.values(room.players).every(p => !p.alive);
  if (allDead) _endGame(room, 'all_dead');
}

function _revivePlayer(room, player) {
  player.alive      = true;
  player.hp         = PLAYER_MAX_HP * 0.5; // revive with 50% HP
  player.reviveTimer = 0;
  _broadcastToRoom(room, 'player_revived', { socketId: player.socketId });
}

// ─── Wave management ──────────────────────────────────────────
function _updateWave(room, dt) {
  const aliveEnemies = Object.values(room.enemies).filter(e => e.alive).length;

  if (room.waveClearTimer > 0) {
    room.waveClearTimer -= dt;
    if (room.waveClearTimer <= 0) {
      room.wave++;
      room.waveClearTimer = 0;
      _broadcastToRoom(room, 'wave_start', { wave: room.wave });
    }
    return;
  }

  // Spawn enemies
  if (aliveEnemies < MAX_ENEMIES) {
    room.spawnTimer -= dt;
    if (room.spawnTimer <= 0) {
      _spawnEnemy(room);
      // Spawn interval decreases with wave (faster spawns = harder)
      room.spawnTimer = Math.max(0.4, 2.0 - room.wave * 0.08);
    }
  }

  // Check wave clear (all enemies dead, none spawning for a moment)
  if (aliveEnemies === 0 && room.spawnTimer <= 0 && room.tick > 60) {
    const targetCount = 8 + room.wave * 3;
    const totalKills  = Object.values(room.players).reduce((s, p) => s + p.kills, 0);
    if (totalKills >= targetCount) {
      room.waveClearTimer = WAVE_BREAK_TIME;
      _broadcastToRoom(room, 'wave_clear', { wave: room.wave, nextWave: room.wave + 1 });
    }
  }
}

function _spawnEnemy(room) {
  // Spawn off-screen edges
  const edge = Math.floor(Math.random() * 4);
  let x, y;
  if (edge === 0) { x = Math.random() * CANVAS_W; y = -30; }
  else if (edge === 1) { x = CANVAS_W + 30; y = Math.random() * CANVAS_H; }
  else if (edge === 2) { x = Math.random() * CANVAS_W; y = CANVAS_H + 30; }
  else { x = -30; y = Math.random() * CANVAS_H; }

  const rand = Math.random();
  let type = 'basic';
  if (room.wave >= 3 && rand < 0.03)       type = 'miniboss';
  else if (room.wave >= 3 && rand < 0.20)  type = 'shooter';
  else if (room.wave >= 2 && rand < 0.40)  type = 'tank';
  else if (rand < 0.60)                    type = 'fast';

  const stats = ENEMY_STATS[type];
  const id    = uid();
  room.enemies[id] = {
    id,
    type,
    x, y,
    hp:     stats.hp + room.wave * 5,
    maxHp:  stats.hp + room.wave * 5,
    speed:  stats.speed,
    damage: stats.damage,
    score:  stats.score,
    radius: stats.radius,
    color:  stats.color,
    alive:  true,
  };
}

// ─── End game ─────────────────────────────────────────────────
function _endGame(room, reason) {
  if (room.state === 'gameover') return;
  room.state = 'gameover';
  if (room.intervalId) { clearInterval(room.intervalId); room.intervalId = null; }

  const results = Object.values(room.players).map(p => ({
    uid:      p.uid,
    username: p.username,
    score:    p.score,
    kills:    p.kills,
    survived: p.alive,
  }));

  _broadcastToRoom(room, 'game_over', {
    reason,
    wave:    room.wave,
    score:   room.score,
    coins:   room.coins,
    results,
  });

  // Clean up after 30s
  setTimeout(() => _destroyRoom(room.code), 30000);
}

// ─── State broadcast ──────────────────────────────────────────
function _broadcastState(room) {
  const state = {
    players: Object.values(room.players).map(p => ({
      socketId: p.socketId,
      username: p.username,
      skin:     p.skin,
      x: p.x, y: p.y,
      angle: p.angle,
      hp: p.hp, maxHp: p.maxHp,
      alive: p.alive,
      reviveTimer: p.reviveTimer,
      score: p.score,
      kills: p.kills,
    })),
    enemies: Object.values(room.enemies).filter(e => e.alive).map(e => ({
      id: e.id, type: e.type,
      x: e.x, y: e.y,
      hp: e.hp, maxHp: e.maxHp,
      radius: e.radius, color: e.color,
    })),
    bullets: Object.values(room.bullets).map(b => ({
      id: b.id, x: b.x, y: b.y,
    })),
    wave:  room.wave,
    score: room.score,
    coins: room.coins,
    waveClearTimer: room.waveClearTimer,
  };

  _broadcastToRoom(room, 'state', state);
}

function _broadcastToRoom(room, event, data) {
  for (const p of Object.values(room.players)) {
    p.socket.emit(event, data);
  }
}

// ─── Input handler ────────────────────────────────────────────
function handleInput(socketId, input) {
  for (const room of rooms.values()) {
    const player = room.players[socketId];
    if (player) {
      Object.assign(player.input, input);
      return;
    }
  }
}

// ─── Public API ───────────────────────────────────────────────
module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  startGame,
  handleInput,
  rooms,
};
