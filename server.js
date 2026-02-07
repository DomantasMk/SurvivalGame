// server.js — WebSocket relay server for up to 5-player localhost multiplayer

import { WebSocketServer } from "ws";
import { networkInterfaces } from "os";

const PORT = 3001;
const MAX_PLAYERS = 5;
const wss = new WebSocketServer({ host: "0.0.0.0", port: PORT });

// Map of ws -> { role, playerIndex }
const clients = new Map();
let nextPlayerIndex = 0;

function broadcastPlayerList() {
  const playerIndices = [];
  for (const [, info] of clients) {
    playerIndices.push(info.playerIndex);
  }
  playerIndices.sort((a, b) => a - b);
  const msg = JSON.stringify({ type: "player_list", players: playerIndices });
  for (const [ws] of clients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

function getHostWs() {
  for (const [ws, info] of clients) {
    if (info.role === "host") return ws;
  }
  return null;
}

wss.on("connection", (ws) => {
  if (clients.size >= MAX_PLAYERS) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Room is full (max 5 players)",
      }),
    );
    ws.close();
    return;
  }

  const isHost = clients.size === 0;
  const role = isHost ? "host" : "guest";
  const playerIndex = nextPlayerIndex++;

  clients.set(ws, { role, playerIndex });

  ws.send(JSON.stringify({ type: "role", role, playerIndex }));
  console.log(
    `[server] Player ${playerIndex} connected as ${role} (${clients.size}/${MAX_PLAYERS})`,
  );

  // Broadcast updated player list to everyone
  broadcastPlayerList();

  ws.on("message", (data) => {
    const senderInfo = clients.get(ws);
    if (!senderInfo) return;

    if (senderInfo.role === "host") {
      // Host messages -> broadcast to ALL guests
      const dataStr = data.toString();
      for (const [clientWs, clientInfo] of clients) {
        if (clientInfo.role === "guest" && clientWs.readyState === 1) {
          clientWs.send(dataStr);
        }
      }
    } else {
      // Guest messages -> forward to host only
      const hostWs = getHostWs();
      if (hostWs && hostWs.readyState === 1) {
        hostWs.send(data.toString());
      }
    }
  });

  ws.on("close", () => {
    const info = clients.get(ws);
    if (!info) return;
    console.log(
      `[server] Player ${info.playerIndex} (${info.role}) disconnected`,
    );
    clients.delete(ws);

    if (info.role === "host") {
      // Host disconnected — notify all remaining guests
      const msg = JSON.stringify({ type: "peer_disconnect" });
      for (const [clientWs] of clients) {
        if (clientWs.readyState === 1) {
          clientWs.send(msg);
        }
      }
    } else {
      // A guest disconnected — broadcast updated player list
      broadcastPlayerList();
    }
  });
});

// Print LAN IP so the host can share it with other players
const nets = networkInterfaces();
const lanIPs = [];
for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    if (net.family === "IPv4" && !net.internal) {
      lanIPs.push(net.address);
    }
  }
}

console.log(
  `[server] WebSocket relay running on ws://0.0.0.0:${PORT} (max ${MAX_PLAYERS} players)`,
);
if (lanIPs.length > 0) {
  console.log(
    `[server] Share this IP with other players: ${lanIPs.join(", ")}`,
  );
} else {
  console.log(
    `[server] Could not detect LAN IP. Use 'localhost' for same-machine testing.`,
  );
}
