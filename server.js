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
    currentRoundWords: [],
    lastRoundWords: [],
    lastRoundExplainerId: "",
    currentWord: "",
    score: 0,
    scoreTarget: 50,
    skips: 0,
    turnPlayerId: "",
    roundActive: false,
    roundExpired: false,
    gameOver: false,
    winnerId: "",
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
    lastRoundWords: room.lastRoundWords,
    hasCurrentWord: Boolean(room.currentWord),
    currentWord: canSeeWord ? room.currentWord : "",
    score: room.score,
    scoreTarget: room.scoreTarget,
    skips: room.skips,
    turnPlayerId: room.turnPlayerId,
    roundActive: room.roundActive,
    roundExpired: room.roundExpired,
    gameOver: room.gameOver,
    winnerId: room.winnerId,
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

function playerAtTarget(room) {
  return room.players.find(player => Number(player.points || 0) >= room.scoreTarget);
}

function scoreDelta(result) {
  if (result === "skipped") return 0;
  return result === "correct" ? 1 : -1;
}

function applyPoints(room, playerId, delta) {
  const player = room.players.find(existing => existing.id === playerId);
  if (!player) return 0;
  const previous = Number(player.points || 0);
  player.points = Math.max(0, previous + delta);
  return player.points - previous;
}

function roundScore(words, result) {
  return words.filter(item => item.result === result).length;
}

function answerCurrentWord(room, result) {
  if (!room.roundActive || !room.currentWord) return;
  const guesser = room.players.find(player => player.id !== room.turnPlayerId) || room.players[0];
  const item = {
    id: crypto.randomUUID(),
    word: room.currentWord,
    result,
    guesserId: guesser?.id || "",
    delta: 0
  };

  room.currentRoundWords.push(item);
  if (guesser) {
    item.delta = applyPoints(room, guesser.id, scoreDelta(result));
  }
  room.score = roundScore(room.currentRoundWords, "correct");
  room.skips = roundScore(room.currentRoundWords, "incorrect");
  room.used.push(room.currentWord);
  if (room.roundExpired) {
    room.currentWord = "";
  } else {
    nextWord(room);
  }
}

function skipCurrentWord(room) {
  answerCurrentWord(room, "skipped");
}

function updateGameResult(room) {
  const winner = playerAtTarget(room);
  if (winner) {
    room.gameOver = true;
    room.winnerId = winner.id;
  } else {
    room.gameOver = false;
    room.winnerId = "";
  }
}

function resetGame(room, starterId = "") {
  room.deck = shuffle(room.words);
  room.used = [];
  room.currentRoundWords = [];
  room.lastRoundWords = [];
  room.lastRoundExplainerId = "";
  room.currentWord = "";
  room.score = 0;
  room.skips = 0;
  room.players = room.players.map(player => ({ ...player, points: 0 }));
  room.turnPlayerId = room.players.some(player => player.id === starterId)
    ? starterId
    : room.players[0]?.id || "";
  room.roundActive = false;
  room.roundExpired = false;
  room.gameOver = false;
  room.winnerId = "";
  room.roundEndsAt = 0;
}

function endRound(room) {
  if (!room.roundActive) return;
  room.roundActive = false;
  room.roundExpired = false;
  room.roundEndsAt = 0;
  room.currentWord = "";
  room.lastRoundExplainerId = room.turnPlayerId;
  room.lastRoundWords = room.currentRoundWords;
  room.currentRoundWords = [];
  updateGameResult(room);
  if (!room.gameOver) {
    rotateTurn(room);
  }
  broadcast(room);
}

