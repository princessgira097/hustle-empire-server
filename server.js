const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
let players = {};
io.on('connection', (socket) => {
  socket.on('joinEmpire', (data) => {
    players[socket.id] = { id: socket.id, name: (data.name || "Hustler").slice(0,20), netWorth: data.netWorth || 0, level: data.level || 1 };
    socket.join('hustle-empire');
    io.to('hustle-empire').emit('empireUpdate', Object.values(players));
  });
  socket.on('updateEmpire', (data) => {
    if(players[socket.id]){ players[socket.id].netWorth = data.netWorth; players[socket.id].level = data.level; }
    io.to('hustle-empire').emit('empireUpdate', Object.values(players));
  });
  socket.on('disconnect', () => {
    delete players[socket.id];
    io.to('hustle-empire').emit('empireUpdate', Object.values(players));
  });
});
app.get('/', (req,res) => res.send('Hustle Empire Chairman is LIVE'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Live on '+PORT));
