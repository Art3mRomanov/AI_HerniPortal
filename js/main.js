(() => {
  const authView = document.getElementById("authView");
  const dashboardView = document.getElementById("dashboardView");
  const authForm = document.getElementById("authForm");
  const logoutBtn = document.getElementById("logoutBtn");
  const authHint = document.getElementById("authHint");

  if (!authView || !dashboardView || !authForm || !logoutBtn) return;

  const setLoggedIn = (loggedIn) => {
    authView.hidden = loggedIn;
    dashboardView.hidden = !loggedIn;
    logoutBtn.hidden = !loggedIn;

    if (!loggedIn) {
      authForm.reset();
      document.getElementById("email")?.focus();
      if (authHint) authHint.textContent = "Demo: click Login to toggle the dashboard.";
      return;
    }

    dashboardView.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  authForm.addEventListener("submit", (e) => {
    e.preventDefault();

    // Mock auth: accept any non-empty values.
    const email = /** @type {HTMLInputElement|null} */ (document.getElementById("email"))?.value?.trim();
    const password = /** @type {HTMLInputElement|null} */ (document.getElementById("password"))?.value ?? "";

    if (!email || !password) {
      if (authHint) authHint.textContent = "Please enter email + password (mock).";
      return;
    }

    setLoggedIn(true);
  });

  logoutBtn.addEventListener("click", () => setLoggedIn(false));

  // Initial state
  setLoggedIn(false);
})();

