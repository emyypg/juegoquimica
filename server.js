// Vaso Caliente: servidor del juego (Node.js + Socket.IO).
// Sirve las páginas de /public y maneja las partidas en memoria.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const QRCode = require("qrcode");

const PORT = process.env.PORT || 3000;
const FAST = process.env.FAST === "1"; // modo rápido para pruebas automáticas
const PUB = path.join(__dirname, "public");
// Contraseña para crear partidas desde /host. NO se escribe en el código (el repositorio es público):
// se lee de la variable de entorno ADMIN_PASSWORD o, si no existe, del archivo admin-password.txt
// (que está en .gitignore y no se sube a GitHub). Si no hay ninguna, cualquiera puede crear partidas.
function readAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD.trim();
  try { return fs.readFileSync(path.join(__dirname, "admin-password.txt"), "utf8").trim(); } catch (e) { return ""; }
}
const ADMIN_PASSWORD = readAdminPassword();
const SPEED_MS = 1500, SPEED_PTS = 50; // sacarse el vaso rápido da puntos extra

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ---------- Servidor web ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/qr.svg") {
    const text = url.searchParams.get("t") || "";
    if (!text || text.length > 300) { res.writeHead(400); return res.end(); }
    try {
      const svg = await QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#1b1326", light: "#ffffff" } });
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      return res.end(svg);
    } catch (e) { res.writeHead(500); return res.end(); }
  }
  if (url.pathname === "/salud") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }

  let p = url.pathname;
  if (p === "/") p = "/index.html";
  if (p === "/host" || p === "/presentar") p = "/host.html";
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("No encontrado"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });

// ---------- Reglas y tiempos ----------
const T = FAST
  ? { count: 120, fuseMin: 1200, fuseMax: 2000, pause: 300, botMin: 120, botMax: 300, anti: 150, autopass: 300, minLeft: 300 }
  : { count: 1000, fuseMin: 12000, fuseMax: 24000, pause: 3800, botMin: 900, botMax: 2600, anti: 5000, autopass: 1800, minLeft: 1500 };
const MAX_PLAYERS = 30;
const MAX_OPTIONS = 4;
// Identidad de cada jugador: 6 colores x 5 figuras = 30 combinaciones únicas.
const COLORS = ["rojo", "azul", "amarillo", "verde", "violeta", "naranja"];
const SHAPES = ["triangulo", "circulo", "cuadrado", "rombo", "estrella"];
const IDENTS = Array.from({ length: 30 }, (_, i) => ({ color: COLORS[i % 6], shape: SHAPES[(i % 6 + 2 * Math.floor(i / 6)) % 5] }));
const NEED_NORMAL = 3, NEED_ANTI = 1, NEED_DOUBLE = 6;
const P_ANTI = 0.55; // probabilidad de que lo que cae sea antiácido (si no, doble ácido)
const DROP_MIN = FAST ? 300 : 5000, DROP_MAX = FAST ? 600 : 10000, LAND = FAST ? 80 : 780, MAX_ANTI = 2;
const GHOST_CUT = FAST ? 10 : 60, GHOST_CAP = FAST ? 200 : 3000;
const BOT_NAMES = ["Bot Ácido", "Bot Base", "Bot Repollo", "Bot Burbuja", "Bot Probeta", "Bot Pipeta"];

const rooms = new Map();
const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function newPin() {
  let p;
  do { p = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(p));
  return p;
}

function createRoom(socket) {
  const room = {
    pin: newPin(), hostKey: rid(), hostSid: socket.id,
    players: new Map(), state: "lobby", round: 0, maxRounds: 3,
    holder: null, lastFrom: null, taps: 0, need: NEED_NORMAL, options: [], banned: new Set(),
    fuseTimer: null, explodeAt: 0, fuseTotal: 0, ghostCut: 0,
    startCount: 0, elimOrder: [], timers: new Set(), lastWinner: null, lastVictim: null,
    cleanup: null,
  };
  rooms.set(room.pin, room);
  return room;
}

function later(room, ms, fn) {
  const t = setTimeout(() => { room.timers.delete(t); fn(); }, ms);
  room.timers.add(t);
  return t;
}
function clearAll(room) {
  room.timers.forEach(clearTimeout); room.timers.clear();
  if (room.fuseTimer) { clearTimeout(room.fuseTimer); room.fuseTimer = null; }
}

