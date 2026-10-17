(function () {
  var s = document.createElement('script');
  s.src = '/socket.io/socket.io.js';
  s.onload = start;
  document.head.appendChild(s);
  var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var peso = function (n) { return '\u20A6' + Number(n || 0).toLocaleString('en-US'); };

  function start() {
    var socket = io(), myId = null, roster = [], visiting = null, home = null;
    var lastJSON = '', lastState = '', lastOthers = '', awaitHome = false, joined = false;
    var startUids = new Set(), hostPlaced = [], pendingAmt = {};

    var st = 'background:#fff6dc;color:#2b2230;border:3px solid #2b2230;font:700 12px system-ui;';
    var btn = document.createElement('button');
    btn.style.cssText = st + 'position:fixed;top:8px;right:8px;z-index:99999;padding:6px 10px';
    var panel = document.createElement('div');
    panel.style.cssText = st + 'position:fixed;top:44px;right:8px;z-index:99999;width:min(300px,92vw);' +
      'max-height:70vh;overflow:auto;padding:8px;display:none';
    panel.innerHTML = '<div id="mpTop"></div><div id="mpList"></div>' +
      '<div style="margin-top:8px">Chat</div>' +
      '<div id="mpChat" style="height:110px;overflow:auto;border:2px solid #2b2230;padding:4px;margin:4px 0"></div>' +
      '<div style="display:flex;gap:4px"><input id="mpIn" maxlength="200" placeholder="Say something" ' +
      'style="flex:1;min-width:0;padding:6px;font-size:14px"><button id="mpSend" style="padding:6px">Send</button></div>';
    document.body.appendChild(btn); document.body.appendChild(panel);
    var $ = function (id) { return panel.querySelector('#' + id); };
    btn.onclick = function () { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; };

    function draw() {
      btn.textContent = '\uD83D\uDC65 ' + roster.length;
      var v = roster.find(function (p) { return p.id === visiting; });
      $('mpTop').innerHTML = visiting
        ? 'Decorating ' + esc(v ? v.name : '?') +
          ' <button data-act="bill">Send bill</button> <button data-act="home">Go home</button>' : '';
      $('mpList').innerHTML = roster.slice().sort(function (a, b) { return b.netWorth - a.netWorth; })
        .map(function (p, i) {
          var me = p.id === myId;
          return '<div style="margin:4px 0">' + (i + 1) + '. ' + esc(p.name) + (me ? ' (you)' : '') +
            ' ' + peso(p.netWorth) + (me ? '' :
            ' <button data-act="visit" data-id="' + p.id + '">Visit</button>' +
            ' <button data-act="pay" data-id="' + p.id + '">Send \u20A6</button>') + '</div>';
        }).join('');
    }

    panel.addEventListener('click', function (e) {
      var t = e.target, act = t.getAttribute && t.getAttribute('data-act'), id = t.getAttribute && t.getAttribute('data-id');
      if (act === 'visit') visit(id);
      if (act === 'home') goHome();
      if (act === 'pay') pay(id);
      if (act === 'bill') sendBill();
    });
    function sendChat() {
      var i = $('mpIn'), t = i.value.trim(); if (!t) return;
      socket.emit('chat', { t: t }); i.value = '';
    }
    $('mpSend').onclick = sendChat;
    $('mpIn').onkeydown = function (e) { if (e.key === 'Enter') sendChat(); };

    function visit(id) {
      var g = window.__hustle; if (!g || id === myId) return;
      if (!visiting) home = { inv: JSON.parse(JSON.stringify(g.inv)) };
      visiting = id; window.__visiting = id; startUids = null; hostPlaced = [];
      g.setSel(null); g.setScreen('flat');
      socket.emit('visit', { hostId: id });
      g.say('Turn on decorating to add pieces');
      draw();
    }
    function goHome() {
      var g = window.__hustle; if (!g || !visiting) return;
      // pieces I left in their flat are no longer in my stock
      var inv = JSON.parse(JSON.stringify(home.inv));
      hostPlaced.forEach(function (i) {
        if (i.by === myId && startUids && !startUids.has(i.uid)) inv[i.id] = Math.max(0, (inv[i.id] || 0) - 1);
      });
      g.setInv(inv);
      visiting = null; awaitHome = true; g.setSel(null);
      socket.emit('leaveVisit');
      draw();
    }
    function sendBill() {
      var fee = Math.floor(Number(prompt('Your decorating fee (\u20A6)? Pieces are billed at shop price plus this fee.', '0')));
      if (fee < 0 || isNaN(fee)) return;
      socket.emit('sendBill', { fee: fee });
    }
    function pay(id) {
      var g = window.__hustle; if (!g) return;
      var p = roster.find(function (q) { return q.id === id; });
      var amt = Math.floor(Number(prompt('Send how much to ' + (p ? p.name : '') + '? (\u20A6)')));
      if (!(amt > 0)) return;
      if (!g.takeMoney(amt)) { alert('Not enough money'); return; }
      socket.emit('sendMoney', { to: id, amt: amt });
      g.say('Sent ' + peso(amt));
    }

    socket.on('hello', function (d) { myId = d.id; });
    socket.on('connect', function () { joined = false; });
    socket.on('roster', function (r) { roster = r; draw(); });
    socket.on('chat', function (m) {
      var c = $('mpChat');
      c.innerHTML += '<div><b>' + esc(m.name) + ':</b> ' + esc(m.t) + '</div>';
      c.scrollTop = c.scrollHeight;
    });
    socket.on('money', function (m) {
      var g = window.__hustle; if (!g) return;
      g.addMoney(m.amt); g.say(m.name + ' paid you ' + peso(m.amt));
    });
    socket.on('billInfo', function (m) { var g = window.__hustle; if (g) g.say(m.msg); });
    socket.on('returned', function (m) {
      var g = window.__hustle; if (!g || visiting) return;
      g.setInv(function (v) {
        var o = Object.assign({}, v);
        m.ids.forEach(function (id) { o[id] = (o[id] || 0) + 1; });
        return o;
      });
      g.say('Your pieces were returned');
    });
    socket.on('hostLeft', function (d) { if (visiting === d.hostId) goHome(); });

    // the owner gets the bill
    socket.on('bill', function (b) {
      var g = window.__hustle; if (!g) return;
      var tot = 0, lines = {};
      b.ids.forEach(function (id) { tot += g.priceOf(id); lines[id] = (lines[id] || 0) + 1; });
      var fee = Math.min(Math.max(0, b.fee | 0), tot), amt = tot + fee;
      var txt = Object.keys(lines).map(function (id) { return lines[id] + ' x ' + (g.names[id] || id); }).join(', ');
      var ok = confirm(b.name + ' decorated your flat.\n' + txt + '\nPieces ' + peso(tot) +
        ' + fee ' + peso(fee) + ' = ' + peso(amt) + '\n\nOK = pay, Cancel = decline and remove the pieces');
      if (ok && g.balance < amt) { alert('Not enough money. Bill declined.'); ok = false; }
      if (ok) { pendingAmt[b.billId] = amt; socket.emit('billReply', { billId: b.billId, accept: true, amount: amt }); }
      else socket.emit('billReply', { billId: b.billId, accept: false });
    });
    socket.on('billResult', function (r) {
      var g = window.__hustle, a = pendingAmt[r.billId]; delete pendingAmt[r.billId];
      if (!g) return;
      if (r.ok && a) { g.takeMoney(a); g.say('Paid ' + peso(a)); }
      else alert('The bill could not be paid. Nothing was charged.');
    });

    socket.on('flatState', function (d) {
      var g = window.__hustle; if (!g) return;
      if (d.hostId !== (visiting || myId)) return;
      if (visiting) {
        hostPlaced = d.placed;
        if (!startUids) startUids = new Set(d.placed.map(function (i) { return i.uid; }));
      }
      var mx = 0; d.placed.forEach(function (i) { if (i.uid > mx) mx = i.uid; });
      if (g.uid.current <= mx) g.uid.current = mx + 1;
      awaitHome = false;
      var j = JSON.stringify(d.placed);
      if (j === lastJSON) return;
      lastJSON = j; g.setPlaced(d.placed);
      if (!visiting) window.__visiting = null;
    });
    window.__visiting = null;

    setInterval(function () {
      var g = window.__hustle; if (!g || !socket.connected) return;
      if (!joined) { socket.emit('join', { name: g.name, who: g.who, netWorth: g.balance }); joined = true; }
      var s = JSON.stringify({ name: g.name, who: g.who, netWorth: g.balance, screen: g.screen, x: g.me.x, y: g.me.y });
      if (s !== lastState) { lastState = s; socket.emit('state', JSON.parse(s)); }
      if (!awaitHome && (!visiting || startUids)) {
        var j = JSON.stringify(g.placed);
        if (j !== lastJSON) {
          lastJSON = j;
          if (visiting) socket.emit('flatEdit', { hostId: visiting, placed: g.placed });
          else socket.emit('myFlat', { placed: g.placed });
        }
      }
      var host = visiting || myId;
      var others = roster.filter(function (p) { return p.id !== myId && p.screen === 'flat' && p.host === host; });
      var o = JSON.stringify(others);
      if (o !== lastOthers) { lastOthers = o; g.setOthers(others); }
    }, 400);
  }
})();
