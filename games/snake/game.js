import { auth, db } from "../../js/firebase.js";
import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas?.getContext?.("2d");
  const scoreNowEl = document.getElementById("scoreNow");
  const scoreBestEl = document.getElementById("scoreBest");
  const pauseBtn = document.getElementById("pauseBtn");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const playAgainBtn = document.getElementById("playAgainBtn");
  const authNote = document.getElementById("authNote");
  const globalList = document.getElementById("globalList");
  const leaderboardError = document.getElementById("leaderboardError");

  if (
    !canvas ||
    !ctx ||
    !scoreNowEl ||
    !scoreBestEl ||
    !pauseBtn ||
    !overlay ||
    !overlayTitle ||
    !overlayText ||
    !playAgainBtn ||
    !authNote ||
    !globalList ||
    !leaderboardError
  ) {
    throw new Error("Snake: required DOM elements not found.");
  }

  // Classic grid-based snake
  const GRID = 21; // 21x21 grid
  const TILE = Math.floor(canvas.width / GRID); // canvas is 420 => TILE 20
  const BOARD_PX = GRID * TILE;

  const LS_KEY = "snakeHighScore";
  const GAME_ID = "snake";

  const colors = {
    bg: "rgba(8, 10, 22, 0.85)",
    grid: "rgba(46, 242, 255, 0.08)",
    snake: "#35ff8a",
    snakeGlow: "rgba(53, 255, 138, 0.35)",
    head: "#b8ffd7",
    apple: "#ff3b3b",
    appleGlow: "rgba(255, 59, 59, 0.35)",
    text: "rgba(245, 247, 255, 0.92)",
  };

  /** @typedef {{x:number,y:number}} Point */

  /** @type {Point[]} */
  let snake = [];
  /** @type {Point} */
  let dir = { x: 1, y: 0 };
  /** @type {Point} */
  let nextDir = { x: 1, y: 0 };
  /** @type {Point} */
  let food = { x: 10, y: 10 };

  let score = 0;
  let best = Number(localStorage.getItem(LS_KEY) || "0") || 0;
  let paused = false;
  let gameOver = false;

  /** @type {import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js").User | null} */
  let currentUser = null;
  let currentNickname = "";
  let canSave = false;

  // Timing: fixed-step tick (classic feel), rendered every tick.
  let speed = 9; // moves per second
  let lastTickMs = 0;
  let accMs = 0;

  function showLeaderboardError(errOrMessage) {
    if (!errOrMessage) {
      leaderboardError.hidden = true;
      leaderboardError.replaceChildren();
      return;
    }
    leaderboardError.hidden = false;
    leaderboardError.replaceChildren();

    const msg =
      typeof errOrMessage === "string"
        ? errOrMessage
        : errOrMessage?.message || String(errOrMessage);

    leaderboardError.appendChild(document.createTextNode(msg));

    const urlMatch = msg.match(/https:\/\/[^\s]+/);
    if (urlMatch) {
      leaderboardError.appendChild(document.createElement("br"));
      const a = document.createElement("a");
      a.href = urlMatch[0];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "index-link";
      a.textContent = "Vytvořit index ve Firebase Console";
      leaderboardError.appendChild(a);
    }
  }

  function setAuthNote(message) {
    authNote.textContent = message;
  }

  async function fetchNicknameForUser(uid) {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return "";
    const data = snap.data();
    return typeof data?.nickname === "string" ? data.nickname : "";
  }

  function renderGlobalTop10(entries) {
    globalList.innerHTML = "";

    if (!entries.length) {
      const li = document.createElement("li");
      li.className = "note";
      li.textContent = "Zatím tu nic není. Buďte první.";
      globalList.appendChild(li);
      return;
    }

    for (const row of entries) {
      const li = document.createElement("li");
      li.className = "leader-row";

      const name = document.createElement("span");
      name.className = "leader-name";
      name.textContent = row.nickname || "Neznámý";

      const scoreEl = document.createElement("span");
      scoreEl.className = "leader-score";
      scoreEl.textContent = String(row.score ?? 0);

      li.appendChild(name);
      li.appendChild(scoreEl);
      globalList.appendChild(li);
    }
  }

  // Save best-per-user score to `leaderboard/{uid_snake}`.
  // This keeps the top-10 query fast and prevents leaderboard spam.
  async function saveGlobalScore(finalScore) {
    if (!canSave || !currentUser) return;
    if (!Number.isFinite(finalScore) || finalScore <= 0) return;

    try {
      const docId = `${currentUser.uid}_${GAME_ID}`;
      const ref = doc(db, "leaderboard", docId);
      const prev = await getDoc(ref);
      const prevScore = prev.exists() ? Number(prev.data()?.score ?? 0) : 0;

      if (finalScore <= prevScore) return;

      await setDoc(ref, {
        uid: currentUser.uid,
        nickname: currentNickname || currentUser.email || "Neznámý",
        score: finalScore,
        game: GAME_ID,
        timestamp: serverTimestamp(),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      showLeaderboardError(err);
    }
  }

  function clampCanvasToBoard() {
    // If TILE doesn't fit perfectly (should, but safe), center board.
    const ox = Math.floor((canvas.width - BOARD_PX) / 2);
    const oy = Math.floor((canvas.height - BOARD_PX) / 2);
    return { ox, oy };
  }

  function setOverlay({ show, title, text }) {
    overlay.hidden = !show;
    if (title) overlayTitle.textContent = title;
    if (text) overlayText.textContent = text;
  }

  function setPaused(nextPaused) {
    paused = nextPaused;
    pauseBtn.textContent = paused ? "Pokračovat" : "Pauza";
    if (!gameOver) {
      setOverlay({
        show: paused,
        title: "Pauza",
        text: "Pokračujte mezerníkem nebo Esc.",
      });
    }
  }

  function setScore(next) {
    score = next;
    scoreNowEl.textContent = String(score);
    if (score > best) {
      best = score;
      localStorage.setItem(LS_KEY, String(best));
    }
    scoreBestEl.textContent = String(best);
  }

  function pointsEqual(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function isInside(p) {
    return p.x >= 0 && p.x < GRID && p.y >= 0 && p.y < GRID;
  }

  function randomEmptyCell() {
    // Simple loop: good enough for small grid.
    for (let i = 0; i < 2000; i++) {
      const p = { x: (Math.random() * GRID) | 0, y: (Math.random() * GRID) | 0 };
      if (!snake.some((s) => pointsEqual(s, p))) return p;
    }
    // Fallback: find first empty
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const p = { x, y };
        if (!snake.some((s) => pointsEqual(s, p))) return p;
      }
    }
    return { x: 0, y: 0 };
  }

  function reset() {
    snake = [
      { x: 6, y: 10 },
      { x: 5, y: 10 },
      { x: 4, y: 10 },
    ];
    dir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    food = randomEmptyCell();
    gameOver = false;
    speed = 9;
    setScore(0);
    setOverlay({ show: false });
    setPaused(false);
    accMs = 0;
    lastTickMs = performance.now();
  }

  function trySetDirection(dx, dy) {
    // Prevent reverse direction.
    if (dx === -dir.x && dy === -dir.y) return;
    nextDir = { x: dx, y: dy };
  }

  function onKeyDown(e) {
    const k = e.key;

    if (
      k === "ArrowUp" ||
      k === "ArrowDown" ||
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === " " ||
      k === "Spacebar"
    ) {
      e.preventDefault();
    }

    if (k === " " || k === "Spacebar" || k === "Escape") {
      if (gameOver) return;
      setPaused(!paused);
      return;
    }

    if (gameOver) return;

    const lower = k.toLowerCase();
    switch (lower) {
      case "arrowup":
      case "w":
        trySetDirection(0, -1);
        break;
      case "arrowdown":
      case "s":
        trySetDirection(0, 1);
        break;
      case "arrowleft":
      case "a":
        trySetDirection(-1, 0);
        break;
      case "arrowright":
      case "d":
        trySetDirection(1, 0);
        break;
      default:
        break;
    }
  }

  function step() {
    dir = nextDir;

    const head = snake[0];
    const nextHead = { x: head.x + dir.x, y: head.y + dir.y };

    // Wall collision
    if (!isInside(nextHead)) {
      endGame("Konec hry", "Narazil jsi do zdi. Zkusíš to znovu?");
      return;
    }

    // Self collision (note: tail moves unless eating; classic behavior)
    const willEat = pointsEqual(nextHead, food);
    const bodyToCheck = willEat ? snake : snake.slice(0, -1);
    if (bodyToCheck.some((p) => pointsEqual(p, nextHead))) {
      endGame("Konec hry", "Narazil jsi do sebe. Zkusíš to znovu?");
      return;
    }

    // Move
    snake.unshift(nextHead);
    if (willEat) {
      setScore(score + 1);
      food = randomEmptyCell();
      // Slight speed up for arcade feel (still classic)
      speed = Math.min(16, 9 + Math.floor(score / 4));
    } else {
      snake.pop();
    }
  }

  function endGame(title, text) {
    gameOver = true;
    setPaused(false);
    setOverlay({ show: true, title, text });
    pauseBtn.textContent = "Pauza";
    void saveGlobalScore(score);
  }

  function draw() {
    const { ox, oy } = clampCanvasToBoard();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background (board)
    ctx.fillStyle = colors.bg;
    ctx.fillRect(ox, oy, BOARD_PX, BOARD_PX);

    // Grid
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= GRID; i++) {
      const p = ox + i * TILE + 0.5;
      ctx.moveTo(p, oy + 0.5);
      ctx.lineTo(p, oy + BOARD_PX + 0.5);
    }
    for (let i = 0; i <= GRID; i++) {
      const p = oy + i * TILE + 0.5;
      ctx.moveTo(ox + 0.5, p);
      ctx.lineTo(ox + BOARD_PX + 0.5, p);
    }
    ctx.stroke();

    // Food (apple)
    const fx = ox + food.x * TILE;
    const fy = oy + food.y * TILE;
    ctx.save();
    ctx.shadowColor = colors.appleGlow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = colors.apple;
    ctx.fillRect(fx + 3, fy + 3, TILE - 6, TILE - 6);
    ctx.restore();

    // Snake
    for (let i = snake.length - 1; i >= 0; i--) {
      const p = snake[i];
      const x = ox + p.x * TILE;
      const y = oy + p.y * TILE;

      const isHead = i === 0;
      ctx.save();
      ctx.shadowColor = colors.snakeGlow;
      ctx.shadowBlur = isHead ? 18 : 12;
      ctx.fillStyle = isHead ? colors.head : colors.snake;
      ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      ctx.restore();
    }

    // Tiny paused indicator (so it still feels responsive even without overlay focus)
    if (paused && !gameOver) {
      ctx.fillStyle = "rgba(245, 247, 255, 0.85)";
      ctx.font = "800 14px ui-sans-serif, system-ui";
      ctx.textAlign = "right";
      ctx.fillText("PAUZA", ox + BOARD_PX - 10, oy + 20);
    }
  }

  function loop(nowMs) {
    const dt = nowMs - lastTickMs;
    lastTickMs = nowMs;

    if (!paused && !gameOver) {
      accMs += dt;
      const stepMs = 1000 / speed;
      while (accMs >= stepMs) {
        step();
        accMs -= stepMs;
        if (gameOver) break;
      }
    }

    draw();
    requestAnimationFrame(loop);
  }

  pauseBtn.addEventListener("click", () => {
    if (gameOver) return;
    setPaused(!paused);
  });

  playAgainBtn.addEventListener("click", () => {
    reset();
    canvas.focus?.();
  });

  window.addEventListener("keydown", onKeyDown, { passive: false });

  // Live leaderboard: orderBy(score) only + filter by game (avoids composite index on game+score).
  const LEADERBOARD_FETCH = 200;
  try {
    const q = query(
      collection(db, "leaderboard"),
      orderBy("score", "desc"),
      limit(LEADERBOARD_FETCH)
    );

    onSnapshot(
      q,
      (snap) => {
        showLeaderboardError("");
        const rows = snap.docs
          .map((d) => d.data())
          .filter((row) => row.game === GAME_ID)
          .slice(0, 10);
        renderGlobalTop10(rows);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        showLeaderboardError(err);
      }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    showLeaderboardError(err);
  }

  // Auth integration: determine if we can save scores + fetch nickname
  setAuthNote("Kontrola přihlášení…");
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    currentNickname = "";
    canSave = false;

    if (!user) {
      setAuthNote("Přihlaste se pro uložení skóre.");
      return;
    }

    try {
      currentNickname = await fetchNicknameForUser(user.uid);
      canSave = Boolean(currentNickname);
      setAuthNote(
        canSave
          ? `Ukládá se jako ${currentNickname}.`
          : "Přihlaste se pro uložení skóre."
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setAuthNote("Přihlaste se pro uložení skóre.");
    }
  });

  // Init
  scoreBestEl.textContent = String(best);
  reset();
  requestAnimationFrame((t) => {
    lastTickMs = t;
    requestAnimationFrame(loop);
  });
})();

