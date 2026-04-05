import { auth, db } from "../../js/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  increment,
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
      a.textContent = "Vytvořit index ve Firebase Console";
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
      scoreEl.title = "Kumulativní rozdíl branek (vaše góly − góly soupeře)";

      li.appendChild(name);
      li.appendChild(scoreEl);
      globalList.appendChild(li);
    }
  }

  /**
   * Cumulative lifetime goal difference (your goals − AI goals) for this match,
   * atomically added to leaderboard/{uid}_pong via Firestore increment.
   */
  async function saveCumulativeGoalDifference() {
    if (!canSave || !currentUser) return;

    const matchDiff = p1 - p2;
    if (!Number.isFinite(matchDiff)) return;

    try {
      const ref = doc(db, "leaderboard", `${currentUser.uid}_pong`);
      await setDoc(
        ref,
        {
          uid: currentUser.uid,
          nickname: currentNickname || currentUser.email || "Neznámý",
          game: "pong",
          score: increment(matchDiff),
          lastMatchAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      showLeaderboardError(err);
    }
  }

  /**
   * Pong-only rows; `score` is cumulative goal difference (player − AI), highest first.
   * Composite index on (game, score) may be required in Firebase Console.
   */
  function subscribePongLeaderboard() {
    const q = query(
      collection(db, "leaderboard"),
      where("game", "==", "pong"),
      orderBy("score", "desc"),
      limit(10)
    );

    return onSnapshot(
      q,
      (snap) => {
        showLeaderboardError("");
        const rows = snap.docs.map((d) => d.data());
        renderGlobalTop10(rows);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        showLeaderboardError(err);
      }
    );
  }

  try {
    subscribePongLeaderboard();
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
    speed: 415, // px/s (nudged down slightly vs prior easy mode)
  };

  const bot = {
    x: W - paddle.margin - paddle.w,
    y: (H - paddle.h) / 2,
    vy: 0,
    maxSpeed: 252, // slightly higher cap = marginally harder
    trackGain: 4.65, // slightly snappier tracking than easy mode
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
    pauseBtn.textContent = paused ? "Pokračovat" : "Pauza";
    statusLine.textContent = paused ? "Pauza • Esc = pokračovat" : "W/S nebo šipky • Esc = pauza";
    setOverlay({
      show: paused,
      title: "Pauza",
      text: "Stiskněte Esc pro pokračování.",
    });
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  /**
   * Serve after a point: ball travels toward whoever scored.
   * Player (left) scored → negative vx. AI (right) scored → positive vx.
   * Small random vy so the serve isn’t perfectly horizontal.
   * @param {'player' | 'ai'} scorer
   */
  function resetRound(scorer) {
    ball.x = W / 2;
    ball.y = H / 2;

    const speedX = 260 + Math.random() * 70;
    ball.vx = scorer === "player" ? -speedX : speedX;

    ball.vy = (Math.random() * 2 - 1) * 150;
    ball.vy = clamp(ball.vy, -200, 200);
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
    // Opening serve: toward AI (classic feel); alternates could use last scorer later
    resetRound("ai");
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

  function endMatch(playerWon) {
    over = true;
    paused = false;
    pauseBtn.textContent = "Pauza";

    const matchDiff = p1 - p2;
    const diffLabel =
      matchDiff > 0
        ? `+${matchDiff}`
        : matchDiff === 0
          ? "0"
          : String(matchDiff);

    void saveCumulativeGoalDifference();

    if (playerWon) {
      setOverlay({
        show: true,
        title: "Výhra",
        text: `Vyhráváte ${p1}–${p2}. Rozdíl v zápase: ${diffLabel}${canSave ? " (přičteno k celkovému skóre)" : ""}`,
      });
    } else {
      setOverlay({
        show: true,
        title: "Prohra",
        text: `Vyhrává AI ${p2}–${p1}. Rozdíl v zápase: ${diffLabel}${canSave ? " (přičteno k celkovému skóre)" : ""}`,
      });
    }
  }

  function step(dt) {
    // Player movement
    player.y = clamp(player.y + player.vy * dt, 0, H - paddle.h);

    // Bot AI: track ball Y with capped speed (slightly softened so the player can win more often)
    const targetY = ball.y - paddle.h / 2;
    const dy = targetY - bot.y;
    const desired = clamp(dy * bot.trackGain, -bot.maxSpeed, bot.maxSpeed);
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

    // Scoring: ball passed edges — next serve goes toward whoever scored
    if (ball.x + ball.r < 0) {
      p2 += 1;
      p2ScoreEl.textContent = String(p2);
      if (p2 >= WIN_SCORE) endMatch(false);
      else resetRound("ai");
    } else if (ball.x - ball.r > W) {
      p1 += 1;
      p1ScoreEl.textContent = String(p1);
      if (p1 >= WIN_SCORE) endMatch(true);
      else resetRound("player");
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

      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === " " ||
        e.key === "Spacebar"
      ) {
        e.preventDefault();
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
          ? `Přihlášen jako ${currentNickname} — každý zápas upraví celkový rozdíl branek.`
          : "Přihlaste se pro uložení skóre."
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setAuthNote("Přihlaste se pro uložení skóre.");
    }
  });

  // Init
  startMatch();
  requestAnimationFrame((t) => {
    lastMs = t;
    requestAnimationFrame(loop);
  });
})();

