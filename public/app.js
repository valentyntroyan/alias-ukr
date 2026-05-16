const state = {
  room: null,
  player: null,
  events: null,
  timerId: null
};

const els = {
  setupView: document.querySelector("#setupView"),
  gameView: document.querySelector("#gameView"),
  roomPill: document.querySelector("#roomPill"),
  roomCode: document.querySelector("#roomCode"),
  nameInput: document.querySelector("#nameInput"),
  createBtn: document.querySelector("#createBtn"),
  joinCodeInput: document.querySelector("#joinCodeInput"),
  joinBtn: document.querySelector("#joinBtn"),
  playersList: document.querySelector("#playersList"),
  wordsInput: document.querySelector("#wordsInput"),
  loadDefaultWordsBtn: document.querySelector("#loadDefaultWordsBtn"),
  saveWordsBtn: document.querySelector("#saveWordsBtn"),
  wordCount: document.querySelector("#wordCount"),
  turnSelect: document.querySelector("#turnSelect"),
  secondsInput: document.querySelector("#secondsInput"),
  scoreTargetSelect: document.querySelector("#scoreTargetSelect"),
  startBtn: document.querySelector("#startBtn"),
  timer: document.querySelector("#timer"),
  score: document.querySelector("#score"),
  skips: document.querySelector("#skips"),
  turnLabel: document.querySelector("#turnLabel"),
  currentWord: document.querySelector("#currentWord"),
  skipBtn: document.querySelector("#skipBtn"),
  correctBtn: document.querySelector("#correctBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  status: document.querySelector("#status")
};

const saved = JSON.parse(localStorage.getItem("aliasOnline") || "{}");
els.nameInput.value = saved.name || "";

const params = new URLSearchParams(location.search);
const roomFromUrl = params.get("room");
if (roomFromUrl) {
  els.joinCodeInput.value = roomFromUrl.toUpperCase();
}

function setStatus(message) {
  els.status.textContent = message || "";
}

async function api(path, data) {
  const body = {
    ...(data || {}),
    viewerId: state.player?.id || ""
  };

  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function playerName() {
  return els.nameInput.value.trim() || "Player";
}

function persist() {
  localStorage.setItem(
    "aliasOnline",
    JSON.stringify({
      name: playerName(),
      playerId: state.player?.id || saved.playerId || ""
    })
  );
}

function connectEvents(code) {
  if (state.events) {
    state.events.close();
  }

  state.events = new EventSource(`/api/rooms/${code}/events?playerId=${encodeURIComponent(state.player.id)}`);
  state.events.addEventListener("state", event => {
    state.room = JSON.parse(event.data);
    render();
  });
  state.events.onerror = () => {
    setStatus("Connection lost. Refresh or rejoin the room.");
  };
}

function enterRoom(room, player) {
  state.room = room;
  state.player = player;
  persist();
  connectEvents(room.code);
  history.replaceState({}, "", `/?room=${room.code}`);
  els.setupView.hidden = true;
  els.gameView.hidden = false;
  els.roomPill.hidden = false;
  render();
}

function renderPlayers() {
  els.playersList.innerHTML = "";
  els.turnSelect.innerHTML = "";
  const target = Number(state.room.scoreTarget || els.scoreTargetSelect.value || 50);

  for (const player of state.room.players) {
    const li = document.createElement("li");
    const info = document.createElement("div");
    info.className = "player-info";
    const name = document.createElement("strong");
    name.textContent = player.name;
    const role = document.createElement("span");
    role.textContent = player.id === state.room.turnPlayerId ? "Explaining" : "Guessing";
    info.append(name, role);

    const score = document.createElement("b");
    score.className = "player-score";
    score.textContent = `${player.points || 0}/${target}`;
    if ((player.points || 0) >= target) {
      score.classList.add("winner");
    }

    li.append(info, score);
    els.playersList.append(li);

    const option = document.createElement("option");
    option.value = player.id;
    option.textContent = player.name;
    option.selected = player.id === (state.room.turnPlayerId || state.player?.id);
    els.turnSelect.append(option);
  }
}

function secondsLeft() {
  if (!state.room?.roundActive) return 0;
  return Math.max(0, Math.ceil((state.room.roundEndsAt - Date.now()) / 1000));
}

function renderTimer() {
  if (!state.room?.roundActive) {
    els.timer.textContent = "--";
    return;
  }
  els.timer.textContent = String(secondsLeft());
}

function render() {
  if (!state.room) return;

  els.roomCode.textContent = state.room.code;
  els.wordCount.textContent = String(state.room.wordCount);
  els.score.textContent = String(state.room.score);
  els.skips.textContent = String(state.room.skips);
  els.scoreTargetSelect.value = String(state.room.scoreTarget || 50);

  renderPlayers();
  renderTimer();

  const explainer = state.room.players.find(player => player.id === state.room.turnPlayerId);
  const isExplainer = state.player?.id === state.room.turnPlayerId;
  const guesser = state.room.players.find(player => player.id !== state.room.turnPlayerId);
  const winner = state.room.players.find(player => player.id === state.room.winnerId);
  els.turnLabel.textContent = state.room.roundActive
    ? `${explainer?.name || "Player"} explains, ${guesser?.name || "partner"} guesses`
    : state.room.gameOver
      ? `${winner?.name || "Player"} wins`
      : state.room.players.length < 2
      ? "Waiting for the second player."
      : `${explainer?.name || "Player"} starts the next round.`;
  els.currentWord.textContent = state.room.roundActive
    ? (isExplainer ? state.room.currentWord : "Guess the word")
    : state.room.gameOver
      ? "Game over"
    : "Ready?";

  const canPlay = Boolean(state.room.roundActive);
  els.correctBtn.disabled = !canPlay || !isExplainer;
  els.skipBtn.disabled = !canPlay || !isExplainer;
  els.stopBtn.disabled = !canPlay || !isExplainer;
  els.startBtn.disabled = state.room.wordCount < 2 || state.room.players.length < 2 || canPlay || !isExplainer || state.room.gameOver;
  els.turnSelect.disabled = true;
  els.secondsInput.disabled = canPlay || state.room.gameOver || !isExplainer;
  els.scoreTargetSelect.disabled = canPlay || state.room.gameOver || !isExplainer;
}

function startTimerLoop() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = setInterval(() => {
    renderTimer();
    if (state.room?.roundActive && secondsLeft() === 0) {
      els.currentWord.textContent = "Time!";
    }
  }, 250);
}

els.createBtn.addEventListener("click", async () => {
  try {
    const payload = await api("/api/rooms", { name: playerName() });
    enterRoom(payload.room, payload.player);
    setStatus("Room created. Send the URL to your partner.");
  } catch (error) {
    setStatus(error.message);
  }
});

els.joinBtn.addEventListener("click", async () => {
  try {
    const payload = await api("/api/join", {
      code: els.joinCodeInput.value,
      name: playerName(),
      playerId: saved.playerId
    });
    enterRoom(payload.room, payload.player);
    setStatus("Joined room.");
  } catch (error) {
    setStatus(error.message);
  }
});

els.saveWordsBtn.addEventListener("click", async () => {
  try {
    const payload = await api(`/api/rooms/${state.room.code}/words`, {
      words: els.wordsInput.value
    });
    state.room = payload.room;
    render();
    setStatus("Word pack loaded.");
  } catch (error) {
    setStatus(error.message);
  }
});

els.loadDefaultWordsBtn.addEventListener("click", async () => {
  try {
    const response = await fetch("/ukrainian-words.txt", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load word pack");
    els.wordsInput.value = await response.text();
    setStatus("Ukrainian word pack loaded. Press Use word pack.");
  } catch (error) {
    setStatus(error.message);
  }
});

els.startBtn.addEventListener("click", async () => {
  try {
    const payload = await api(`/api/rooms/${state.room.code}/start`, {
      seconds: els.secondsInput.value,
      scoreTarget: els.scoreTargetSelect.value
    });
    state.room = payload.room;
    render();
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  }
});

els.correctBtn.addEventListener("click", async () => {
  try {
    const payload = await api(`/api/rooms/${state.room.code}/correct`);
    state.room = payload.room;
    render();
  } catch (error) {
    setStatus(error.message);
  }
});

els.skipBtn.addEventListener("click", async () => {
  try {
    const payload = await api(`/api/rooms/${state.room.code}/skip`);
    state.room = payload.room;
    render();
  } catch (error) {
    setStatus(error.message);
  }
});

els.stopBtn.addEventListener("click", async () => {
  try {
    const payload = await api(`/api/rooms/${state.room.code}/stop`);
    state.room = payload.room;
    render();
  } catch (error) {
    setStatus(error.message);
  }
});

els.joinCodeInput.addEventListener("input", () => {
  els.joinCodeInput.value = els.joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

startTimerLoop();
