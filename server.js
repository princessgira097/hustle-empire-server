const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'Hustle_Empire.html')));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e6 });

const players = {};
let dirty = false, billSeq = 0;
const lastChat = {};
const EDITABLE = ['x', 'y', 'x3', 'y3', 's', 'flip', 'ry', 'on', 'lc', 'tint', 'spd'];
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').slice(0, n);
const num = (v) => (isFinite(+v) ? +v : 0);
const pending = (i) => i.by && i.bill !== 'paid';
const roster = () => Object.values(players).map((p) => ({
  id: p.id, name: p.name, who: p.who, netWorth: p.netWorth,
  screen: p.screen, host: p.host, x: p.x, y: p.y }));
const pushFlat = (h) => io.to('flat:' + h.id).emit('flatState', { hostId: h.id, placed: h.placed });

function leaveRoom(socket) {
  const p = players[socket.id];
  if (p && p.host !== socket.id) socket.leave('flat:' + p.host);
  if (p) p.host = socket.id;
}
function returnItems(list) {
  const by = {};
  list.forEach((i) => { (by[i.by] = by[i.by] || []).push(i.id); });
  Object.keys(by).forEach((k) => io.to(k).emit('returned', { ids: by[k] }));
}

io.on('connection', (socket) => {
  socket.on('join', (d) => {
    d = d || {};
    players[socket.id] = { id: socket.id, name: clean(d.name, 16) || 'Hustler',
      who: d.who === 'male' ? 'male' : 'female', netWorth: num(d.netWorth),
      screen: 'pick', host: socket.id, x: 14, y: 62, placed: [], bills: {} };
    socket.join('flat:' + socket.id);
    socket.emit('hello', { id: socket.id });
    dirty = true;
  });

  socket.on('state', (d) => {
    const p = players[socket.id]; if (!p || !d) return;
    p.name = clean(d.name, 16) || p.name;
    p.who = d.who === 'male' ? 'male' : 'female';
    p.netWorth = num(d.netWorth);
    p.screen = clean(d.screen, 12);
    p.x = num(d.x); p.y = num(d.y);
    dirty = true;
  });

  // the owner sends their own flat
  socket.on('myFlat', (d) => {
    const p = players[socket.id];
    if (!p || p.host !== socket.id || !d || !Array.isArray(d.placed)) return;
    if (JSON.stringify(d.placed).length > 400000) return;
    const keep = new Set(d.placed.map((i) => i && i.uid));
    returnItems(p.placed.filter((i) => pending(i) && !keep.has(i.uid)));
    p.placed = d.placed;
    pushFlat(p);
  });

  socket.on('visit', (d) => {
    const p = players[socket.id], h = d && players[d.hostId];
    if (!p || !h) return;
    leaveRoom(socket);
    p.host = d.hostId;
    socket.join('flat:' + d.hostId);
    socket.emit('flatState', { hostId: d.hostId, placed: h.placed });
    dirty = true;
  });

  socket.on('leaveVisit', () => {
    const p = players[socket.id]; if (!p) return;
    leaveRoom(socket);
    socket.emit('flatState', { hostId: socket.id, placed: p.placed });
    dirty = true;
  });

  // a visitor can move things, add their own pieces, and take back their own unbilled pieces
  socket.on('flatEdit', (d) => {
    const p = players[socket.id];
    if (!p || !d || p.host !== d.hostId || !Array.isArray(d.placed)) return;
    const h = players[d.hostId]; if (!h || h.id === socket.id) return;
    const revert = () => socket.emit('flatState', { hostId: h.id, placed: h.placed });
    if (d.placed.length > 300) return revert();
    const cur = new Map(h.placed.map((i) => [i.uid, i]));
    const inc = new Map();
    for (const i of d.placed) {
      if (!i || typeof i.uid !== 'number' || inc.has(i.uid)) return revert();
      inc.set(i.uid, i);
    }
    for (const [uid, i] of cur) {
      if (!inc.has(uid) && !(i.by === socket.id && i.bill === 'open')) return revert();
    }
    const out = [];
    for (const i of h.placed) {
      const n = inc.get(i.uid); if (!n) continue;
      const o = { ...i };
      EDITABLE.forEach((k) => { if (k in n) o[k] = n[k]; });
      out.push(o);
    }
    for (const [uid, n] of inc) {
      if (cur.has(uid)) continue;
      if (typeof n.id !== 'string' || n.id.length > 40) return revert();
      const o = { uid, id: n.id, by: socket.id, bill: 'open' };
      EDITABLE.forEach((k) => { if (k in n) o[k] = n[k]; });
      out.push(o);
    }
    h.placed = out;
    pushFlat(h);
  });

  // the decorator sends the bill
  socket.on('sendBill', (d) => {
    const p = players[socket.id]; if (!p || !d || p.host === socket.id) return;
    const h = players[p.host]; if (!h) return;
    const mine = h.placed.filter((i) => i.by === socket.id && i.bill === 'open');
    if (!mine.length) { socket.emit('billInfo', { msg: 'Add some pieces first' }); return; }
    const fee = Math.max(0, Math.floor(+d.fee) || 0);
    const billId = 'b' + (++billSeq);
    mine.forEach((i) => { i.bill = 'sent'; });
    h.bills[billId] = { from: socket.id, uids: mine.map((i) => i.uid) };
    io.to(h.id).emit('bill', { billId, from: socket.id, name: p.name, ids: mine.map((i) => i.id), fee });
    socket.emit('billInfo', { msg: 'Bill sent to ' + h.name });
    pushFlat(h);
  });

  // the owner pays or declines
  socket.on('billReply', (d) => {
    const h = players[socket.id];
    if (!h || !d || !h.bills[d.billId]) return;
    const b = h.bills[d.billId]; delete h.bills[d.billId];
    const there = h.placed.filter((i) => b.uids.includes(i.uid));
    if (d.accept) {
      const amt = Math.floor(+d.amount);
      if (!there.length || !players[b.from] || !(amt > 0 && amt <= 1e12)) {
        socket.emit('billResult', { billId: d.billId, ok: false }); return;
      }
      there.forEach((i) => { i.bill = 'paid'; });
      io.to(b.from).emit('money', { from: h.id, name: h.name, amt });
      socket.emit('billResult', { billId: d.billId, ok: true });
    } else {
      returnItems(there);
      h.placed = h.placed.filter((i) => !b.uids.includes(i.uid));
      if (players[b.from]) io.to(b.from).emit('billInfo', { msg: h.name + ' declined the bill. Pieces returned.' });
    }
    pushFlat(h);
  });

  socket.on('chat', (d) => {
    const p = players[socket.id]; if (!p || !d) return;
    const now = Date.now();
    if (now - (lastChat[socket.id] || 0) < 300) return;
    lastChat[socket.id] = now;
    const t = clean(d.t, 200).trim(); if (!t) return;
    io.emit('chat', { id: socket.id, name: p.name, t });
  });

  socket.on('sendMoney', (d) => {
    const p = players[socket.id]; if (!p || !d) return;
    const amt = Math.floor(+d.amt);
    if (!(amt > 0 && amt <= 1e12) || !players[d.to] || d.to === socket.id) return;
    io.to(d.to).emit('money', { from: socket.id, name: p.name, amt });
  });

  socket.on('disconnect', () => {
    io.to('flat:' + socket.id).emit('hostLeft', { hostId: socket.id });
    delete players[socket.id]; delete lastChat[socket.id];
    dirty = true;
  });
});

setInterval(() => { if (dirty) { dirty = false; io.emit('roster', roster()); } }, 250);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Live on ' + PORT));