// Filtro básico de malas palabras para los nombres (la admin igual puede bannear).
const BAD = ["puto", "puta", "mierda", "verga", "pija", "poronga", "concha", "culo", "orto", "forro", "garch", "coger", "cojer", "sexo", "porno", "nazi", "hitler", "pelotud", "boludo", "boluda", "trola", "trolo", "chota", "teta", "pito", "mogolic", "retrasad", "negro de mierda", "puton", "zorra", "idiota", "imbecil", "estupid", "cancer", "violad", "fuck", "shit", "bitch", "dick", "cock", "pussy", "nigg", "sex"];
function isBad(name) {
  const n = String(name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/@/g, "a").replace(/\$/g, "s")
    .replace(/[^a-zñ ]/g, "");
  const squeezed = n.replace(/\s+/g, "").replace(/(.)\1+/g, "$1");
  return BAD.some((w) => n.includes(w) || squeezed.includes(w.replace(/\s+/g, "").replace(/(.)\1+/g, "$1")));
}

function cleanName(raw, room) {
  let n = String(raw || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 14);
  if (!n) return null;
  const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  if (!taken.has(n.toLowerCase())) return n;
  for (let i = 2; i < 100; i++) {
    const c = (n.slice(0, 11) + " " + i);
    if (!taken.has(c.toLowerCase())) return c;
  }
  return null;
}

function freeIdent(room) {
  const used = new Set([...room.players.values()].map((p) => p.ident));
  for (let i = 0; i < IDENTS.length; i++) if (!used.has(i)) return i;
  return -1;
}
const identOf = (p) => IDENTS[p.ident] || IDENTS[0];
const st = (p) => p.stats || (p.stats = { holds: 0, passes: 0, fastest: null, to: {}, anti: 0, ghost: 0 });

// Premios divertidos para el final
function awards(room) {
  const ps = [...room.players.values()];
  const out = [];
  const best = (fn, better) => { let b = null, v = null; ps.forEach((p) => { const x = fn(p); if (x === null || x === undefined || x <= 0) return; if (v === null || better(x, v)) { v = x; b = p; } }); return b ? { p: b, v } : null; };
  const card = (key, title, r, desc) => { if (r) out.push({ key, title, id: r.p.id, name: r.p.name, color: identOf(r.p).color, shape: identOf(r.p).shape, desc: desc(r) }); };
  card("rapido", "Manos rápidas", best((p) => st(p).fastest, (a, b) => a < b), (r) => "Se sacó el vaso en " + (r.v / 1000).toFixed(1).replace(".", ",") + " s");
  card("iman", "Imán de ácido", best((p) => st(p).holds, (a, b) => a > b), (r) => "Tuvo el vaso " + r.v + " veces");
  const rev = best((p) => Math.max(0, ...Object.values(st(p).to)), (a, b) => a > b);
  card("vengativo", "Vengativo", rev && rev.v >= 2 ? rev : null, (r) => { const t = Object.entries(st(r.p).to).sort((a, b) => b[1] - a[1])[0]; const tp = room.players.get(t[0]); return "Le tiró el vaso " + r.v + " veces a " + (tp ? tp.name : "alguien"); });
  card("salvado", "Salvado por el antiácido", best((p) => st(p).anti, (a, b) => a > b), (r) => "Le cayeron " + r.v + (r.v === 1 ? " antiácido" : " antiácidos"));
  card("fantasma", "Fantasma molesto", best((p) => st(p).ghost, (a, b) => a > b), (r) => "Hizo ¡Bu! " + r.v + " veces");
  return out;
}

const alive = (room) => [...room.players.values()].filter((p) => p.alive);
const aliveOnline = (room) => alive(room).filter((p) => p.connected);

