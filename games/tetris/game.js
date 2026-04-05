import { auth, db } from "../../js/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
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
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas?.getContext?.("2d");
  const scoreNowEl = document.getElementById("scoreNow");
  const linesNowEl = document.getElementById("linesNow");
  const levelNowEl = document.getElementById("levelNow");
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
    !linesNowEl ||
    !levelNowEl ||
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
    throw new Error("Tetris: required DOM elements not found.");
  }

  const COLS = 10;
  const ROWS = 17;
  /** Rows 0–1 = spawn buffer; rows 2–16 = 15 visible lines */
  const VISIBLE_OFF = 2;
  const VISIBLE_ROWS = 15;
  const CELL = canvas.width / COLS;

  const GAME_ID = "tetris";
  const LS_BEST = "tetrisHighScore";

  /** @type {Record<string, [number, number][][]>} */
  const SHAPES = {
    I: [
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1],
      ],
      [
        [2, 0],
        [2, 1],
        [2, 2],
        [2, 3],
      ],
      [
        [0, 2],
        [1, 2],
        [2, 2],
        [3, 2],
      ],
      [
        [1, 0],
        [1, 1],
        [1, 2],
        [1, 3],
      ],
    ],
    O: [
      [
        [1, 0],
        [2, 0],
        [1, 1],
        [2, 1],
      ],
      [
        [1, 0],
        [2, 0],
        [1, 1],
        [2, 1],
      ],
      [
        [1, 0],
        [2, 0],
        [1, 1],
        [2, 1],
      ],
      [
        [1, 0],
        [2, 0],
        [1, 1],
        [2, 1],
      ],
    ],
    T: [
      [
        [1, 0],
        [0, 1],
        [1, 1],
        [2, 1],
      ],
      [
        [1, 0],
        [1, 1],
        [2, 1],
        [1, 2],
      ],
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [1, 2],
      ],
      [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, 2],
      ],
    ],
    S: [
      [
        [1, 0],
        [2, 0],
        [0, 1],
        [1, 1],
      ],
      [
        [1, 0],
        [1, 1],
        [2, 1],
        [2, 2],
      ],
      [
        [1, 1],
        [2, 1],
        [0, 2],
        [1, 2],
      ],
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 2],
      ],
    ],
    Z: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [2, 1],
      ],
      [
        [2, 0],
        [1, 1],
        [2, 1],
        [1, 2],
      ],
      [
        [0, 1],
        [1, 1],
        [1, 2],
        [2, 2],
      ],
      [
        [1, 0],
        [0, 1],
        [1, 1],
        [0, 2],
      ],
    ],
    J: [
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [2, 1],
      ],
      [
        [1, 0],
        [2, 0],
        [1, 1],
        [1, 2],
      ],
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [2, 2],
      ],
      [
        [1, 0],
        [1, 1],
        [0, 2],
        [1, 2],
      ],
    ],
    L: [
      [
        [2, 0],
        [0, 1],
        [1, 1],
        [2, 1],
      ],
      [
        [1, 0],
        [1, 1],
        [1, 2],
        [2, 2],
      ],
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [0, 2],
      ],
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [1, 2],
      ],
    ],
  };

  /** Neon colors per piece */
  const NEON = {
    I: { fill: "#2ef2ff", glow: "rgba(46, 242, 255, 0.45)" },
    O: { fill: "#ffe14a", glow: "rgba(255, 225, 74, 0.45)" },
    T: { fill: "#c94dff", glow: "rgba(201, 77, 255, 0.45)" },
    S: { fill: "#35ff8a", glow: "rgba(53, 255, 138, 0.45)" },
    Z: { fill: "#ff2bd6", glow: "rgba(255, 43, 214, 0.45)" },
    J: { fill: "#4d7cff", glow: "rgba(77, 124, 255, 0.45)" },
    L: { fill: "#ff8c32", glow: "rgba(255, 140, 50, 0.45)" },
  };

  /** Index = number of lines cleared in one lock (1–4). */
  const LINE_CLEAR_POINTS = [0, 100, 200, 300, 400];
  const LOCK_PLACE_POINTS = 10;
  const WALL_KICKS = [
    [0, 0],
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-2, 0],
    [2, 0],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];

  /** @type {(string|null)[][]} */
  let grid = [];
  /** @type {{ type: string, rot: number, x: number, y: number } | null} */
  let piece = null;
  let bag = [];
  let score = 0;
  let lines = 0;
  let level = 1;
  let bestLocal = Number(localStorage.getItem(LS_BEST) || "0") || 0;
  let paused = false;
  let gameOver = false;
  let dropMs = 800;
  let dropAcc = 0;
  let lockAcc = 0;
  const LOCK_MS = 450;
  let softDown = false;
  let lastTs = performance.now();

  /** @type {import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js").User | null} */
  let currentUser = null;
  let currentNickname = "";
  let canSave = false;

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

  async function saveGlobalScore(finalScore) {
    if (!canSave || !currentUser) return;
    const n = Math.floor(Number(finalScore));
    if (!Number.isFinite(n) || n < 1) return;
    try {
      const ref = doc(db, "leaderboard", `${currentUser.uid}_${GAME_ID}`);
      const prev = await getDoc(ref);
      const prevScore = prev.exists() ? Number(prev.data()?.score ?? 0) : 0;
      if (n <= prevScore) return;
      await setDoc(ref, {
        uid: currentUser.uid,
        nickname: currentNickname || currentUser.email || "Neznámý",
        score: n,
        game: "tetris",
        timestamp: serverTimestamp(),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      showLeaderboardError(err);
    }
  }

  function subscribeTetrisLeaderboard() {
    const q = query(
      collection(db, "leaderboard"),
      where("game", "==", "tetris"),
      orderBy("score", "desc"),
      limit(10)
    );
    return onSnapshot(
      q,
      (snap) => {
        showLeaderboardError("");
        renderGlobalTop10(snap.docs.map((d) => d.data()));
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        showLeaderboardError(err);
      }
    );
  }

  try {
    subscribeTetrisLeaderboard();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    showLeaderboardError(err);
  }

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
          ? `Přihlášen jako ${currentNickname} — nejlepší skóre se ukládá do žebříčku.`
          : "Přihlaste se pro uložení skóre."
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setAuthNote("Přihlaste se pro uložení skóre.");
    }
  });

  function emptyGrid() {
    grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function shuffleBag(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function refillBag() {
    bag = shuffleBag(["I", "O", "T", "S", "Z", "J", "L"]);
  }

  function getCells(type, rot, px, py) {
    return SHAPES[type][rot].map(([dx, dy]) => ({ x: px + dx, y: py + dy }));
  }

  function validPosition(type, rot, px, py) {
    const cells = getCells(type, rot, px, py);
    for (const c of cells) {
      if (c.x < 0 || c.x >= COLS || c.y >= ROWS) return false;
      if (c.y >= 0 && grid[c.y][c.x]) return false;
    }
    return true;
  }

  function trySpawn() {
    if (bag.length === 0) refillBag();
    const type = bag.pop();
    const rot = 0;
    const px = 3;
    const py = 0;
    if (!validPosition(type, rot, px, py)) {
      piece = null;
      return false;
    }
    piece = { type, rot, x: px, y: py };
    lockAcc = 0;
    return true;
  }

  function tryMove(dx, dy) {
    if (!piece || gameOver) return false;
    if (validPosition(piece.type, piece.rot, piece.x + dx, piece.y + dy)) {
      piece.x += dx;
      piece.y += dy;
      lockAcc = 0;
      return true;
    }
    return false;
  }

  function tryRotate(dir) {
    if (!piece || gameOver) return false;
    const n = SHAPES[piece.type].length;
    const nextRot = (piece.rot + dir + n) % n;
    for (const [kx, ky] of WALL_KICKS) {
      if (validPosition(piece.type, nextRot, piece.x + kx, piece.y + ky)) {
        piece.rot = nextRot;
        piece.x += kx;
        piece.y += ky;
        lockAcc = 0;
        return true;
      }
    }
    return false;
  }

  function restingOnStack() {
    if (!piece) return false;
    return !validPosition(piece.type, piece.rot, piece.x, piece.y + 1);
  }

  /** Score only from locks and line clears — no drop or time bonuses. */
  function addScore(delta) {
    if (delta === 0) return;
    score += delta;
    scoreNowEl.textContent = String(score);
    if (score > bestLocal) {
      bestLocal = score;
      localStorage.setItem(LS_BEST, String(bestLocal));
      scoreBestEl.textContent = String(bestLocal);
    }
  }

  function lockPiece() {
    if (!piece) return;
    const cells = getCells(piece.type, piece.rot, piece.x, piece.y);
    let overflow = false;
    for (const c of cells) {
      if (c.y < 0) {
        overflow = true;
        continue;
      }
      if (c.y < VISIBLE_OFF) overflow = true;
      grid[c.y][c.x] = piece.type;
    }
    piece = null;
    lockAcc = 0;
    if (overflow) {
      endGame();
      return;
    }
    addScore(LOCK_PLACE_POINTS);
    clearLines();
    if (!trySpawn()) endGame();
  }

  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (grid[y].every((c) => c !== null)) {
        grid.splice(y, 1);
        grid.unshift(Array(COLS).fill(null));
        cleared++;
        y++;
      }
    }
    if (cleared > 0) {
      addScore(LINE_CLEAR_POINTS[cleared]);
      lines += cleared;
      level = 1 + ((lines / 10) | 0);
      dropMs = Math.max(120, 850 - (level - 1) * 55);
      linesNowEl.textContent = String(lines);
      levelNowEl.textContent = String(level);
    }
  }

  function hardDrop() {
    if (!piece || gameOver) return;
    while (validPosition(piece.type, piece.rot, piece.x, piece.y + 1)) {
      piece.y++;
    }
    lockPiece();
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    piece = null;
    pauseBtn.textContent = "Pauza";
    setOverlay(
      true,
      "Konec hry",
      `Skóre: ${score}${canSave ? " — když se jedná o rekord, uloží se do tabulky" : ""}`
    );
    void saveGlobalScore(score);
    if (score > bestLocal) {
      bestLocal = score;
      localStorage.setItem(LS_BEST, String(bestLocal));
    }
    scoreBestEl.textContent = String(bestLocal);
  }

  function setOverlay(show, title, text) {
    overlay.hidden = !show;
    if (title) overlayTitle.textContent = title;
    if (text) overlayText.textContent = text;
  }

  function setPaused(p) {
    if (gameOver) return;
    paused = p;
    pauseBtn.textContent = paused ? "Pokračovat" : "Pauza";
    if (paused) {
      setOverlay(true, "Pauza", "Pokračujte klávesou Esc nebo tlačítkem Pokračovat.");
    } else {
      overlay.hidden = true;
    }
  }

  function drawCell(sx, sy, type, ghost) {
    const pad = 1;
    const x = sx * CELL + pad;
    const y = sy * CELL + pad;
    const w = CELL - pad * 2;
    const h = CELL - pad * 2;
    const col = type ? NEON[type] : null;
    if (!col) {
      ctx.fillStyle = "rgba(46, 242, 255, 0.04)";
      ctx.fillRect(x, y, w, h);
      return;
    }
    ctx.save();
    if (ghost) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = col.fill;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      return;
    }
    ctx.shadowColor = col.glow;
    ctx.shadowBlur = 10;
    ctx.fillStyle = col.fill;
    ctx.fillRect(x, y, w, h);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = "rgba(8, 10, 22, 0.95)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < VISIBLE_ROWS; row++) {
      const gy = row + VISIBLE_OFF;
      for (let gx = 0; gx < COLS; gx++) {
        const t = grid[gy][gx];
        drawCell(gx, row, t, false);
      }
    }

    if (piece && !gameOver) {
      const ghostY = (() => {
        let gy = piece.y;
        while (validPosition(piece.type, piece.rot, piece.x, gy + 1)) gy++;
        return gy;
      })();
      const ghostCells = getCells(piece.type, piece.rot, piece.x, ghostY);
      for (const c of ghostCells) {
        if (c.y >= VISIBLE_OFF) drawCell(c.x, c.y - VISIBLE_OFF, piece.type, true);
      }
      const live = getCells(piece.type, piece.rot, piece.x, piece.y);
      for (const c of live) {
        if (c.y >= VISIBLE_OFF) drawCell(c.x, c.y - VISIBLE_OFF, piece.type, false);
      }
    }

    ctx.strokeStyle = "rgba(46, 242, 255, 0.25)";
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  }

  function loop(ts) {
    const dt = Math.min(50, ts - lastTs);
    lastTs = ts;

    if (!paused && !gameOver && piece) {
      const interval = softDown ? Math.max(35, dropMs / 12) : dropMs;
      if (restingOnStack()) {
        lockAcc += dt;
        if (lockAcc >= LOCK_MS) lockPiece();
      } else {
        lockAcc = 0;
        dropAcc += dt;
        while (dropAcc >= interval) {
          dropAcc -= interval;
          tryMove(0, 1);
        }
      }
    }

    draw();
    requestAnimationFrame(loop);
  }

  function resetGame() {
    emptyGrid();
    score = 0;
    lines = 0;
    level = 1;
    dropMs = 800;
    dropAcc = 0;
    lockAcc = 0;
    gameOver = false;
    paused = false;
    piece = null;
    refillBag();
    scoreNowEl.textContent = "0";
    linesNowEl.textContent = "0";
    levelNowEl.textContent = "1";
    scoreBestEl.textContent = String(bestLocal);
    overlay.hidden = true;
    pauseBtn.textContent = "Pauza";
    if (!trySpawn()) endGame();
  }

  pauseBtn.addEventListener("click", () => setPaused(!paused));
  playAgainBtn.addEventListener("click", () => resetGame());

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!gameOver) setPaused(!paused);
        return;
      }
      if (paused || gameOver) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (k === " " || k === "Spacebar") {
        e.preventDefault();
        hardDrop();
        return;
      }
      if (k === "ArrowLeft" || k === "a") {
        e.preventDefault();
        tryMove(-1, 0);
      } else if (k === "ArrowRight" || k === "d") {
        e.preventDefault();
        tryMove(1, 0);
      } else if (k === "ArrowDown" || k === "s") {
        e.preventDefault();
        softDown = true;
        tryMove(0, 1);
      } else if (k === "ArrowUp" || k === "w") {
        e.preventDefault();
        tryRotate(1);
      } else if (k === "q") {
        e.preventDefault();
        tryRotate(-1);
      }
    },
    { passive: false }
  );

  window.addEventListener("keyup", (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === "ArrowDown" || k === "s") softDown = false;
  });

  resetGame();
  requestAnimationFrame(loop);
})();
