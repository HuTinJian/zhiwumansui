/* =========================================================================
   临界 · 紧急调度 — 联机层（PeerJS 公共信令 + WebRTC P2P，房间为六位编号）
   说明：房主浏览器跑权威模拟，客户端发指令、收快照；不需要自建服务器。
        房间编号 = 6 位大写字母/数字；房主 Peer ID = zws112-v1-<编号>。
   限制：需要能访问 PeerJS 公共信令与 WebRTC；公司/校园网可能阻断 P2P。
   回退办法：删除 emergency/ 或 revert；单机模式完全不依赖本文件，联机失败不影响单机。
   ========================================================================= */
(function (root) {
  'use strict';
  var EM = root.EM = root.EM || {};
  var U = EM.util;
  var PREFIX = 'zws112-v1-';
  var COLORS = ['#67dcff', '#ffcf66', '#ff8aa1', '#7dffb2'];
  var MAX_PLAYERS = 4;
  var ICE = {
    iceServers: [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.qq.com:3478' }
    ],
    iceCandidatePoolSize: 4
  };

  function ensurePeer(cb) {
    if (typeof root.Peer === 'function') return cb(null);
    return cb('联机模块没有加载（vendor/peerjs.min.js）。请刷新页面或检查网络。');
  }

  function friendlyError(err) {
    var t = err && err.type;
    if (t === 'peer-unavailable') return '找不到这个房间，可能编号输错了，或房主已经离开。';
    if (t === 'unavailable-id') return '房间编号冲突，正在重新生成…';
    if (t === 'network') return '网络连接失败，请检查网络后重试。';
    if (t === 'server-error') return '联机信令服务器暂时不可用，请稍后再试。';
    if (t === 'browser-incompatible') return '当前浏览器不支持 WebRTC，无法联机。';
    if (t === 'webrtc') return 'P2P 通道建立失败，可能是网络限制。试试切换热点或换网络。';
    return (err && (err.message || err.type)) || '未知连接错误';
  }

  var Net = EM.net = {};
  Net.MAX_PLAYERS = MAX_PLAYERS;

  /* ---------------- 房主 ---------------- */
  Net.createHost = function (opts) {
    opts = opts || {};
    var host = {
      role: 'host', code: null, state: 'connecting', players: [], maxPlayers: MAX_PLAYERS,
      conns: {}, peer: null, closed: false, started: false, ping: 0,
      onLobby: opts.onLobby || function () { },
      onStart: opts.onStart || function () { },
      onCommand: opts.onCommand || function () { },
      onClose: opts.onClose || function () { },
      onError: opts.onError || function () { },
      onPlayerLeave: opts.onPlayerLeave || function () { }
    };
    var self = host;
    var tries = 0;

    function makeCode() {
      var code = U.roomCode();
      if (host.players.some(function (p) { return false; }) || host.code === code) return makeCode();
      return code;
    }

    var code = makeCode();
    host.code = code;

    function emitLobby() {
      self.onLobby(self.players.slice(), { code: self.code, state: self.state, maxPlayers: MAX_PLAYERS });
    }
    emitLobby();

    function open(codeToUse) {
      ensurePeer(function (err) {
        if (err) { self.state = 'error'; self.onError(err); return; }
        self.peer = new root.Peer(PREFIX + codeToUse, {
          debug: 0,
          config: ICE
        });
        self.peer.on('open', function () {
          self.code = codeToUse;
          self.state = 'lobby';
          self.players = [{
            id: 'p1', name: opts.name || '指挥官', color: COLORS[0], isHost: true, slot: 0
          }];
          emitLobby();
        });
        self.peer.on('connection', function (conn) {
          if (self.closed) { try { conn.close(); } catch (e) { } return; }
          if (self.state === 'playing' || self.players.length >= MAX_PLAYERS) {
            try { conn.send({ t: 'reject', reason: self.state === 'playing' ? '行动已经开始' : '房间已满' }); } catch (e) { }
            setTimeout(function () { try { conn.close(); } catch (e) { } }, 300);
            return;
          }
          var slot = -1;
          for (var s = 1; s < MAX_PLAYERS; s++) {
            if (!self.players.some(function (p) { return p.slot === s; })) { slot = s; break; }
          }
          if (slot < 0) { try { conn.close(); } catch (e) { } return; }
          var player = {
            id: 'p' + (slot + 1), name: '调度员', color: COLORS[slot], isHost: false, slot: slot, conn: conn
          };
          conn.on('open', function () {
            // 等客户端发 join
          });
          conn.on('data', function (msg) {
            if (!msg || typeof msg !== 'object') return;
            if (msg.t === 'join') {
              if (player.joined) return;
              player.joined = true;
              player.name = String(msg.name || '调度员').slice(0, 12) || '调度员';
              self.conns[conn.peer] = conn;
              self.players.push(player);
              try {
                conn.send({
                  t: 'welcome', playerId: player.id, code: self.code, players: self.players.map(publicPlayer),
                  maxPlayers: MAX_PLAYERS
                });
              } catch (e) { }
              emitLobby();
              self._broadcastLobby();
              return;
            }
            if (msg.t === 'cmd' && self.started) {
              self.onCommand(player.id, msg);
              return;
            }
            if (msg.t === 'ping') {
              try { conn.send({ t: 'pong', ts: msg.ts }); } catch (e) { }
            }
          });
          var remove = function () {
            if (!player.joined) return;
            player.joined = false;
            self.players = self.players.filter(function (p) { return p.id !== player.id; });
            delete self.conns[conn.peer];
            emitLobby();
            self._broadcastLobby();
            self.onPlayerLeave(player);
          };
          conn.on('close', remove);
          conn.on('error', remove);
        });
        self.peer.on('error', function (err) {
          if (err && err.type === 'unavailable-id' && !self.started && tries < 4) {
            tries++;
            try { self.peer.destroy(); } catch (e) { }
            open(makeCode());
            return;
          }
          if (err && err.type === 'peer-unavailable') return; // 房主端不关心
          self.onError(friendlyError(err));
        });
        self.peer.on('disconnected', function () {
          // 信令断开时尝试重连；已经建立的 P2P 仍可继续
          if (!self.closed) { try { self.peer.reconnect(); } catch (e) { } }
        });
      });
    }

    function publicPlayer(p) {
      return { id: p.id, name: p.name, color: p.color, isHost: !!p.isHost, slot: p.slot };
    }
    host.publicPlayers = function () { return self.players.map(publicPlayer); };

    host._broadcastLobby = function () {
      var msg = { t: 'lobby', players: self.players.map(publicPlayer) };
      for (var k in self.conns) {
        try { self.conns[k].send(msg); } catch (e) { }
      }
    };

    host.start = function (config) {
      if (self.state === 'playing') return false;
      self.state = 'playing';
      self.started = true;
      emitLobby();
      var msg = { t: 'start', config: config };
      for (var k in self.conns) {
        try { self.conns[k].send(msg); } catch (e) { }
      }
      self.onStart(config);
      return true;
    };

    host.broadcastSnapshot = function (snap) {
      if (self.state !== 'playing') return;
      var msg = { t: 'snap', d: snap };
      for (var k in self.conns) {
        try { self.conns[k].send(msg); } catch (e) { }
      }
    };

    host.broadcast = function (msg) {
      for (var k in self.conns) {
        try { self.conns[k].send(msg); } catch (e) { }
      }
    };

    host.close = function (reason) {
      if (self.closed) return;
      self.closed = true;
      self.state = 'closed';
      self.broadcast({ t: 'end', reason: reason || '房主关闭了房间' });
      setTimeout(function () {
        try { self.peer && self.peer.destroy(); } catch (e) { }
        self.onClose(reason || '房主关闭了房间');
      }, 60);
    };

    host.kickAll = function () { host.close('房主关闭了房间'); };

    open(code);
    return host;
  };

  /* ---------------- 加入者 ---------------- */
  Net.join = function (opts) {
    opts = opts || {};
    var code = String(opts.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    var client = {
      role: 'guest', code: code, state: 'connecting', playerId: null, players: [],
      peer: null, conn: null, closed: false, ping: 0, lastSnapAt: 0,
      onLobby: opts.onLobby || function () { },
      onStart: opts.onStart || function () { },
      onSnapshot: opts.onSnapshot || function () { },
      onNotice: opts.onNotice || function () { },
      onClose: opts.onClose || function () { },
      onError: opts.onError || function () { },
      sendCommand: function (msg) {
        if (!client.conn || !client.conn.open) return false;
        try { client.conn.send(Object.assign({ t: 'cmd' }, msg)); return true; } catch (e) { return false; }
      },
      close: function () {
        if (client.closed) return;
        client.closed = true;
        client.state = 'closed';
        try { client.conn && client.conn.close(); } catch (e) { }
        try { client.peer && client.peer.destroy(); } catch (e) { }
      }
    };
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setTimeout(function () { client.onError('请先输入 6 位房间编号。'); }, 0);
      return client;
    }
    ensurePeer(function (err) {
      if (err) { client.state = 'error'; client.onError(err); return; }
      client.peer = new root.Peer({ debug: 0, config: ICE });
      var joinTimeout = setTimeout(function () {
        if (client.state === 'connecting') {
          client.onError('连接超时。确认编号正确，且房主仍在大厅等待。');
          client.close();
        }
      }, 18000);
      client._joinTimeout = joinTimeout;
      client.peer.on('open', function () {
        var conn = client.conn = client.peer.connect(PREFIX + code, { reliable: true });
        conn.on('open', function () {
          try { conn.send({ t: 'join', name: String(opts.name || '调度员').slice(0, 12) || '调度员' }); } catch (e) { }
        });
        conn.on('data', function (msg) {
          if (!msg || typeof msg !== 'object') return;
          if (msg.t === 'welcome') {
            clearTimeout(joinTimeout);
            client.playerId = msg.playerId;
            client.players = msg.players || [];
            client.state = 'lobby';
            client.onLobby(client.players, { code: code, state: 'lobby', maxPlayers: msg.maxPlayers || MAX_PLAYERS });
            return;
          }
          if (msg.t === 'lobby') {
            client.players = msg.players || [];
            client.onLobby(client.players, { code: code, state: client.state, maxPlayers: MAX_PLAYERS });
            return;
          }
          if (msg.t === 'start') {
            clearTimeout(joinTimeout);
            client.state = 'playing';
            client.onStart(msg.config || {});
            return;
          }
          if (msg.t === 'snap') {
            client.lastSnapAt = Date.now();
            client.onSnapshot(msg.d);
            return;
          }
          if (msg.t === 'pong') {
            client.ping = Math.max(0, Date.now() - (msg.ts || Date.now()));
            return;
          }
          if (msg.t === 'notice') {
            if (client.onNotice) client.onNotice(msg.text || '');
            return;
          }
          if (msg.t === 'end') {
            client.onClose(msg.reason || '房主结束了行动');
            client.close();
            return;
          }
          if (msg.t === 'reject') {
            clearTimeout(joinTimeout);
            client.onError(msg.reason || '无法加入房间');
            client.close();
          }
        });
        conn.on('close', function () {
          if (client.closed) return;
          client.onClose('与房主的连接已断开');
          client.close();
        });
        conn.on('error', function (e) {
          client.onError(friendlyError(e));
        });
      });
      client.peer.on('error', function (e) {
        if (e && e.type === 'peer-unavailable') {
          clearTimeout(joinTimeout);
          client.onError(friendlyError(e));
          client.close();
          return;
        }
        client.onError(friendlyError(e));
      });
    });

    var pingTimer = setInterval(function () {
      if (client.closed || !client.conn || !client.conn.open) return;
      try { client.conn.send({ t: 'ping', ts: Date.now() }); } catch (e) { }
    }, 2500);
    client.close = (function (origClose) {
      return function () {
        clearInterval(pingTimer);
        clearTimeout(client._joinTimeout);
        origClose();
      };
    })(client.close);
    return client;
  };

  // 供 UI 展示的玩家颜色
  Net.COLORS = COLORS;
})(window);