function standings(room) {
  return [...room.players.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((p, i) => ({ id: p.id, name: p.name, score: p.score, rank: i + 1, bot: p.bot, color: identOf(p).color, shape: identOf(p).shape }));
}

// ---------- Envío de estado ----------
function hostView(room) {
  return {
    pin: room.pin, state: room.state, round: room.round, maxRounds: room.maxRounds,
    holder: room.holder, need: room.need, taps: room.taps,
    lastWinner: room.lastWinner, lastVictim: room.lastVictim,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score, alive: p.alive, connected: p.connected, bot: p.bot, late: p.late, color: identOf(p).color, shape: identOf(p).shape })),
    options: room.options, picking: room.state === "playing" && !!room.holder && room.taps >= room.need,
    paused: !!room.paused, awards: room.state === "final" ? awards(room) : null,
    standings: standings(room),
  };
}
function playerView(room, p) {
  const st = standings(room);
  const me = st.find((s) => s.id === p.id);
  const holderP = room.holder ? room.players.get(room.holder) : null;
  const isHolder = room.holder === p.id && room.state === "playing";
  let targets = null;
  if (isHolder && room.taps >= room.need) {
    targets = room.options.map((id) => room.players.get(id)).filter(Boolean).map((o) => ({ id: o.id, name: o.name, color: identOf(o).color, shape: identOf(o).shape }));
  }
  return {
    pin: room.pin, state: room.state, round: room.round, maxRounds: room.maxRounds, paused: !!room.paused,
    me: { id: p.id, name: p.name, score: p.score, alive: p.alive, late: p.late, rank: me ? me.rank : null, color: identOf(p).color, shape: identOf(p).shape },
    total: room.players.size,
    holder: isHolder, holderName: holderP ? holderP.name : null,
    need: room.need, taps: isHolder ? room.taps : 0, targets,
    lastWinner: room.lastWinner, lastVictim: room.lastVictim,
    top: st.slice(0, 3),
  };
}
const takenList = (room) => [...room.players.values()].map((p) => p.ident);
function push(room) {
  io.to("peek:" + room.pin).emit("taken", { taken: takenList(room), full: room.players.size >= MAX_PLAYERS });
  io.to(room.hostSid).emit("room", hostView(room));
  room.players.forEach((p) => { if (p.sid && !p.bot) io.to(p.sid).emit("view", playerView(room, p)); });
}
function hostEvent(room, ev) { io.to(room.hostSid).emit("event", ev); }
function fx(room, p, kind) { if (p && p.sid && !p.bot) io.to(p.sid).emit("fx", kind); }
function sendFuse(room) {
  const f = { remaining: room.paused ? room.pausedLeft : Math.max(0, room.explodeAt - Date.now()), total: room.fuseTotal, paused: !!room.paused };
  io.to(room.hostSid).emit("fuse", f);
  room.players.forEach((p) => { if (p.sid && !p.bot) io.to(p.sid).emit("fuse", f); });
}

// ---------- Desarrollo de la partida ----------
function startRound(room) {
  clearAll(room);
  room.paused = false;
  room.round += 1;
  room.players.forEach((p) => { p.alive = p.connected; p.late = false; });
  room.elimOrder = []; room.lastWinner = null; room.lastVictim = null;
  room.startCount = alive(room).length;
  room.state = "countdown";
  push(room);
  [3, 2, 1].forEach((n, i) => later(room, i * T.count, () => {
    io.to(room.hostSid).emit("countdown", n);
    room.players.forEach((p) => p.sid && io.to(p.sid).emit("countdown", n));
  }));
  later(room, 3 * T.count, () => {
    room.state = "playing";
    giveTo(room, pick(aliveOnline(room)).id, null, false);
    startFuse(room);
    push(room);
  });
}

function startFuse(room) {
  const n = alive(room).length;
  let dur = rand(T.fuseMin, T.fuseMax);
  if (n <= 3) dur *= 0.75;
  room.fuseTotal = dur;
  room.explodeAt = Date.now() + dur;
  room.ghostCut = 0;
  room.antiCount = 0;
  armFuse(room);
  scheduleDrop(room);
}

