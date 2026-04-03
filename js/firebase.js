// Firebase (Web SDK v9+ modular) initialization.
// This file exports configured `auth` and `db` instances for the app to use.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Optional analytics (safe to fail in local/dev environments).
import {
  getAnalytics,
  isSupported as analyticsIsSupported,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyBBMZXRBL6aLdLL1DDEjygrqlsKVY8T4z4",
  authDomain: "ai-herni-portal.firebaseapp.com",
  projectId: "ai-herni-portal",
  storageBucket: "ai-herni-portal.firebasestorage.app",
  messagingSenderId: "128139868307",
  appId: "1:128139868307:web:b56c9302c35ce8f09e3566",
  measurementId: "G-SN9CZ3EDDD",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Fire-and-forget analytics init (won't throw if unsupported).
try {
  if (await analyticsIsSupported()) getAnalytics(app);
} catch {
  // Analytics is optional; ignore errors.
}

