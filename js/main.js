// Main UI + Auth logic (Firebase Email/Password).
// - Login existing users
// - Register new users (with repeat password)
// - Guest mode (no saved progress)
// - On first registration: write a dummy doc to Firestore `scores`

import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const authView = $("authView");
const dashboardView = $("dashboardView");
const authForm = $("authForm");
const logoutBtn = $("logoutBtn");

const modeLoginBtn = $("modeLogin");
const modeRegisterBtn = $("modeRegister");
const confirmField = $("confirmField");
const nicknameField = $("nicknameField");

const emailEl = /** @type {HTMLInputElement|null} */ ($("email"));
const nicknameEl = /** @type {HTMLInputElement|null} */ ($("nickname"));
const passwordEl = /** @type {HTMLInputElement|null} */ ($("password"));
const passwordConfirmEl = /** @type {HTMLInputElement|null} */ ($("passwordConfirm"));
const togglePasswordBtn = $("togglePassword");
const togglePasswordConfirmBtn = $("togglePasswordConfirm");
const userStatusText = $("userStatusText");

const submitBtn = $("submitBtn");
const guestBtn = $("guestBtn");
const authError = $("authError");

const rankingsTabSnake = $("rankingsTabSnake");
const rankingsTabPong = $("rankingsTabPong");
const rankingsTabTetris = $("rankingsTabTetris");
const rankingsPanel = $("rankingsPanel");
const globalRankingsBody = $("globalRankingsBody");
const rankingsScoreHeader = $("rankingsScoreHeader");
const rankingsError = $("rankingsError");

if (
  !authView ||
  !dashboardView ||
  !authForm ||
  !logoutBtn ||
  !modeLoginBtn ||
  !modeRegisterBtn ||
  !confirmField ||
  !nicknameField ||
  !emailEl ||
  !nicknameEl ||
  !passwordEl ||
  !togglePasswordBtn ||
  !submitBtn ||
  !guestBtn ||
  !authError ||
  !rankingsTabSnake ||
  !rankingsTabPong ||
  !rankingsTabTetris ||
  !rankingsPanel ||
  !globalRankingsBody ||
  !rankingsScoreHeader ||
  !rankingsError
) {
  throw new Error("Required UI elements are missing from index.html");
}

let mode = /** @type {"login" | "register"} */ ("login");
let isGuest = false;
let currentNickname = "";

/** @type {"snake" | "pong" | "tetris"} */
let activeRankGame = "snake";

/** @type {Record<string, Record<string, unknown>[]>} */
let leaderboardCache = { snake: [], pong: [], tetris: [] };

let rankingsLoading = false;

/** @type {HTMLButtonElement[]} */
const rankTabButtons = [rankingsTabSnake, rankingsTabPong, rankingsTabTetris];

const SCORE_HEADER_LABEL = {
  snake: "Skóre",
  tetris: "Skóre",
  pong: "Rozdíl branek",
};

function setRankingsError(message) {
  if (!message) {
    rankingsError.hidden = true;
    rankingsError.textContent = "";
    rankingsError.replaceChildren();
    return;
  }
  rankingsError.hidden = false;
  rankingsError.replaceChildren();
  const urlMatch = String(message).match(/https:\/\/console\.firebase\.google\.com\/[^\s)]+/);
  const text = urlMatch ? String(message).split(urlMatch[0])[0].trim() : String(message);
  rankingsError.appendChild(document.createTextNode(text));
  if (urlMatch) {
    rankingsError.appendChild(document.createElement("br"));
    const a = document.createElement("a");
    a.href = urlMatch[0];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = "rankings-error__link";
    a.textContent = "Vytvořit složený index (Firestore)";
    rankingsError.appendChild(a);
  }
}

function formatScoreCell(gameId, raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  if (gameId === "pong") {
    const abs = Math.abs(n);
    const formatted = abs.toLocaleString();
    if (n > 0) return `+${formatted}`;
    if (n < 0) return `−${formatted}`;
    return "0";
  }
  return n.toLocaleString();
}