// ---------- Lluvia de sorpresas: caen al azar mientras el vaso está en juego ----------
function scheduleDrop(room) {
  const gen = (room.dropGen = (room.dropGen || 0) + 1);
  later(room, rand(DROP_MIN, DROP_MAX), () => drop(room, gen));
}
function drop(room, gen) {
  if (room.dropGen !== gen || room.state !== "playing" || !room.holder) return;
  const left = room.explodeAt - Date.now();
  let kind = Math.random() < P_ANTI ? "anti" : "double";
  if (kind === "anti" && room.antiCount >= MAX_ANTI) kind = "double";
  if (kind === "double" && left < T.minLeft * 2 + LAND) { scheduleDrop(room); return; } // no rematar un vaso que ya está por explotar
  hostEvent(room, { type: "drop", kind });
  room.players.forEach((p) => fx(room, p, "drop"));
  // el efecto se aplica cuando cae dentro del vaso, al que lo tenga en ese momento
  later(room, LAND, () => {
    if (room.dropGen !== gen || room.state !== "playing" || !room.holder) return;
    const now = Date.now(), l = room.explodeAt - now;
    if (kind === "anti") {
      room.antiCount++;
      const hh = room.players.get(room.holder); if (hh) st(hh).anti++;
      room.explodeAt += T.anti;
      room.need = Math.min(room.need, NEED_ANTI);
    } else {
      room.explodeAt = now + Math.max(T.minLeft, l * 0.55);
      if (room.taps < room.need) room.need = NEED_DOUBLE;
    }
    room.fuseTotal = Math.max(room.fuseTotal, room.explodeAt - now);
    armFuse(room);
    const h = room.players.get(room.holder);
    hostEvent(room, { type: "land", kind, holder: room.holder });
    fx(room, h, kind);
    if (h && h.bot) botTurn(room, h.id);
    push(room);
    scheduleDrop(room);
  });
}
function pauseGame(room) {
  if (room.state !== "playing" || room.paused) return;
  room.paused = true; room.pausedAt = Date.now();
  room.pausedLeft = Math.max(0, room.explodeAt - Date.now());
  if (room.fuseTimer) { clearTimeout(room.fuseTimer); room.fuseTimer = null; }
  room.dropGen = (room.dropGen || 0) + 1; // cancela lo que estaba cayendo
  sendFuse(room); push(room);
}
function resumeGame(room) {
  if (!room.paused) return;
  room.paused = false;
  room.holdStart = (room.holdStart || Date.now()) + (Date.now() - room.pausedAt);
  room.explodeAt = Date.now() + room.pausedLeft;
  armFuse(room); scheduleDrop(room);
  const h = room.players.get(room.holder);
  if (h && h.bot) botTurn(room, h.id);
  if (h && !h.bot && !h.connected) later(room, T.autopass, () => autoPass(room, h.id));
  push(room);
}
function armFuse(room) {
  if (room.paused) return sendFuse(room);
  if (room.fuseTimer) clearTimeout(room.fuseTimer);
  room.fuseTimer = setTimeout(() => explode(room), Math.max(0, room.explodeAt - Date.now()));
  sendFuse(room);
}

function giveTo(room, toId, fromId, allowPower) {
  room.lastFrom = fromId;
  room.holder = toId;
  room.taps = 0;
  room.need = NEED_NORMAL;
  room.options = pickOptions(room, toId);
  const to = room.players.get(toId);
  if (to) st(to).holds++;
  room.holdStart = Date.now();
  hostEvent(room, { type: "pass", from: fromId, to: toId, power: null, bonus: room.lastBonus || 0 });
  room.lastBonus = 0;
  fx(room, to, "got");
  if (to && !to.connected && !to.bot) later(room, T.autopass, () => autoPass(room, toId));
  if (to && to.bot) botTurn(room, toId);
}

function pickOptions(room, holderId) {
  const pool = validTargets(room, holderId).slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, MAX_OPTIONS).map((p) => p.id);
}
function refreshOptions(room) {
  if (room.state !== "playing" || !room.holder) return;
  const ok = room.options.filter((id) => { const p = room.players.get(id); return p && p.alive && p.connected && id !== room.holder; });
  if (ok.length !== room.options.length || !ok.length) room.options = pickOptions(room, room.holder);
}

function validTargets(room, fromId) {
  const others = aliveOnline(room).filter((o) => o.id !== fromId);
  const f = others.filter((o) => o.id !== room.lastFrom);
  return f.length ? f : others;
}

function doPass(room, fromId, toId) {
  if (room.state !== "playing" || room.holder !== fromId || room.paused) return;
  const from = room.players.get(fromId);
  if (from) {
    const s2 = st(from), dt = Date.now() - (room.holdStart || Date.now());
    s2.passes++; s2.to[toId] = (s2.to[toId] || 0) + 1;
    if (s2.fastest === null || dt < s2.fastest) s2.fastest = dt;
    if (dt <= SPEED_MS) { from.score += SPEED_PTS; room.lastBonus = SPEED_PTS; fx(room, from, "fast"); }
  }
  giveTo(room, toId, fromId, true);
  push(room);
}