function scheduleRoundEnd(room) {
  const ms = Math.max(0, room.roundEndsAt - Date.now());
  setTimeout(() => {
    if (room.roundActive && Date.now() >= room.roundEndsAt) {
      room.roundExpired = true;
      broadcast(room);
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
        if (!room.turnPlayerId) {
          room.turnPlayerId = room.players[0]?.id || "";
        }
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
        room.currentRoundWords = [];
        room.lastRoundWords = [];
        room.lastRoundExplainerId = "";
        room.currentWord = "";
        room.score = 0;
        room.scoreTarget = 50;
        room.skips = 0;
        room.players = room.players.map(player => ({ ...player, points: 0 }));
        room.turnPlayerId = room.players[0]?.id || "";
        room.gameOver = false;
        room.winnerId = "";
        room.roundActive = false;
        room.roundExpired = false;
        room.roundEndsAt = 0;
      } else if (action === "new-game") {
        if (!room.gameOver) {
          json(res, 409, { error: "Finish the current game first" });
          return;
        }
        if (!room.words.length) {
          json(res, 400, { error: "Add words before starting" });
          return;
        }
        if (room.players.length < 2) {
          json(res, 400, { error: "Wait for the second player" });
          return;
        }
        if (!room.players.some(player => player.id === viewerId)) {
          json(res, 403, { error: "Join the room before starting a new game" });
          return;
        }
        resetGame(room, viewerId);
        room.roundSeconds = Math.min(180, Math.max(15, Number(body.seconds) || 60));
        room.scoreTarget = [50, 100].includes(Number(body.scoreTarget)) ? Number(body.scoreTarget) : room.scoreTarget;
        room.roundActive = true;
        room.roundExpired = false;
        room.roundEndsAt = Date.now() + room.roundSeconds * 1000;
        nextWord(room);
        scheduleRoundEnd(room);
      } else if (action === "start") {
        if (room.gameOver) {
          json(res, 409, { error: "Game is over. Load words again to start a new game." });
          return;
        }
        if (!room.words.length) {
          json(res, 400, { error: "Add words before starting" });
          return;
        }
        if (room.players.length < 2) {
          json(res, 400, { error: "Wait for the second player" });
          return;
        }
        room.roundSeconds = Math.min(180, Math.max(15, Number(body.seconds) || 60));
        room.scoreTarget = [50, 100].includes(Number(body.scoreTarget)) ? Number(body.scoreTarget) : room.scoreTarget;
        if (!room.turnPlayerId) {
          room.turnPlayerId = room.players[0]?.id || "";
        }
        if (!room.players.some(player => player.id === room.turnPlayerId)) {
          json(res, 400, { error: "Choose a player in this room" });
          return;
        }
        if (viewerId !== room.turnPlayerId) {
          json(res, 403, { error: "Only the next explaining player can start this round" });
          return;
        }
        room.score = 0;
        room.skips = 0;
        room.currentRoundWords = [];
        room.lastRoundWords = [];
        room.lastRoundExplainerId = "";
        room.roundActive = true;
        room.roundExpired = false;
        room.roundEndsAt = Date.now() + room.roundSeconds * 1000;
        nextWord(room);
        scheduleRoundEnd(room);
      } else if (action === "correct") {
        if (viewerId !== room.turnPlayerId) {
          json(res, 403, { error: "Only the explaining player can mark words" });
          return;
        }
        if (room.roundActive && room.currentWord) {
          answerCurrentWord(room, "correct");
        }
      } else if (action === "incorrect") {
        if (viewerId !== room.turnPlayerId) {
          json(res, 403, { error: "Only the explaining player can mark words" });
          return;
        }
        if (room.roundActive && room.currentWord) {
          answerCurrentWord(room, "incorrect");
        }
      } else if (action === "skip") {
        if (viewerId !== room.turnPlayerId) {
          json(res, 403, { error: "Only the explaining player can skip words" });
          return;
        }
        if (room.roundActive && room.currentWord) {
          skipCurrentWord(room);
        }
      } else if (action === "mark") {
        const item = room.lastRoundWords.find(word => word.id === body.itemId);
        const result = String(body.result || "");
        if (!item || !["correct", "incorrect"].includes(result)) {
          json(res, 400, { error: "Choose a reviewed word and result" });
          return;
        }
        if (item.result !== result) {
          const desiredDelta = scoreDelta(result);
          item.delta += applyPoints(room, item.guesserId, desiredDelta - Number(item.delta || 0));
          item.result = result;
          room.score = roundScore(room.lastRoundWords, "correct");
          room.skips = roundScore(room.lastRoundWords, "incorrect");
          updateGameResult(room);
          if (!room.gameOver && room.turnPlayerId === room.lastRoundExplainerId) {
            rotateTurn(room);
          }
        }
      } else if (action === "stop") {
        if (viewerId !== room.turnPlayerId) {
          json(res, 403, { error: "Only the explaining player can stop the round" });
          return;
        }
        if (!room.roundExpired) {
          json(res, 409, { error: "Finish round is available after time is up" });
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
  console.log(`Alias for Vladka running at http://localhost:${PORT}`);
});
