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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const authView = $("authView");
const dashboardView = $("dashboardView");
const authForm = $("authForm");
const logoutBtn = $("logoutBtn");

const modeLoginBtn = $("modeLogin");
const modeRegisterBtn = $("modeRegister");
const confirmField = $("confirmField");

const emailEl = /** @type {HTMLInputElement|null} */ ($("email"));
const passwordEl = /** @type {HTMLInputElement|null} */ ($("password"));
const passwordConfirmEl = /** @type {HTMLInputElement|null} */ ($("passwordConfirm"));

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
  !emailEl ||
  !passwordEl ||
  !submitBtn ||
  !guestBtn ||
  !authError
) {
  throw new Error("Required UI elements are missing from index.html");
}

let mode = /** @type {"login" | "register"} */ ("login");
let isGuest = false;

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
}

function setMode(nextMode) {
  mode = nextMode;
  setError("");

  const isRegister = mode === "register";
  confirmField.hidden = !isRegister;

  modeLoginBtn.classList.toggle("is-active", !isRegister);
  modeRegisterBtn.classList.toggle("is-active", isRegister);
  modeLoginBtn.setAttribute("aria-selected", String(!isRegister));
  modeRegisterBtn.setAttribute("aria-selected", String(isRegister));

  submitBtn.textContent = isRegister ? "Create account" : "Login";

  // Improve autocomplete semantics for password field
  passwordEl.autocomplete = isRegister ? "new-password" : "current-password";

  if (!isRegister && passwordConfirmEl) passwordConfirmEl.value = "";
}

function setView({ showDashboard }) {
  authView.hidden = showDashboard;
  dashboardView.hidden = !showDashboard;
  logoutBtn.hidden = !showDashboard;
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

async function writeFirstRegistrationTestScore(user) {
  // Dummy test write required by the task.
  await addDoc(collection(db, "scores"), {
    username: user.email ?? "unknown",
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
  setView({ showDashboard: true });
  dashboardView.scrollIntoView({ block: "start", behavior: "smooth" });
});

logoutBtn.addEventListener("click", async () => {
  setError("");

  // Guest mode: just return to auth view.
  if (isGuest) {
    isGuest = false;
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
  const password = passwordEl.value;
  const passwordConfirm = passwordConfirmEl?.value ?? "";

  if (!email || !password) {
    setError("Please enter your email and password.");
    return;
  }

  if (mode === "register") {
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
    const cred = await createUserWithEmailAndPassword(auth, email, password);
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
onAuthStateChanged(auth, (user) => {
  if (user) {
    isGuest = false;
    setView({ showDashboard: true });
    return;
  }

  // If user signed out, only show auth screen if not in guest mode.
  setView({ showDashboard: isGuest });
});

// Initial state
setMode("login");
setView({ showDashboard: false });
emailEl.focus();

