// network.js — Client-side WebSocket networking for multiplayer

const DEFAULT_PORT = 3001;

let ws = null;
let _role = null;
let _messageHandlers = [];
let _connected = false;

/**
 * Connect to the WebSocket relay server.
 * @param {string} [hostIp] — IP/hostname of the server. Defaults to current page host (localhost).
 * Returns a promise that resolves with the assigned role ('host' or 'guest').
 */
export function connect(hostIp) {
  const host = hostIp || window.location.hostname || "localhost";
  const serverUrl = `ws://${host}:${DEFAULT_PORT}`;
  console.log(`[network] Connecting to ${serverUrl} ...`);

  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(reason));
    };

    const succeed = (role) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(role);
    };

    // 5-second timeout so it doesn't hang forever
    const timeout = setTimeout(() => {
      fail(
        `Connection timed out reaching ${serverUrl}. Is the server running?`,
      );
      if (ws) ws.close();
    }, 5000);

    ws = new WebSocket(serverUrl);

    ws.onopen = () => {
      console.log(`[network] WebSocket opened to ${serverUrl}`);
      _connected = true;
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      // Handle initial role assignment from server
      if (msg.type === "role") {
        console.log(`[network] Assigned role: ${msg.role}`);
        _role = msg.role;
        succeed(msg.role);
        return;
      }

      // Forward all other messages to registered handlers
      for (const handler of _messageHandlers) {
        handler(msg);
      }
    };

    ws.onerror = (e) => {
      console.error(`[network] WebSocket error`, e);
      fail(
        `WebSocket connection failed to ${serverUrl}. Is the server running?`,
      );
    };

    ws.onclose = () => {
      console.log(`[network] WebSocket closed`);
      _connected = false;
      fail(`Connection closed before receiving role from ${serverUrl}.`);
    };
  });
}

/**
 * Send a JSON message to the other player (via relay server).
 */
export function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Register a handler for incoming messages.
 */
export function onMessage(handler) {
  _messageHandlers.push(handler);
}

export function isHost() {
  return _role === "host";
}

export function isGuest() {
  return _role === "guest";
}

export function getRole() {
  return _role;
}

export function isConnected() {
  return _connected;
}