function renderGlobalRankingsTable() {
  globalRankingsBody.replaceChildren();
  rankingsScoreHeader.textContent = SCORE_HEADER_LABEL[activeRankGame] ?? "Skóre";

  if (rankingsLoading) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.className = "rankings-table__empty";
    td.textContent = "Načítání žebříčku…";
    tr.appendChild(td);
    globalRankingsBody.appendChild(tr);
    return;
  }

  const rows = leaderboardCache[activeRankGame] ?? [];
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.className = "rankings-table__empty";
    td.textContent = "Pro tuto hru zatím nikdo nehrál.";
    tr.appendChild(td);
    globalRankingsBody.appendChild(tr);
    return;
  }

  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.className = "rankings-table__row";

    const rankTd = document.createElement("td");
    rankTd.className = "rankings-table__rank";
    rankTd.textContent = String(i + 1);

    const nameTd = document.createElement("td");
    nameTd.className = "rankings-table__name";
    const nick = row.nickname;
    nameTd.textContent = typeof nick === "string" && nick.trim() ? nick : "Neznámý";

    const scoreTd = document.createElement("td");
    scoreTd.className = "rankings-table__score";
    scoreTd.textContent = formatScoreCell(activeRankGame, row.score);

    tr.append(rankTd, nameTd, scoreTd);
    globalRankingsBody.appendChild(tr);
  });
}

function setActiveRankTab(gameId) {
  activeRankGame = gameId;
  for (const btn of rankTabButtons) {
    const g = btn.dataset.game;
    const on = g === gameId;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", String(on));
  }
  const activeBtn = rankTabButtons.find((b) => b.dataset.game === gameId);
  if (activeBtn && rankingsPanel) {
    rankingsPanel.setAttribute("aria-labelledby", activeBtn.id);
  }
  renderGlobalRankingsTable();
}

/**
 * Loads top 5 rows per game from `leaderboard` (separate query per game).
 * Pong `score` is cumulative goal difference (player − AI), per games/pong/game.js.
 */
async function fetchGlobalLeaderboards() {
  setRankingsError("");
  rankingsLoading = true;
  renderGlobalRankingsTable();

  const gameIds = /** @type {const} */ (["snake", "pong", "tetris"]);
  const errors = [];

  await Promise.all(
    gameIds.map(async (gameId) => {
      try {
        const q = query(
          collection(db, "leaderboard"),
          where("game", "==", gameId),
          orderBy("score", "desc"),
          limit(5)
        );
        const snap = await getDocs(q);
        leaderboardCache[gameId] = snap.docs.map((d) => d.data());
      } catch (err) {
        leaderboardCache[gameId] = [];
        errors.push(`${gameId}: ${err?.message ?? err}`);
        // eslint-disable-next-line no-console
        console.error("Leaderboard fetch failed:", gameId, err);
      }
    })
  );

  rankingsLoading = false;
  if (errors.length) {
    setRankingsError(
      errors.length === gameIds.length
        ? `Žebříček se nepodařilo načíst. ${errors[0]}`
        : `Některé žebříčky se nepodařilo načíst: ${errors.join(" · ")}`
    );
  }
  renderGlobalRankingsTable();
}

for (const btn of rankTabButtons) {
  btn.addEventListener("click", () => {
    const gameId = btn.dataset.game;
    if (!gameId || gameId === activeRankGame) return;
    setActiveRankTab(/** @type {"snake"|"pong"|"tetris"} */ (gameId));
  });
}

function wirePasswordToggle(inputEl, toggleBtn, { labelBase }) {
  const setVisible = (visible) => {
    inputEl.type = visible ? "text" : "password";
    toggleBtn.textContent = visible ? "Skrýt" : "Zobrazit";
    toggleBtn.setAttribute("aria-pressed", String(visible));
    toggleBtn.setAttribute("aria-label", `${visible ? "Skrýt" : "Zobrazit"}: ${labelBase}`);
  };

  setVisible(false);

  toggleBtn.addEventListener("click", () => {
    const nextVisible = inputEl.type === "password";
    setVisible(nextVisible);
    inputEl.focus();
  });
}

