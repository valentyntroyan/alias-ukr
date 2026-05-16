const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const rooms = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? makeRoomCode() : code;
}

function normalizeWords(words) {
  if (Array.isArray(words)) {
    return words.map(word => String(word).trim()).filter(Boolean);
  }

  return String(words || "")
    .split(/\r?\n|,/)
    .map(word => word.trim())
    .filter(Boolean);
}

function createRoom() {
  const code = makeRoomCode();
  const room = {
    code,
    players: [],
    clients: new Set(),
    words: [],
    deck: [],
    used: [],
    currentWord: "",
    score: 0,
    scoreTarget: 50,
    skips: 0,
    turnPlayerId: "",
    roundActive: false,
    roundEndsAt: 0,
    roundSeconds: 60,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function getPublicState(room, viewerId = "") {
  const canSeeWord = room.roundActive && viewerId && viewerId === room.turnPlayerId;

  return {
    code: room.code,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      points: Number(player.points || 0)
    })),
    wordCount: room.words.length,
    usedCount: room.used.length,
    currentWord: canSeeWord ? room.currentWord : "",
    score: room.score,
    scoreTarget: room.scoreTarget,
    skips: room.skips,
    turnPlayerId: room.turnPlayerId,
    roundActive: room.roundActive,
    roundEndsAt: room.roundEndsAt,
    roundSeconds: room.roundSeconds
  };
}

function broadcast(room) {
  room.updatedAt = Date.now();

  for (const client of [...room.clients]) {
    const payload = `event: state\ndata: ${JSON.stringify(getPublicState(room, client.playerId))}\n\n`;
    client.res.write(payload);
  }
}

function shuffle(words) {
  const deck = [...words];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function nextWord(room) {
  if (!room.deck.length) {
    const recycled = room.used.length ? room.used : room.words;
    room.deck = shuffle(recycled);
    room.used = [];
  }
  room.currentWord = room.deck.pop() || "";
}

function rotateTurn(room) {
  if (room.players.length < 2 || !room.turnPlayerId) return;
  const currentIndex = room.players.findIndex(player => player.id === room.turnPlayerId);
  if (currentIndex === -1) return;
  room.turnPlayerId = room.players[(currentIndex + 1) % room.players.length].id;
}

function endRound(room) {
  if (!room.roundActive) return;
  room.roundActive = false;
  room.roundEndsAt = 0;
  room.currentWord = "";
  rotateTurn(room);
  broadcast(room);
}

function scheduleRoundEnd(room) {
  const ms = Math.max(0, room.roundEndsAt - Date.now());
  setTimeout(() => {
    if (room.roundActive && Date.now() >= room.roundEndsAt) {
      endRound(room);
    }
  }, ms + 100);
}

function cleanupRooms() {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const [code, room] of rooms.entries()) {
    if (!room.clients.size && room.updatedAt < cutoff) {
      rooms.delete(code);
    }
  }
}

setInterval(cleanupRooms, 30 * 60 * 1000).unref();

