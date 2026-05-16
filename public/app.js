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
  incorrectBtn: document.querySelector("#incorrectBtn"),
  correctBtn: document.querySelector("#correctBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  roundReview: document.querySelector("#roundReview"),
  roundWordsList: document.querySelector("#roundWordsList"),
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

function playTone(frequency, duration = 0.08, type = "sine", volume = 0.08) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = playTone.context || new AudioContext();
  playTone.context = context;
  if (context.state === "suspended") {
    context.resume();
  }
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration + 0.02);
}

function playWordSound() {
  playTone(660, 0.07, "triangle", 0.07);
}

function playFinishSound() {
  playTone(330, 0.1, "sine", 0.08);
  setTimeout(() => playTone(494, 0.12, "sine", 0.07), 90);
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
  els.timer.textContent = state.room.roundExpired ? "0" : String(secondsLeft());
}

function renderRoundReview() {
  const words = state.room.lastRoundWords || [];
  els.roundReview.hidden = state.room.roundActive || !words.length;
  els.roundWordsList.innerHTML = "";
  if (els.roundReview.hidden) return;

  for (const item of words) {
    const li = document.createElement("li");
    const word = document.createElement("strong");
    word.textContent = item.word;
    if (item.result === "skipped") {
      const tag = document.createElement("span");
      tag.className = "review-tag";
      tag.textContent = "Skipped";
      word.append(" ", tag);
    }

    const actions = document.createElement("div");
    actions.className = "review-actions";

    const incorrect = document.createElement("button");
    incorrect.type = "button";
    incorrect.className = "secondary";
    incorrect.textContent = "Incorrect";
    incorrect.dataset.wordId = item.id;
    incorrect.dataset.result = "incorrect";
    incorrect.disabled = item.result === "incorrect";

    const correct = document.createElement("button");
    correct.type = "button";
    correct.textContent = "Correct";
    correct.dataset.wordId = item.id;
    correct.dataset.result = "correct";
    correct.disabled = item.result === "correct";

    actions.append(incorrect, correct);
    li.append(word, actions);
    els.roundWordsList.append(li);
  }
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
  renderRoundReview();

  const explainer = state.room.players.find(player => player.id === state.room.turnPlayerId);
  const isExplainer = state.player?.id === state.room.turnPlayerId;
  const guesser = state.room.players.find(player => player.id !== state.room.turnPlayerId);
  const winner = state.room.players.find(player => player.id === state.room.winnerId);
  els.turnLabel.textContent = state.room.roundActive
    ? state.room.roundExpired
      ? "Time is up. Finish the last word."
      : `${explainer?.name || "Player"} explains, ${guesser?.name || "partner"} guesses`
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
  const canFinish = canPlay && isExplainer && state.room.roundExpired;
  const canMarkWord = canPlay && isExplainer && state.room.hasCurrentWord;
  const canStartNewGame = state.room.gameOver && state.room.wordCount >= 2 && state.room.players.length >= 2;
  els.startBtn.textContent = state.room.gameOver ? "Start new game" : "Start round";
  els.correctBtn.disabled = !canMarkWord;
  els.incorrectBtn.disabled = !canMarkWord;
  els.skipBtn.disabled = !canMarkWord;
  els.stopBtn.disabled = !canFinish;
  els.stopBtn.hidden = !canPlay;
  els.startBtn.disabled = canPlay || (!canStartNewGame && (state.room.wordCount < 2 || state.room.players.length < 2 || !isExplainer));
  els.turnSelect.disabled = true;
  els.secondsInput.disabled = canPlay || (!canStartNewGame && !isExplainer);
  els.scoreTargetSelect.disabled = canPlay || (!canStartNewGame && !isExplainer);
}

function startTimerLoop() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = setInterval(() => {
    renderTimer();
    if (state.room?.roundActive && !state.room.roundExpired && secondsLeft() === 0) {
      els.turnLabel.textContent = "Time is up. Finish the last word.";
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
    const action = state.room.gameOver ? "new-game" : "start";
    const payload = await api(`/api/rooms/${state.room.code}/${action}`, {
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
    playWordSound();
  } catch (error) {
    setStatus(error.message);
  }
});

els.incorrectBtn.addEventListener("click", async () => {
  try {
    const payload = await api(`/api/rooms/${state.room.code}/incorrect`);
    state.room = payload.room;
    render();
    playWordSound();
  } catch (error) {
    setStatus(error.message);
  }
});

els.skipBtn.addEventListener("click", async () => {
  try {
    const payload = await api(`/api/rooms/${state.room.code}/skip`);
    state.room = payload.room;
    render();
    playWordSound();
  } catch (error) {
    setStatus(error.message);
  }
});

els.stopBtn.addEventListener("click", async () => {
  try {
    const payload = await api(`/api/rooms/${state.room.code}/stop`);
    state.room = payload.room;
    render();
    playFinishSound();
  } catch (error) {
    setStatus(error.message);
  }
});

els.roundWordsList.addEventListener("click", async event => {
  const button = event.target.closest("button[data-word-id]");
  if (!button) return;

  try {
    const payload = await api(`/api/rooms/${state.room.code}/mark`, {
      itemId: button.dataset.wordId,
      result: button.dataset.result
    });
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