function setError(message) {
  if (!message) {
    authError.hidden = true;
    authError.textContent = "";
    return;
  }
  authError.hidden = false;
  authError.textContent = message;
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  guestBtn.disabled = busy;
  modeLoginBtn.disabled = busy;
  modeRegisterBtn.disabled = busy;
  emailEl.disabled = busy;
  passwordEl.disabled = busy;
  if (passwordConfirmEl) passwordConfirmEl.disabled = busy;
  togglePasswordBtn.disabled = busy;
  if (togglePasswordConfirmBtn) togglePasswordConfirmBtn.disabled = busy;
  nicknameEl.disabled = busy;
}

function setMode(nextMode) {
  mode = nextMode;
  setError("");

  const isRegister = mode === "register";
  confirmField.hidden = !isRegister;
  nicknameField.hidden = !isRegister;
  if (togglePasswordConfirmBtn) togglePasswordConfirmBtn.hidden = !isRegister;

  modeLoginBtn.classList.toggle("is-active", !isRegister);
  modeRegisterBtn.classList.toggle("is-active", isRegister);
  modeLoginBtn.setAttribute("aria-selected", String(!isRegister));
  modeRegisterBtn.setAttribute("aria-selected", String(isRegister));

  submitBtn.textContent = isRegister ? "Vytvořit účet" : "Přihlásit se";

  // Improve autocomplete semantics for password field
  passwordEl.autocomplete = isRegister ? "new-password" : "current-password";

  if (!isRegister && passwordConfirmEl) passwordConfirmEl.value = "";
  if (!isRegister) nicknameEl.value = "";
}

function setView({ showDashboard }) {
  authView.hidden = showDashboard;
  dashboardView.hidden = !showDashboard;
  logoutBtn.hidden = !showDashboard;
  if (showDashboard) {
    void fetchGlobalLeaderboards();
  }
}

function setUserStatusLabel(label) {
  if (!userStatusText) return;
  userStatusText.textContent = label;
}

function friendlyAuthError(err) {
  const code = typeof err?.code === "string" ? err.code : "";

  switch (code) {
    case "auth/invalid-email":
      return "Neplatná e-mailová adresa.";
    case "auth/user-not-found":
      return "Uživatel nenalezen.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Špatný e-mail nebo heslo.";
    case "auth/email-already-in-use":
      return "Tento e-mail je už registrovaný. Zkuste se přihlásit.";
    case "auth/weak-password":
      return "Heslo je příliš slabé. Použijte alespoň 6 znaků.";
    case "auth/too-many-requests":
      return "Příliš mnoho pokusů. Zkuste to později.";
    default:
      return "Něco se pokazilo. Zkuste to znovu.";
  }
}

function normalizeNickname(raw) {
  return raw.trim().toLowerCase();
}

function validateNickname(raw) {
  const nickname = raw.trim();
  if (!nickname) return { ok: false, message: "Zvolte přezdívku." };
  if (nickname.length < 3) return { ok: false, message: "Přezdívka musí mít alespoň 3 znaky." };
  if (nickname.length > 20) return { ok: false, message: "Přezdívka může mít nejvýše 20 znaků." };
  if (!/^[a-zA-Z0-9_]+$/.test(nickname)) {
    return { ok: false, message: "Přezdívka smí obsahovat jen písmena, čísla a podtržítko." };
  }
  return { ok: true, nickname };
}

async function isNicknameAvailable(nickname) {
  // Case-insensitive uniqueness by querying a normalized field.
  const nickLower = normalizeNickname(nickname);
  const q = query(
    collection(db, "users"),
    where("nicknameLower", "==", nickLower),
    limit(1)
  );
  const snap = await getDocs(q);
  return snap.empty;
}

async function fetchNicknameForUser(uid) {
  const userDoc = await getDoc(doc(db, "users", uid));
  if (!userDoc.exists()) return "";
  const data = userDoc.data();
  return typeof data?.nickname === "string" ? data.nickname : "";
}

