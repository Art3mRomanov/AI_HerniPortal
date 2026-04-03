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
  !authError
) {
  throw new Error("Required UI elements are missing from index.html");
}

let mode = /** @type {"login" | "register"} */ ("login");
let isGuest = false;
let currentNickname = "";

function wirePasswordToggle(inputEl, toggleBtn, { labelBase }) {
  const setVisible = (visible) => {
    inputEl.type = visible ? "text" : "password";
    toggleBtn.textContent = visible ? "Hide" : "Show";
    toggleBtn.setAttribute("aria-pressed", String(visible));
    toggleBtn.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${labelBase}`);
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

  submitBtn.textContent = isRegister ? "Create account" : "Login";

  // Improve autocomplete semantics for password field
  passwordEl.autocomplete = isRegister ? "new-password" : "current-password";

  if (!isRegister && passwordConfirmEl) passwordConfirmEl.value = "";
  if (!isRegister) nicknameEl.value = "";
}

function setView({ showDashboard }) {
  authView.hidden = showDashboard;
  dashboardView.hidden = !showDashboard;
  logoutBtn.hidden = !showDashboard;
}

function setUserStatusLabel(label) {
  if (!userStatusText) return;
  userStatusText.textContent = label;
}

function friendlyAuthError(err) {
  const code = typeof err?.code === "string" ? err.code : "";

  switch (code) {
    case "auth/invalid-email":
      return "Invalid email address.";
    case "auth/user-not-found":
      return "User not found.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Wrong email or password.";
    case "auth/email-already-in-use":
      return "This email is already registered. Try logging in.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function normalizeNickname(raw) {
  return raw.trim().toLowerCase();
}

function validateNickname(raw) {
  const nickname = raw.trim();
  if (!nickname) return { ok: false, message: "Please choose a nickname." };
  if (nickname.length < 3) return { ok: false, message: "Nickname must be at least 3 characters." };
  if (nickname.length > 20) return { ok: false, message: "Nickname must be 20 characters or less." };
  if (!/^[a-zA-Z0-9_]+$/.test(nickname)) {
    return { ok: false, message: "Nickname can use only letters, numbers, and underscore." };
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
  currentNickname = "Guest";
  setUserStatusLabel("Guest");
  setView({ showDashboard: true });
  dashboardView.scrollIntoView({ block: "start", behavior: "smooth" });
});

logoutBtn.addEventListener("click", async () => {
  setError("");

  // Guest mode: just return to auth view.
  if (isGuest) {
    isGuest = false;
    currentNickname = "";
    setUserStatusLabel("Logged out");
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
    setError("Logout failed. Please try again.");
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
    setError("Please enter your email and password.");
    return;
  }

  if (mode === "register") {
    const nickCheck = validateNickname(nickname);
    if (!nickCheck.ok) {
      setError(nickCheck.message);
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (!passwordConfirm) {
      setError("Please repeat your password.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("Passwords do not match.");
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
      setError("This nickname is already taken.");
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
      setUserStatusLabel(currentNickname ? `Logged in as ${currentNickname}` : "Logged in");
    } catch (err) {
      setUserStatusLabel("Logged in");
      // eslint-disable-next-line no-console
      console.error(err);
    }
    return;
  }

  // If user signed out, only show auth screen if not in guest mode.
  setView({ showDashboard: isGuest });
  if (!isGuest) setUserStatusLabel("Logged out");
});

// Initial state
wirePasswordToggle(passwordEl, togglePasswordBtn, { labelBase: "password" });
if (passwordConfirmEl && togglePasswordConfirmBtn) {
  wirePasswordToggle(passwordConfirmEl, togglePasswordConfirmBtn, {
    labelBase: "confirm password",
  });
}
setMode("login");
setView({ showDashboard: false });
emailEl.focus();

