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
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas?.getContext?.("2d");

  const p1ScoreEl = document.getElementById("p1Score");
  const p2ScoreEl = document.getElementById("p2Score");
  const statusLine = document.getElementById("statusLine");
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
    !p1ScoreEl ||
    !p2ScoreEl ||
    !statusLine ||
    !pauseBtn ||
    !overlay ||
    !overlayTitle ||
    !overlayText ||
    !playAgainBtn ||
    !authNote ||
    !globalList ||
    !leaderboardError
  ) {
    throw new Error("Pong: required DOM elements not found.");
  }

  const GAME_ID = "pong";
  const WIN_SCORE = 5;

  // Visual palette (match portal theme)
  const colors = {
    bg: "rgba(8, 10, 22, 0.86)",
    grid: "rgba(46, 242, 255, 0.08)",
    player: "#2ef2ff",
    playerGlow: "rgba(46, 242, 255, 0.28)",
    bot: "#ff2bd6",
    botGlow: "rgba(255, 43, 214, 0.22)",
    ball: "rgba(245, 247, 255, 0.92)",
    ballGlow: "rgba(245, 247, 255, 0.22)",
    text: "rgba(245, 247, 255, 0.92)",
    muted: "rgba(245, 247, 255, 0.68)",
  };

  // Auth / nickname
  /** @type {import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js").User | null} */
  let currentUser = null;
  let currentNickname = "";
  let canSave = false;

  function setAuthNote(message) {
    authNote.textContent = message;
  }

  /**
   * Shows Firestore errors with full message (includes index URL when applicable).
   * Uses orderBy(score) only + client filter to avoid needing a composite index on (game, score).
   */
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
      a.textContent = "Create index in Firebase Console";
      leaderboardError.appendChild(a);
    }
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
      li.textContent = "No scores yet. Be the first.";
      globalList.appendChild(li);
      return;
    }

    for (const row of entries) {
      const li = document.createElement("li");
      li.className = "leader-row";

      const name = document.createElement("span");
      name.className = "leader-name";
      name.textContent = row.nickname || "Unknown";

      const scoreEl = document.createElement("span");
      scoreEl.className = "leader-score";
      scoreEl.textContent = String(row.score ?? 0);

      li.appendChild(name);
      li.appendChild(scoreEl);
      globalList.appendChild(li);
    }
  }

  // Save best-per-user score to `leaderboard/{uid_pong}` if player wins.
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
        nickname: currentNickname || currentUser.email || "Unknown",
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

  // Live leaderboard: single-field orderBy(score) + filter by game (no composite index on game+score).
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

  // Game state
  const W = canvas.width;
  const H = canvas.height;

  const paddle = {
    w: 12,
    h: 86,
    margin: 18,
  };

  const player = {
    x: paddle.margin,
    y: (H - paddle.h) / 2,
    vy: 0,
    speed: 380, // px/s
  };

  const bot = {
    x: W - paddle.margin - paddle.w,
    y: (H - paddle.h) / 2,
    vy: 0,
    maxSpeed: 300, // fixed cap so player can win
  };

  const ball = {
    x: W / 2,
    y: H / 2,
    r: 6,
    vx: 330, // px/s (changes)
    vy: 120,
    max: 720, // clamp
  };

  let p1 = 0;
  let p2 = 0;
  let paused = false;
  let over = false;
  let lastMs = performance.now();

  function setOverlay({ show, title, text }) {
    overlay.hidden = !show;
    if (title) overlayTitle.textContent = title;
    if (text) overlayText.textContent = text;
  }

  function setPaused(next) {
    if (over) return;
    paused = next;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    statusLine.textContent = paused ? "Paused • Esc to resume" : "W/S or Arrows • Esc to pause";
    setOverlay({
      show: paused,
      title: "Paused",
      text: "Press Escape to resume.",
    });
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function resetRound(directionToBot) {
    ball.x = W / 2;
    ball.y = H / 2;

    const base = 340;
    const angle = (Math.random() * 0.7 - 0.35) * Math.PI; // slight randomness
    const vx = Math.cos(angle) * base;
    const vy = Math.sin(angle) * base;

    ball.vx = (directionToBot ? 1 : -1) * Math.max(220, Math.abs(vx));
    ball.vy = clamp(vy, -260, 260);
  }

  function startMatch() {
    p1 = 0;
    p2 = 0;
    p1ScoreEl.textContent = "0";
    p2ScoreEl.textContent = "0";
    player.y = (H - paddle.h) / 2;
    bot.y = (H - paddle.h) / 2;
    over = false;
    setOverlay({ show: false });
    setPaused(false);
    resetRound(true);
  }

  function reflectFromPaddle(paddleY, isPlayerSide) {
    // Angle depends on where ball hits the paddle.
    const paddleCenter = paddleY + paddle.h / 2;
    const rel = (ball.y - paddleCenter) / (paddle.h / 2); // -1..1
    const maxBounce = 0.95; // rad-ish feel

    const speed = Math.min(ball.max, Math.hypot(ball.vx, ball.vy) * 1.05);
    const angle = rel * maxBounce;

    const dir = isPlayerSide ? 1 : -1;
    ball.vx = dir * Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
  }

  function computeWinScore() {
    // Game design: reward winning harder matches.
    // Score = (pointDiff * 100) + (paceBonus based on ball max speed seen)
    const diff = p1 - p2; // positive
    const pace = Math.min(ball.max, Math.hypot(ball.vx, ball.vy));
    const paceBonus = Math.round(pace / 6); // ~50..120
    return Math.max(1, diff * 100 + paceBonus);
  }

  function endMatch(playerWon) {
    over = true;
    paused = false;
    pauseBtn.textContent = "Pause";

    if (playerWon) {
      const score = computeWinScore();
      setOverlay({
        show: true,
        title: "Victory",
        text: `You won ${p1}–${p2}. Score: ${score}${canSave ? " (saved if best)" : ""}`,
      });
      void saveGlobalScore(score);
    } else {
      setOverlay({
        show: true,
        title: "Defeat",
        text: `Bot wins ${p2}–${p1}. Try sharper angles.`,
      });
    }
  }

  function step(dt) {
    // Player movement
    player.y = clamp(player.y + player.vy * dt, 0, H - paddle.h);

    // Bot AI: follow ball with max speed + slight prediction
    const targetY = ball.y - paddle.h / 2;
    const dy = targetY - bot.y;
    const desired = clamp(dy * 6, -bot.maxSpeed, bot.maxSpeed);
    bot.y = clamp(bot.y + desired * dt, 0, H - paddle.h);

    // Ball
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Top/bottom collision
    if (ball.y - ball.r <= 0) {
      ball.y = ball.r;
      ball.vy *= -1;
    } else if (ball.y + ball.r >= H) {
      ball.y = H - ball.r;
      ball.vy *= -1;
    }

    // Paddle collisions
    // Player paddle AABB
    const px1 = player.x;
    const px2 = player.x + paddle.w;
    const py1 = player.y;
    const py2 = player.y + paddle.h;

    // Bot paddle AABB
    const bx1 = bot.x;
    const bx2 = bot.x + paddle.w;
    const by1 = bot.y;
    const by2 = bot.y + paddle.h;

    // Player side collision
    if (
      ball.vx < 0 &&
      ball.x - ball.r <= px2 &&
      ball.x - ball.r >= px1 - 8 &&
      ball.y >= py1 &&
      ball.y <= py2
    ) {
      ball.x = px2 + ball.r;
      reflectFromPaddle(player.y, true);
    }

    // Bot side collision
    if (
      ball.vx > 0 &&
      ball.x + ball.r >= bx1 &&
      ball.x + ball.r <= bx2 + 8 &&
      ball.y >= by1 &&
      ball.y <= by2
    ) {
      ball.x = bx1 - ball.r;
      reflectFromPaddle(bot.y, false);
    }

    // Scoring: ball passed edges
    if (ball.x + ball.r < 0) {
      p2 += 1;
      p2ScoreEl.textContent = String(p2);
      if (p2 >= WIN_SCORE) endMatch(false);
      else resetRound(false);
    } else if (ball.x - ball.r > W) {
      p1 += 1;
      p1ScoreEl.textContent = String(p1);
      if (p1 >= WIN_SCORE) endMatch(true);
      else resetRound(true);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);

    // Center line (dashed)
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 12);
    ctx.lineTo(W / 2, H - 12);
    ctx.stroke();
    ctx.setLineDash([]);

    // Paddles
    ctx.save();
    ctx.shadowBlur = 18;

    // Player
    ctx.shadowColor = colors.playerGlow;
    ctx.fillStyle = colors.player;
    ctx.fillRect(player.x, player.y, paddle.w, paddle.h);

    // Bot
    ctx.shadowColor = colors.botGlow;
    ctx.fillStyle = colors.bot;
    ctx.fillRect(bot.x, bot.y, paddle.w, paddle.h);

    // Ball
    ctx.shadowColor = colors.ballGlow;
    ctx.fillStyle = colors.ball;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(0.033, (now - lastMs) / 1000);
    lastMs = now;

    if (!paused && !over) step(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // Input
  const keys = new Set();

  function updatePlayerVelocity() {
    const up = keys.has("ArrowUp") || keys.has("w") || keys.has("W");
    const down = keys.has("ArrowDown") || keys.has("s") || keys.has("S");
    player.vy = (up ? -1 : 0) * player.speed + (down ? 1 : 0) * player.speed;
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setPaused(!paused);
        return;
      }

      keys.add(e.key);
      updatePlayerVelocity();
    },
    { passive: false }
  );

  window.addEventListener("keyup", (e) => {
    keys.delete(e.key);
    updatePlayerVelocity();
  });

  pauseBtn.addEventListener("click", () => setPaused(!paused));
  playAgainBtn.addEventListener("click", () => startMatch());

  // Auth integration
  setAuthNote("Checking login…");
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    currentNickname = "";
    canSave = false;

    if (!user) {
      setAuthNote("Log in to save your score.");
      return;
    }

    try {
      currentNickname = await fetchNicknameForUser(user.uid);
      canSave = Boolean(currentNickname);
      setAuthNote(canSave ? `Saving as ${currentNickname}.` : "Log in to save your score.");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setAuthNote("Log in to save your score.");
    }
  });

  // Init
  startMatch();
  requestAnimationFrame((t) => {
    lastMs = t;
    requestAnimationFrame(loop);
  });
})();

