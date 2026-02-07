// server.js — WebSocket relay server for 2-player localhost multiplayer

import { WebSocketServer } from "ws";
import { networkInterfaces } from "os";

const PORT = 3001;
const wss = new WebSocketServer({ host: "0.0.0.0", port: PORT });

let host = null;
let guest = null;

wss.on("connection", (ws) => {
  if (!host) {
    host = ws;
    ws._role = "host";
    ws.send(JSON.stringify({ type: "role", role: "host" }));
    console.log("[server] Host connected");
  } else if (!guest) {
    guest = ws;
    ws._role = "guest";
    ws.send(JSON.stringify({ type: "role", role: "guest" }));
    console.log("[server] Guest connected");
    // Notify host that guest joined
    if (host.readyState === ws.OPEN) {
      host.send(JSON.stringify({ type: "guest_join" }));
    }
  } else {
    ws.send(JSON.stringify({ type: "error", message: "Room is full" }));
    ws.close();
    return;
  }

  ws.on("message", (data) => {
    const other = ws === host ? guest : host;
    if (other && other.readyState === ws.OPEN) {
      // Relay as text string (ws receives Buffers, must convert for browser clients)
      other.send(data.toString());
    }
  });

  ws.on("close", () => {
    console.log(`[server] ${ws._role} disconnected`);
    if (ws === host) {
      host = null;
      if (guest && guest.readyState === 1) {
        guest.send(JSON.stringify({ type: "peer_disconnect" }));
      }
    } else if (ws === guest) {
      guest = null;
      if (host && host.readyState === 1) {
        host.send(JSON.stringify({ type: "peer_disconnect" }));
      }
    }
  });
});

// Print LAN IP so the host can share it with the guest
const nets = networkInterfaces();
const lanIPs = [];
for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    if (net.family === "IPv4" && !net.internal) {
      lanIPs.push(net.address);
    }
  }
}

console.log(`[server] WebSocket relay running on ws://0.0.0.0:${PORT}`);
if (lanIPs.length > 0) {
  console.log(
    `[server] Share this IP with the guest player: ${lanIPs.join(", ")}`,
  );
} else {
  console.log(
    `[server] Could not detect LAN IP. Use 'localhost' for same-machine testing.`,
  );
}
