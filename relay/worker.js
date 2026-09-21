// Fractalize remote-control relay (Cloudflare Worker + Durable Object).
//
// A phone "remote" and the desktop "host" each open a WebSocket to the same
// room; this relay just forwards every text message from one to the other.
// It never inspects, stores or logs message contents. One Durable Object
// instance per room, using the WebSocket Hibernation API so an idle room
// costs (almost) nothing.
//
//   wss://<worker>/room/<roomId>?role=host    (the desktop showing the QR)
//   wss://<worker>/room/<roomId>?role=remote  (the phone that scanned it)
//
// Rules: one host + one remote per room (a newer socket replaces an older
// one of the same role, so reconnects work). Room ids must be long random
// strings. Messages are size- and rate-capped. Only the origins below may
// open a connection from a browser.

const ALLOWED_ORIGINS = [
  "https://fractalize.studio",
  "https://www.fractalize.studio",
  // Local development / testing only -- safe to remove for production.
  "http://localhost:5500",
  "http://localhost:5501",
];

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
const MAX_HOST_MESSAGE = 65536; // host sends the full state; can be sizeable
const MAX_REMOTE_MESSAGE = 4096; // remote only ever sends small commands
const MAX_MESSAGES_PER_SECOND = 40;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!match) return new Response("Fractalize relay", { status: 200 });

    const origin = request.headers.get("Origin");
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const roomId = match[1];
    if (!ROOM_ID_PATTERN.test(roomId)) {
      return new Response("Bad room id", { status: 400 });
    }
    const role = url.searchParams.get("role");
    if (role !== "host" && role !== "remote") {
      return new Response("Bad role", { status: 400 });
    }
    const id = env.ROOM.idFromName(roomId);
    return env.ROOM.get(id).fetch(request);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    // Answered by the runtime without waking the object -- clients send
    // "ping" every ~25s to keep idle connections open through proxies.
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // Per-socket message timestamps for rate limiting. In-memory only; it
    // is fine for this to reset when the object hibernates.
    this.recent = new WeakMap();
  }

  async fetch(request) {
    const role = new URL(request.url).searchParams.get("role");
    const other = role === "host" ? "remote" : "host";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // A newer connection of the same role replaces the older one.
    for (const old of this.state.getWebSockets(role)) {
      try {
        old.close(4000, "replaced");
      } catch (e) {}
    }
    this.state.acceptWebSocket(server, [role]);

    const peers = this.state.getWebSockets(other);
    server.send(JSON.stringify({ t: "sys", ev: "welcome", role, peer: peers.length > 0 }));
    for (const p of peers) {
      try {
        p.send(JSON.stringify({ t: "sys", ev: "peer-joined", role }));
      } catch (e) {}
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string") return; // text only
    const role = this.state.getTags(ws)[0];
    const limit = role === "host" ? MAX_HOST_MESSAGE : MAX_REMOTE_MESSAGE;
    if (message.length > limit) {
      ws.close(1009, "message too large");
      return;
    }
    const now = Date.now();
    const stamps = (this.recent.get(ws) || []).filter((t) => now - t < 1000);
    if (stamps.length >= MAX_MESSAGES_PER_SECOND) {
      ws.close(1008, "rate limit");
      return;
    }
    stamps.push(now);
    this.recent.set(ws, stamps);

    const other = role === "host" ? "remote" : "host";
    for (const p of this.state.getWebSockets(other)) {
      try {
        p.send(message);
      } catch (e) {}
    }
  }

  webSocketClose(ws) {
    this.peerLeft(ws);
  }

  webSocketError(ws) {
    this.peerLeft(ws);
  }

  peerLeft(ws) {
    const role = this.state.getTags(ws)[0];
    if (!role) return;
    const other = role === "host" ? "remote" : "host";
    for (const p of this.state.getWebSockets(other)) {
      try {
        p.send(JSON.stringify({ t: "sys", ev: "peer-left", role }));
      } catch (e) {}
    }
    try {
      ws.close();
    } catch (e) {}
  }
}
