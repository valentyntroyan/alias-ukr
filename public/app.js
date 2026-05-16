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
  saveWordsBtn: document.querySelector("#saveWordsBtn"),
  wordCount: document.querySelector("#wordCount"),
  turnSelect: document.querySelector("#turnSelect"),
  secondsInput: document.querySelector("#secondsInput"),
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

  for (const player of state.room.players) {
    const li = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = player.name;
    const role = document.createElement("span");
    role.textContent = player.id === state.room.turnPlayerId ? "Explaining" : "Guessing";
    li.append(name, role);
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

  renderPlayers();
  renderTimer();

  const explainer = state.room.players.find(player => player.id === state.room.turnPlayerId);
  els.turnLabel.textContent = state.room.roundActive
    ? `${explainer?.name || "Player"} explains`
    : "Round is not active.";
  const isExplainer = state.player?.id === state.room.turnPlayerId;
  els.currentWord.textContent = state.room.roundActive
    ? (isExplainer ? state.room.currentWord : "Guess the word")
    : "Ready?";

  const canPlay = Boolean(state.room.roundActive);
  els.correctBtn.disabled = !canPlay;
  els.skipBtn.disabled = !canPlay;
  els.stopBtn.disabled = !canPlay;
  els.startBtn.disabled = state.room.wordCount < 2;
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

els.startBtn.addEventListener("click", async () => {
  try {
    const payload = await api(`/api/rooms/${state.room.code}/start`, {
      playerId: els.turnSelect.value || state.player.id,
      seconds: els.secondsInput.value
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
    await api(`/api/rooms/${state.room.code}/correct`);
  } catch (error) {
    setStatus(error.message);
  }
});

els.skipBtn.addEventListener("click", async () => {
  try {
    await api(`/api/rooms/${state.room.code}/skip`);
  } catch (error) {
    setStatus(error.message);
  }
});

els.stopBtn.addEventListener("click", async () => {
  try {
    await api(`/api/rooms/${state.room.code}/stop`);
  } catch (error) {
    setStatus(error.message);
  }
});

els.joinCodeInput.addEventListener("input", () => {
  els.joinCodeInput.value = els.joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

startTimerLoop();