async function handleApi(req, res) {
  try {
    if (req.method === "POST" && req.url === "/api/rooms") {
      const body = await readBody(req);
      const room = createRoom();
      const player = {
        id: crypto.randomUUID(),
        name: String(body.name || "Player").trim().slice(0, 24) || "Player",
        points: 0
      };
      room.players.push(player);
      json(res, 201, { room: getPublicState(room, player.id), player });
      return;
    }

    if (req.method === "POST" && req.url === "/api/join") {
      const body = await readBody(req);
      const code = String(body.code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        json(res, 404, { error: "Room not found" });
        return;
      }

      let player = room.players.find(existing => existing.id === body.playerId);
      if (!player) {
        if (room.players.length >= 2) {
          json(res, 409, { error: "Room already has two players" });
          return;
        }
        player = {
          id: crypto.randomUUID(),
          name: String(body.name || "Player").trim().slice(0, 24) || "Player",
          points: 0
        };
        room.players = [...room.players, player];
      }

      broadcast(room);
      json(res, 200, { room: getPublicState(room, player.id), player });
      return;
    }

    const parsedUrl = new URL(req.url, "http://localhost");

    if (req.method === "GET" && parsedUrl.pathname.startsWith("/api/rooms/") && parsedUrl.pathname.endsWith("/events")) {
      const code = parsedUrl.pathname.split("/")[3].toUpperCase();
      const playerId = parsedUrl.searchParams.get("playerId") || "";
      const room = rooms.get(code);
      if (!room) {
        res.writeHead(404);
        res.end();
        return;
      }

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      const client = { res, playerId };
      res.write(`event: state\ndata: ${JSON.stringify(getPublicState(room, playerId))}\n\n`);
      room.clients.add(client);
      req.on("close", () => room.clients.delete(client));
      return;
    }

    const actionMatch = req.url.match(/^\/api\/rooms\/([A-Z0-9]+)\/([a-z-]+)$/);
    if (req.method === "POST" && actionMatch) {
      const [, code, action] = actionMatch;
      const room = rooms.get(code);
      if (!room) {
        json(res, 404, { error: "Room not found" });
        return;
      }

      const body = await readBody(req);
      const viewerId = String(body.viewerId || body.playerId || "");

      if (action === "words") {
        const words = normalizeWords(body.words);
        if (words.length < 2) {
          json(res, 400, { error: "Add at least two words" });
          return;
        }
        room.words = words;
        room.deck = shuffle(words);
        room.used = [];
        room.currentWord = "";
        room.score = 0;
        room.scoreTarget = 50;
        room.skips = 0;
        room.roundActive = false;
        room.roundEndsAt = 0;
      } else if (action === "start") {
        if (!room.words.length) {
          json(res, 400, { error: "Add words before starting" });
          return;
        }
        room.roundSeconds = Math.min(180, Math.max(15, Number(body.seconds) || 60));
        room.scoreTarget = [50, 100].includes(Number(body.scoreTarget)) ? Number(body.scoreTarget) : room.scoreTarget;
        room.turnPlayerId = String(body.playerId || room.players[0]?.id || "");
        if (!room.players.some(player => player.id === room.turnPlayerId)) {
          json(res, 400, { error: "Choose a player in this room" });
          return;
        }
        room.score = 0;
        room.skips = 0;
        room.roundActive = true;
        room.roundEndsAt = Date.now() + room.roundSeconds * 1000;
        nextWord(room);
        scheduleRoundEnd(room);
      } else if (action === "correct") {
        if (viewerId !== room.turnPlayerId) {
          json(res, 403, { error: "Only the explaining player can mark words" });
          return;
        }
        if (room.roundActive && room.currentWord) {
          const guesser = room.players.find(player => player.id !== room.turnPlayerId) || room.players[0];
          room.score += 1;
          if (guesser) {
            guesser.points = Number(guesser.points || 0) + 1;
          }
          room.used.push(room.currentWord);
          nextWord(room);
        }
      } else if (action === "skip") {
        if (viewerId !== room.turnPlayerId) {
          json(res, 403, { error: "Only the explaining player can skip words" });
          return;
        }
        if (room.roundActive && room.currentWord) {
          room.skips += 1;
          room.deck.unshift(room.currentWord);
          nextWord(room);
        }
      } else if (action === "stop") {
        if (viewerId !== room.turnPlayerId) {
          json(res, 403, { error: "Only the explaining player can stop the round" });
          return;
        }
        endRound(room);
        json(res, 200, { room: getPublicState(room, viewerId) });
        return;
      } else {
        json(res, 404, { error: "Unknown action" });
        return;
      }

      broadcast(room);
      json(res, 200, { room: getPublicState(room, viewerId) });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    json(res, 400, { error: error.message });
  }
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "content-type": mimeTypes[".html"] });
        res.end(fallback);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Alias Online running at http://localhost:${PORT}`);
});