function autoPass(room, id) {
  if (room.state !== "playing" || room.holder !== id || room.paused) return;
  const p = room.players.get(id);
  if (p && p.connected) return;
  refreshOptions(room);
  if (!room.options.length) return checkStuck(room);
  doPass(room, id, pick(room.options));
}

function botTurn(room, id) {
  later(room, rand(T.botMin, T.botMax), () => {
    if (room.state !== "playing" || room.holder !== id || room.paused) return;
    refreshOptions(room);
    if (room.options.length) doPass(room, id, pick(room.options));
  });
}

function explode(room) {
  room.fuseTimer = null;
  if (room.state !== "playing") return;
  const victim = room.players.get(room.holder);
  if (victim) {
    victim.alive = false;
    room.elimOrder.push(victim.id);
    victim.score += (room.elimOrder.length - 1) * 100;
    room.lastVictim = victim.name;
    fx(room, victim, "boom");
  }
  room.players.forEach((p) => { if (p !== victim) fx(room, p, "boomOther"); });
  hostEvent(room, { type: "boom", id: victim ? victim.id : null, name: victim ? victim.name : "" });
  room.state = "boom";
  room.holder = null;
  room.options = [];
  push(room);
  later(room, T.pause, () => {
    const left = aliveOnline(room);
    if (left.length >= 2) {
      room.state = "playing";
      giveTo(room, pick(left).id, null, false);
      startFuse(room);
      push(room);
    } else {
      endRound(room, left[0] || alive(room)[0] || null);
    }
  });
}

function endRound(room, winner) {
  clearAll(room);
  room.paused = false;
  room.holder = null;
  room.options = [];
  if (winner) {
    winner.score += Math.max(0, room.startCount - 1) * 100 + 200;
    room.lastWinner = winner.name;
  }
  room.state = "roundEnd";
  hostEvent(room, { type: "roundEnd", winner: winner ? winner.name : null });
  push(room);
}

function checkStuck(room) {
  if (room.state !== "playing") return;
  if (aliveOnline(room).length < 2) {
    const w = aliveOnline(room)[0] || alive(room)[0] || null;
    endRound(room, w);
  }
}

function addBots(room, n) {
  const used = new Set([...room.players.values()].map((p) => p.name));
  let added = 0;
  for (const name of BOT_NAMES) {
    if (added >= n || room.players.size >= MAX_PLAYERS) break;
    if (used.has(name)) continue;
    const id = "bot-" + rid();
    const ident = freeIdent(room); if (ident < 0) break;
    room.players.set(id, { id, name, ident, score: 0, alive: false, connected: true, sid: null, bot: true, late: false, lastTap: 0, lastGhost: 0 });
    added++;
  }
}