async function writeFirstRegistrationTestScore(user) {
  // Dummy test write required by the task.
  await addDoc(collection(db, "scores"), {
    username: currentNickname || user.email || "unknown",
    game: "test",
    score: 100,
    createdAt: serverTimestamp(),
    uid: user.uid,
  });
}

modeLoginBtn.addEventListener("click", () => setMode("login"));
modeRegisterBtn.addEventListener("click", () => setMode("register"));

guestBtn.addEventListener("click", () => {
  setError("");
  isGuest = true;
  currentNickname = "Host";
  setUserStatusLabel("Host");
  setView({ showDashboard: true });
  dashboardView.scrollIntoView({ block: "start", behavior: "smooth" });
});

logoutBtn.addEventListener("click", async () => {
  setError("");

  // Guest mode: just return to auth view.
  if (isGuest) {
    isGuest = false;
    currentNickname = "";
    setUserStatusLabel("Odhlášen");
    authForm.reset();
    setView({ showDashboard: false });
    emailEl.focus();
    return;
  }

  // Authenticated mode: sign out from Firebase.
  try {
    setBusy(true);
    await signOut(auth);
  } catch (err) {
    setError("Odhlášení se nezdařilo. Zkuste to znovu.");
    // eslint-disable-next-line no-console
    console.error(err);
  } finally {
    setBusy(false);
  }
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");

  const email = emailEl.value.trim();
  const nickname = nicknameEl.value;
  const password = passwordEl.value;
  const passwordConfirm = passwordConfirmEl?.value ?? "";

  if (!email || !password) {
    setError("Zadejte e-mail a heslo.");
    return;
  }

  if (mode === "register") {
    const nickCheck = validateNickname(nickname);
    if (!nickCheck.ok) {
      setError(nickCheck.message);
      return;
    }

    if (password.length < 6) {
      setError("Heslo musí mít alespoň 6 znaků.");
      return;
    }
    if (!passwordConfirm) {
      setError("Zopakujte heslo.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("Hesla se neshodují.");
      return;
    }
  }

  try {
    setBusy(true);

    if (mode === "login") {
      isGuest = false;
      await signInWithEmailAndPassword(auth, email, password);
      return;
    }

    // Register
    isGuest = false;

    // Crucial: check nickname uniqueness BEFORE creating auth user.
    const available = await isNicknameAvailable(nickname);
    if (!available) {
      setError("Tato přezdívka je už obsazená.");
      return;
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);

    currentNickname = validateNickname(nickname).nickname;
    await setDoc(doc(db, "users", cred.user.uid), {
      nickname: currentNickname,
      nicknameLower: normalizeNickname(currentNickname),
      email: cred.user.email ?? email,
      createdAt: serverTimestamp(),
    });

    await writeFirstRegistrationTestScore(cred.user);
  } catch (err) {
    setError(friendlyAuthError(err));
    // eslint-disable-next-line no-console
    console.error(err);
  } finally {
    setBusy(false);
  }
});

// Keep UI in sync with Firebase auth state.
onAuthStateChanged(auth, async (user) => {
  if (user) {
    isGuest = false;
    setView({ showDashboard: true });
    try {
      currentNickname = await fetchNicknameForUser(user.uid);
      setUserStatusLabel(
        currentNickname ? `Přihlášen jako ${currentNickname}` : "Přihlášen"
      );
    } catch (err) {
      setUserStatusLabel("Přihlášen");
      // eslint-disable-next-line no-console
      console.error(err);
    }
    return;
  }

  // If user signed out, only show auth screen if not in guest mode.
  setView({ showDashboard: isGuest });
  if (!isGuest) setUserStatusLabel("Odhlášen");
});

// Initial state
wirePasswordToggle(passwordEl, togglePasswordBtn, { labelBase: "heslo" });
if (passwordConfirmEl && togglePasswordConfirmBtn) {
  wirePasswordToggle(passwordConfirmEl, togglePasswordConfirmBtn, {
    labelBase: "potvrzení hesla",
  });
}
setMode("login");
setView({ showDashboard: false });
emailEl.focus();