// ---------- Conexiones ----------
io.on("connection", (socket) => {
  socket.data.pin = null; socket.data.pid = null; socket.data.host = false;
  const room = () => rooms.get(socket.data.pin);
  const isHost = () => { const r = room(); return r && socket.data.host && r.hostSid === socket.id; };

  // Presentador
  socket.on("host:info", (_, ack) => { if (typeof ack === "function") ack({ needPassword: !!ADMIN_PASSWORD }); });
  socket.data.tries = 0;
  socket.on("host:create", (data, ack) => {
    if (ADMIN_PASSWORD) {
      const pw = data && typeof data.password === "string" ? data.password : "";
      if (socket.data.tries >= 10) { if (typeof ack === "function") ack({ ok: false, error: "Demasiados intentos. Recargá la página." }); return; }
      if (pw !== ADMIN_PASSWORD) { socket.data.tries++; if (typeof ack === "function") ack({ ok: false, error: "Contraseña incorrecta." }); return; }
    }
    const r = createRoom(socket);
    socket.data.pin = r.pin; socket.data.host = true;
    if (typeof ack === "function") ack({ ok: true, pin: r.pin, hostKey: r.hostKey });
    push(r);
  });
  socket.on("host:resume", ({ pin, hostKey } = {}, ack) => {
    const r = rooms.get(String(pin));
    if (!r || r.hostKey !== hostKey) { if (typeof ack === "function") ack({ ok: false }); return; }
    r.hostSid = socket.id; socket.data.pin = r.pin; socket.data.host = true;
    if (r.cleanup) { clearTimeout(r.cleanup); r.cleanup = null; }
    if (typeof ack === "function") ack({ ok: true, pin: r.pin, hostKey: r.hostKey });
    push(r); if (r.state === "playing") sendFuse(r);
  });
  socket.on("host:start", () => {
    if (!isHost()) return; const r = room();
    if (r.state === "lobby" || r.state === "roundEnd") {
      if (r.state === "roundEnd" && r.round >= r.maxRounds) { r.state = "final"; hostEvent(r, { type: "final" }); push(r); return; }
      const ready = [...r.players.values()].filter((p) => p.connected).length;
      if (ready < 2) { socket.emit("aviso", "Se necesitan al menos 2 jugadores conectados."); return; }
      startRound(r);
    }
  });
  socket.on("host:rounds", (n) => {
    if (!isHost()) return; const r = room();
    if (r.state !== "lobby") return;
    const v = parseInt(n, 10); if ([1, 3, 5, 7].includes(v)) r.maxRounds = v; push(r);
  });
  socket.on("host:bots", () => {
    if (!isHost()) return; const r = room(); if (r.state !== "lobby") return;
    addBots(r, 3); push(r);
  });
  socket.on("host:ban", (id) => {
    if (!isHost()) return; const r = room(); const p = r.players.get(id); if (!p) return;
    if (p.device) r.banned.add(p.device);
    removePlayer(r, p, "banned");
  });
  socket.on("host:kick", (id) => {
    if (!isHost()) return; const r = room(); const p = r.players.get(id); if (!p) return;
    removePlayer(r, p, "kicked");
  });
  function removePlayer(r, p, why) {
    const id = p.id;
    if (r.state === "playing" || r.state === "countdown" || r.state === "boom") {
      if (r.holder === id) { const t = validTargets(r, id); if (t.length) doPass(r, id, pick(t).id); }
    }
    r.players.delete(id);
    refreshOptions(r);
    if (p.sid) { io.to(p.sid).emit(why); const s = io.sockets.sockets.get(p.sid); if (s) { s.data.pin = null; s.data.pid = null; } }
    checkStuck(r); push(r);
  }
  socket.on("host:pause", () => { if (!isHost()) return; pauseGame(room()); });
  socket.on("host:unpause", () => { if (!isHost()) return; resumeGame(room()); });
  socket.on("host:restart", () => {
    if (!isHost()) return; const r = room();
    clearAll(r); r.paused = false;
    r.players.forEach((p) => { p.score = 0; p.alive = false; p.late = false; p.stats = null; });
    r.round = 0; r.state = "lobby"; r.holder = null; r.lastWinner = null; r.lastVictim = null;
    push(r);
  });
  socket.on("host:final", () => {
    if (!isHost()) return; const r = room();
    clearAll(r); r.paused = false; r.holder = null; r.state = "final"; hostEvent(r, { type: "final" }); push(r);
  });

  // Jugadores
  socket.on("room:peek", ({ pin, device } = {}, ack) => {
    const reply = (o) => { if (typeof ack === "function") ack(o); };
    const r = rooms.get(String(pin || "").trim());
    if (!r) return reply({ ok: false, error: "No existe una partida con ese PIN." });
    if (device && r.banned.has(String(device))) return reply({ ok: false, banned: true, error: "No podés entrar a esta partida." });
    socket.join("peek:" + r.pin);
    reply({ ok: true, pin: r.pin, idents: IDENTS, taken: takenList(r), full: r.players.size >= MAX_PLAYERS });
  });

  socket.on("player:join", ({ pin, name, pid, ident: want, device, resume } = {}, ack) => {
    const reply = (o) => { if (typeof ack === "function") ack(o); };
    const r = rooms.get(String(pin || "").trim());
    if (!r) return reply({ ok: false, error: "No existe una partida con ese PIN." });
    device = String(device || "").slice(0, 64);
    if (device && r.banned.has(device)) return reply({ ok: false, banned: true, error: "No podés entrar a esta partida." });
    let p = pid && r.players.get(pid);
    if (resume && !(p && !p.bot)) return reply({ ok: false, gone: true });
    if (p && !p.bot) {
      p.sid = socket.id; p.connected = true;
      if (r.state === "playing" && r.holder && r.options.length < MAX_OPTIONS && p.alive && p.id !== r.holder) r.options = pickOptions(r, r.holder);
    } else {
      if (r.players.size >= MAX_PLAYERS) return reply({ ok: false, error: "La partida está llena." });
      if (isBad(name)) return reply({ ok: false, field: "name", error: "Ese nombre no está permitido. Elegí otro." });
      const n = cleanName(name, r);
      if (!n) return reply({ ok: false, field: "name", error: "Escribí un nombre." });
      const id = "p-" + rid();
      const playing = r.state !== "lobby";
      let ident = -1;
      const used = new Set(takenList(r));
      const w = parseInt(want, 10);
      if (Number.isInteger(w) && w >= 0 && w < IDENTS.length) {
        if (used.has(w)) return reply({ ok: false, field: "ident", error: "Ese personaje lo acaba de elegir otro. Elegí otro.", taken: [...used] });
        ident = w;
      } else ident = freeIdent(r);
      if (ident < 0) return reply({ ok: false, error: "La partida está llena." });
      p = { id, name: n, ident, device, score: 0, alive: false, connected: true, sid: socket.id, bot: false, late: playing, lastTap: 0, lastGhost: 0 };
      r.players.set(id, p);
    }
    socket.leave("peek:" + r.pin);
    socket.data.pin = r.pin; socket.data.pid = p.id; socket.data.host = false;
    reply({ ok: true, pid: p.id, name: p.name, pin: r.pin, color: identOf(p).color, shape: identOf(p).shape });
    push(r);
  });

  socket.on("player:tap", () => {
    const r = room(); if (!r) return; const p = r.players.get(socket.data.pid); if (!p) return;
    if (r.state !== "playing" || r.holder !== p.id || r.paused) return;
    const now = Date.now(); if (now - p.lastTap < 45) return; p.lastTap = now;
    if (r.taps < r.need) {
      r.taps++;
      io.to(r.hostSid).emit("tap", { id: p.id, taps: r.taps, need: r.need });
      if (r.taps >= r.need) { refreshOptions(r); push(r); } else socket.emit("view", playerView(r, p));
    }
  });
  socket.on("player:pass", (to) => {
    const r = room(); if (!r) return; const p = r.players.get(socket.data.pid); if (!p) return;
    if (r.state !== "playing" || r.holder !== p.id || r.taps < r.need) return;
    const t = r.players.get(to);
    if (r.options.includes(to) && t && t.alive && t.connected) doPass(r, p.id, to);
    else { refreshOptions(r); push(r); }
  });
  socket.on("player:ghost", () => {
    const r = room(); if (!r) return; const p = r.players.get(socket.data.pid); if (!p) return;
    if (r.state !== "playing" || p.alive || r.paused) return;
    const now = Date.now(); if (now - p.lastGhost < 250) return; p.lastGhost = now;
    st(p).ghost++;
    hostEvent(r, { type: "ghost", id: p.id });
    if (r.ghostCut < GHOST_CAP && r.explodeAt - now > T.minLeft + GHOST_CUT) {
      r.ghostCut += GHOST_CUT; r.explodeAt -= GHOST_CUT; armFuse(r);
    }
    const h = r.players.get(r.holder); fx(r, h, "haunt");
  });

  socket.on("disconnect", () => {
    const r = room(); if (!r) return;
    if (socket.data.host && r.hostSid === socket.id) {
      r.cleanup = setTimeout(() => { clearAll(r); rooms.delete(r.pin); }, 15 * 60 * 1000);
      return;
    }
    const p = r.players.get(socket.data.pid);
    if (p && p.sid === socket.id) {
      p.connected = false; p.sid = null;
      if (r.state === "lobby") { r.players.delete(p.id); }
      else if (r.state === "playing" && r.holder === p.id) later(r, T.autopass, () => autoPass(r, p.id));
      else if (r.state === "playing" && r.options.includes(p.id)) refreshOptions(r);
      push(r);
      later(r, 200, () => checkStuck(r));
    }
  });
});

server.listen(PORT, () => {
  console.log("Vaso Caliente listo en el puerto " + PORT);
  console.log("Pantalla grande: http://localhost:" + PORT + "/host");
  console.log(ADMIN_PASSWORD ? "Contraseña de admin: activada." : "Aviso: no hay contraseña de admin (ADMIN_PASSWORD o admin-password.txt). Cualquiera puede crear partidas.");
});
