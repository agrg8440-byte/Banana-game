/**
 * Generated with AI assistance for CIS046-3 Software For Enterprise - Banana Game.
 *
 * ACADEMIC THEMES IMPLEMENTED IN CLIENT:
 *
 * [THEME: EVENT-DRIVEN PROGRAMMING]
 * - Direct DOM event bindings: click, keydown, submit, change, hashchange.
 * - Custom decoupled EventTarget bus ('bus') emitting and handling:
 *     'puzzle:loaded'    — puzzle image verified & timer initialized
 *     'puzzle:error'     — Banana API failure or timeout
 *     'answer:submitted' — answer entered by user via keypad or keyboard
 *     'answer:result'    — answer verified against session solution
 *     'game:over'        — survival lives exhausted or timed 60s expired
 *     'timer:tick'       — continuous UI timer synchronization
 *     'timer:ended'      — puzzle deadline or round deadline expired
 *     'session:expired'  — 401 unauthorized handling
 *
 * [THEME: INTEROPERABILITY]
 * - Communicates with server REST endpoints over HTTPS / HTTP via JSON.
 * - Client NEVER has access to the solution beforehand; only image URLs.
 *
 * [THEME: VIRTUAL IDENTITY]
 * - Client state reflects session cookie credentials without storing sensitive data.
 * - Reacts to login/register/logout actions with session cookies.
 */

(function () {
  "use strict";

  // --- EVENT BUS [THEME: EVENT-DRIVEN PROGRAMMING] ---
  const bus = new EventTarget();

  function emit(eventName, detail) {
    bus.dispatchEvent(new CustomEvent(eventName, { detail: detail || {} }));
  }

  // --- APPLICATION STATE ---
  const state = {
    user: null,
    game: null,
    busy: false,
    lastMode: "classic",
    boardMode: "classic",
    muted: localStorage.getItem("banana-game-mute") === "1",
    autoAdvanceTimer: null
  };

  // --- TIMER STATE ---
  let timerIntervalId = null;
  let timerEndsAt = 0;
  let timerTotalDuration = 1;
  let currentTimerKind = "none";

  // --- AUDIO SYNTHESIZER (Web Audio API) ---
  let audioContext = null;

  function getAudioContext() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContext = new AudioCtx();
      }
    }
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }

  function playTone(freq, type, duration, startTimeOffset, gainValue) {
    if (state.muted || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const start = ctx.currentTime + (startTimeOffset || 0);
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(gainValue || 0.05, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + duration);
    } catch {
      // Audio is non-blocking and optional
    }
  }

  const audio = {
    click() {
      playTone(480, "sine", 0.05, 0, 0.03);
    },
    correct(combo) {
      // Bright cheerful ascending chime
      const base = 523.25; // C5
      const mult = Math.min(2, 1 + ((combo || 1) - 1) * 0.1);
      playTone(base * mult, "triangle", 0.12, 0, 0.06);
      playTone(base * 1.25 * mult, "triangle", 0.14, 0.08, 0.06);
      playTone(base * 1.5 * mult, "sine", 0.22, 0.16, 0.07);
    },
    wrong() {
      // Gentle soft double thud
      playTone(220, "sawtooth", 0.14, 0, 0.04);
      playTone(164.8, "triangle", 0.22, 0.1, 0.05);
    },
    gameOver() {
      // Soft melodic resolution
      playTone(392, "triangle", 0.18, 0, 0.05);
      playTone(349.2, "triangle", 0.18, 0.14, 0.05);
      playTone(293.6, "sine", 0.35, 0.28, 0.06);
    }
  };

  // --- DOM HELPERS ---
  const $ = (id) => document.getElementById(id);

  function showToast(message) {
    const el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    window.clearTimeout(el._toastTimer);
    el._toastTimer = window.setTimeout(() => {
      el.hidden = true;
    }, 3200);
  }

  function setMuted(muted) {
    state.muted = muted;
    localStorage.setItem("banana-game-mute", muted ? "1" : "0");
    const btn = $("mute-btn");
    const icon = $("mute-icon");
    const label = $("mute-label");
    if (btn) {
      btn.setAttribute("aria-pressed", muted ? "true" : "false");
      btn.setAttribute("aria-label", muted ? "Unmute game sound" : "Mute game sound");
      if (icon) icon.textContent = muted ? "🔇" : "🔊";
      if (label) label.textContent = muted ? "Muted" : "Sound on";
    }
  }

  // --- HTTP REST API CLIENT [THEME: INTEROPERABILITY] ---
  async function api(path, options) {
    try {
      const res = await fetch(path, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        ...options
      });

      let body = {};
      try {
        body = await res.json();
      } catch {
        body = {};
      }

      if (res.status === 401 && body.error === "session_expired") {
        emit("session:expired", body);
      }

      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      return { ok: false, status: 0, body: { message: "Network connection error. Check your server." } };
    }
  }

  // --- ROUTING & VIEW CONTROLLER ---
  function currentView() {
    const hash = (location.hash || "#/").replace("#", "");
    const name = hash.split("?")[0].replace(/^\//, "") || "home";
    if (["home", "login", "register", "play", "profile", "board"].includes(name)) {
      return name;
    }
    return "home";
  }

  function showView(name) {
    document.querySelectorAll("[data-view]").forEach((section) => {
      section.hidden = section.getAttribute("data-view") !== name;
    });

    // Update active nav link highlighting
    document.querySelectorAll(".site-nav .nav-link").forEach((link) => {
      const targetHash = link.getAttribute("href");
      const targetView = targetHash.replace("#/", "").replace("#", "") || "home";
      if (targetView === name) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
      } else {
        link.classList.remove("active");
        link.removeAttribute("aria-current");
      }
    });
  }

  function renderAuthChrome() {
    const loggedIn = Boolean(state.user);
    document.querySelectorAll("[data-auth-link]").forEach((el) => {
      el.hidden = !loggedIn;
    });
    document.querySelectorAll("[data-guest-link]").forEach((el) => {
      el.hidden = loggedIn;
    });

    const nameEl = $("nav-username");
    if (nameEl && state.user) {
      nameEl.textContent = state.user.username;
    }
  }

  async function refreshUser() {
    const { body } = await api("/api/auth/me", { method: "GET" });
    state.user = body.user || null;
    renderAuthChrome();
    return state.user;
  }

  function guardAuthViews(view) {
    const needsAuth = view === "play" || view === "profile";
    if (needsAuth && !state.user) {
      location.hash = "#/login";
      return "login";
    }
    if ((view === "login" || view === "register") && state.user) {
      location.hash = "#/play";
      return "play";
    }
    return view;
  }

  function setFormError(id, message) {
    const el = $(id);
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || "";
  }

  // --- GAME HUD & TIMER CONTROLLER ---
  function hudFromGame(game) {
    if (!game) return;

    $("hud-mode").textContent = game.mode.toUpperCase();
    $("hud-score").textContent = String(game.score);
    $("hud-streak").textContent = String(game.streak);
    $("hud-combo").textContent = "×" + game.combo;

    $("hud-combo-wrap").hidden = game.mode !== "timed";
    $("hud-lives-wrap").hidden = game.mode !== "survival";

    if (game.mode === "survival") {
      const lives = Math.max(0, game.lives || 0);
      $("hud-lives").textContent = "♥".repeat(lives) + "♡".repeat(3 - lives);
    }
  }

  function stopTimer() {
    if (timerIntervalId) {
      window.clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }

  function paintTimer() {
    const track = $("timer-track");
    const bar = $("timer-bar");
    const digits = $("timer-digits");
    const container = $("timer-container");

    if (!container || container.hidden) return;

    const leftMs = Math.max(0, timerEndsAt - Date.now());
    const ratio = Math.max(0, Math.min(1, leftMs / timerTotalDuration));

    bar.style.transform = "scaleX(" + ratio + ")";
    track.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));

    if (digits) {
      const sec = (leftMs / 1000).toFixed(leftMs < 10000 ? 1 : 0);
      digits.textContent = sec + "s";
    }

    if (leftMs <= 0) {
      stopTimer();
      emit("timer:ended", { kind: currentTimerKind });
    }
  }

  function startTimer(timer) {
    stopTimer();
    const container = $("timer-container");
    const label = $("timer-label");

    if (!timer || timer.kind === "none" || !timer.totalMs) {
      if (container) container.hidden = true;
      return;
    }

    if (container) container.hidden = false;
    currentTimerKind = timer.kind;
    timerTotalDuration = timer.totalMs;
    timerEndsAt = Date.now() + timer.remainingMs;

    if (label) {
      label.textContent = timer.kind === "round" ? "Round Time Left" : "Puzzle Time Left";
    }

    paintTimer();
    timerIntervalId = window.setInterval(paintTimer, 100);
  }

  function setPadEnabled(enabled) {
    document.querySelectorAll("#numpad button").forEach((btn) => {
      btn.disabled = !enabled;
    });
  }

  function showPuzzleLoading() {
    $("puzzle-image").hidden = true;
    $("puzzle-error").hidden = true;
    $("puzzle-loading").hidden = false;
    $("feedback").textContent = "One attempt per puzzle. Tap a digit or type on your keyboard.";
    $("feedback").className = "feedback";
    $("feedback-points").hidden = true;
    $("next-puzzle").hidden = true;
  }

  // --- PUZZLE LOADER [THEME: INTEROPERABILITY] ---
  async function loadPuzzle() {
    if (state.autoAdvanceTimer) {
      window.clearTimeout(state.autoAdvanceTimer);
      state.autoAdvanceTimer = null;
    }

    if (!state.game || state.game.over) {
      return;
    }

    state.busy = true;
    setPadEnabled(false);
    showPuzzleLoading();

    const { ok, body } = await api("/api/game/puzzle", { method: "GET" });
    state.busy = false;

    if (body.over || (body.game && body.game.over)) {
      state.game = body.game;
      emit("game:over", { game: state.game });
      return;
    }

    if (!ok) {
      $("puzzle-loading").hidden = true;
      $("puzzle-error").hidden = false;
      $("puzzle-error-text").textContent =
        body.message || "The banana grove is busy. We could not fetch a puzzle.";
      emit("puzzle:error", body);
      return;
    }

    // Preload puzzle image before revealing to prevent visual jumps
    const img = $("puzzle-image");
    const preloader = new Image();

    preloader.onload = () => {
      img.src = preloader.src;
      img.hidden = false;
      $("puzzle-loading").hidden = true;
      $("puzzle-error").hidden = true;

      state.game = body.game;
      hudFromGame(state.game);

      // Start countdown ONLY when the puzzle is completely visible!
      startTimer(body.timer || body.game.timer);
      setPadEnabled(true);

      emit("puzzle:loaded", { image: body.image, game: body.game });
    };

    preloader.onerror = () => {
      $("puzzle-loading").hidden = true;
      $("puzzle-error").hidden = false;
      $("puzzle-error-text").textContent = "Could not load the puzzle image from the server.";
    };

    preloader.src = body.image;
  }

  async function startMode(mode) {
    state.lastMode = mode;
    const { ok, body } = await api("/api/game/start", {
      method: "POST",
      body: JSON.stringify({ mode })
    });

    if (!ok) {
      showToast(body.message || "Could not start the game mode.");
      return;
    }

    state.game = body.game;
    $("mode-picker").hidden = true;
    $("run-over").hidden = true;
    $("play-table").hidden = false;

    hudFromGame(state.game);
    await loadPuzzle();
  }

  // --- SUBMIT ANSWER [THEME: EVENT-DRIVEN PROGRAMMING] ---
  async function submitAnswer(digit, extra) {
    if (state.busy || !state.game || !state.game.awaitingAnswer) {
      return;
    }

    if (state.autoAdvanceTimer) {
      window.clearTimeout(state.autoAdvanceTimer);
      state.autoAdvanceTimer = null;
    }

    state.busy = true;
    setPadEnabled(false);
    stopTimer();

    const timedOut = Boolean(extra && extra.timeout);
    const payload = timedOut ? { timeout: true } : { answer: digit };

    const { ok, body } = await api("/api/game/answer", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    state.busy = false;

    if (!ok) {
      showToast(body.message || "Could not submit that answer.");
      setPadEnabled(true);
      return;
    }

    state.game = body.game;
    hudFromGame(state.game);
    emit("answer:result", body);

    if (body.game.over) {
      emit("game:over", { game: body.game, last: body });
    } else {
      $("next-puzzle").hidden = false;
      $("next-puzzle").focus();

      // AUTO-ADVANCE FOR SEAMLESS GAMEPLAY:
      // In timed mode: fast 800ms auto-advance so player doesn't waste precious round seconds.
      // In survival mode: 1000ms. In classic: 1200ms.
      // Player can also tap "Next Puzzle" or press Enter to advance immediately!
      const delayMs = body.game.mode === "timed" ? 850 : (body.game.mode === "survival" ? 1100 : 1300);
      state.autoAdvanceTimer = window.setTimeout(() => {
        if (!state.game.over && !$("next-puzzle").hidden) {
          loadPuzzle();
        }
      }, delayMs);
    }
  }

  // --- PROFILE VIEW RENDERER ---
  function renderProfile(user) {
    const heading = $("profile-heading");
    const nameEl = $("profile-name");
    if (heading) heading.textContent = user.username + "'s Profile";
    if (nameEl) nameEl.textContent = "Member of the Banana Grove since " + user.createdAt.slice(0, 10);

    const s = user.summary;
    $("profile-summary").innerHTML =
      statCard("🏆 Peak High Score", s.highScore) +
      statCard("⭐ Lifetime Points", s.totalScore || 0) +
      statCard("🔥 Longest Streak", s.bestStreak) +
      statCard("🎯 Total Played", s.played) +
      statCard("📈 Accuracy Rate", s.accuracy + "%");

    const modes = ["classic", "timed", "survival"];
    $("profile-rows").innerHTML = modes
      .map((mode) => {
        const b = user.stats[mode] || { highScore: 0, bestStreak: 0, played: 0, correct: 0 };
        const acc = b.played === 0 ? 0 : Math.round((b.correct / b.played) * 100);
        const modeEmoji = mode === "classic" ? "🍌 Classic" : mode === "timed" ? "⏱️ Timed" : "🛡️ Survival";
        return (
          "<tr>" +
          "<td><strong>" + modeEmoji + "</strong></td>" +
          "<td>" + b.highScore + " pts</td>" +
          "<td>" + b.bestStreak + " in a row</td>" +
          "<td>" + b.played + "</td>" +
          "<td>" + acc + "%</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function statCard(label, value) {
    return (
      "<div class=\"stat-card\">" +
      "<span class=\"hud-label\">" + label + "</span>" +
      "<strong>" + value + "</strong>" +
      "</div>"
    );
  }

  // --- LEADERBOARD RENDERER ---
  async function loadBoard() {
    const mode = state.boardMode || "classic";

    // Update active tab appearance
    document.querySelectorAll(".board-tab-btn").forEach((btn) => {
      const active = btn.getAttribute("data-board-mode") === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    const selectEl = $("board-mode");
    if (selectEl) selectEl.value = mode;

    const { body } = await api("/api/leaderboard?mode=" + encodeURIComponent(mode), { method: "GET" });
    const rows = body.rows || [];

    $("board-empty").hidden = rows.length > 0;

    const medals = ["🥇", "🥈", "🥉"];
    const currentUsername = state.user ? state.user.username.toLowerCase() : "";

    $("board-rows").innerHTML = rows
      .map((row, i) => {
        const isSelf = row.username.toLowerCase() === currentUsername;
        const rankDisplay = i < 3 ? medals[i] : String(i + 1);
        const rankClass = i < 3 ? "rank-" + (i + 1) : "";

        return (
          "<tr class=\"" + (isSelf ? "highlight-user" : "") + "\">" +
          "<td><span class=\"rank-badge " + rankClass + "\">" + rankDisplay + "</span></td>" +
          "<td>" + escapeHtml(row.username) + (isSelf ? " <span class=\"you-badge\">(You)</span>" : "") + "</td>" +
          "<td><strong>" + row.highScore + "</strong></td>" +
          "<td>" + row.bestStreak + "</td>" +
          "<td>" + row.accuracy + "%</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // --- ROUTE HANDLER ---
  async function route() {
    await refreshUser();
    const view = guardAuthViews(currentView());
    showView(view);

    if (view === "profile" && state.user) {
      const { body } = await api("/api/profile", { method: "GET" });
      if (body.user) {
        renderProfile(body.user);
      }
    }

    if (view === "board") {
      await loadBoard();
    }

    if (view !== "play") {
      stopTimer();
      if (state.autoAdvanceTimer) {
        window.clearTimeout(state.autoAdvanceTimer);
        state.autoAdvanceTimer = null;
      }
    }
  }

  // --- DOM EVENT LISTENERS [THEME: EVENT-DRIVEN PROGRAMMING] ---

  window.addEventListener("hashchange", route);

  // Mode picker buttons
  document.addEventListener("click", (event) => {
    const startBtn = event.target.closest("[data-start]");
    if (startBtn) {
      startMode(startBtn.getAttribute("data-start"));
    }

    // Leaderboard tab clicks
    const tabBtn = event.target.closest("[data-board-mode]");
    if (tabBtn) {
      state.boardMode = tabBtn.getAttribute("data-board-mode");
      loadBoard();
    }
  });

  // On-screen number pad clicks
  $("numpad").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-digit]");
    if (!btn || btn.disabled) return;
    audio.click();
    submitAnswer(Number(btn.getAttribute("data-digit")));
  });

  // Physical keyboard support: Digits 0-9, Numpad 0-9, Enter to advance
  document.addEventListener("keydown", (event) => {
    const view = currentView();
    if (view !== "play" || $("play-table").hidden) {
      return;
    }

    // Don't intercept if an input or form field has focus
    if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      return;
    }

    // Check for digits 0-9
    let digit = null;
    if (event.key >= "0" && event.key <= "9") {
      digit = Number(event.key);
    } else if (event.code && event.code.startsWith("Numpad") && !isNaN(Number(event.code.slice(6)))) {
      digit = Number(event.code.slice(6));
    }

    if (digit !== null) {
      event.preventDefault();

      // Tactile visual feedback on matching button
      const btn = document.querySelector("#numpad button[data-digit=\"" + digit + "\"]");
      if (btn && !btn.disabled) {
        btn.classList.add("active-press");
        window.setTimeout(() => btn.classList.remove("active-press"), 150);
      }

      audio.click();
      submitAnswer(digit);
      return;
    }

    // Enter / Space to advance to next puzzle if feedback is showing
    if ((event.key === "Enter" || event.key === " ") && !$("next-puzzle").hidden) {
      event.preventDefault();
      loadPuzzle();
    }
  });

  // Login form submission
  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormError("login-error", "");
    const form = new FormData(event.target);
    const btn = $("login-submit-btn");
    btn.disabled = true;

    const { ok, body } = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password")
      })
    });

    btn.disabled = false;

    if (!ok) {
      setFormError("login-error", body.message || "Invalid username or password.");
      return;
    }

    state.user = body.user;
    showToast("Welcome back, " + state.user.username + "!");
    location.hash = "#/play";
  });

  // Registration form submission
  $("register-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormError("register-error", "");
    const form = new FormData(event.target);
    const btn = $("register-submit-btn");
    btn.disabled = true;

    const { ok, body } = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password")
      })
    });

    btn.disabled = false;

    if (!ok) {
      setFormError("register-error", body.message || "Could not register account.");
      return;
    }

    state.user = body.user;
    showToast("Account created! Welcome to Banana Game, " + state.user.username + "!");
    location.hash = "#/play";
  });

  // Logout action
  $("logout-btn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    state.user = null;
    state.game = null;
    showToast("Logged out successfully.");
    location.hash = "#/";
    renderAuthChrome();
  });

  // In-game buttons
  $("retry-puzzle").addEventListener("click", loadPuzzle);
  $("next-puzzle").addEventListener("click", loadPuzzle);

  $("end-run").addEventListener("click", () => {
    stopTimer();
    if (state.autoAdvanceTimer) {
      window.clearTimeout(state.autoAdvanceTimer);
      state.autoAdvanceTimer = null;
    }
    state.game = null;
    $("play-table").hidden = true;
    $("run-over").hidden = true;
    $("mode-picker").hidden = false;
  });

  $("play-again").addEventListener("click", () => startMode(state.lastMode));
  $("run-change-mode").addEventListener("click", () => {
    $("run-over").hidden = true;
    $("play-table").hidden = true;
    $("mode-picker").hidden = false;
  });

  // Select dropdown fallback for leaderboard
  $("board-mode").addEventListener("change", (e) => {
    state.boardMode = e.target.value;
    loadBoard();
  });

  // Mute toggle
  $("mute-btn").addEventListener("click", () => setMuted(!state.muted));

  // --- CUSTOM BUS LISTENERS [THEME: EVENT-DRIVEN PROGRAMMING] ---

  bus.addEventListener("puzzle:loaded", () => {
    $("feedback").textContent = "One attempt. Type or tap a digit.";
    $("feedback").className = "feedback";
    $("feedback-points").hidden = true;
  });

  bus.addEventListener("answer:result", (event) => {
    const detail = event.detail;
    const frame = $("puzzle-frame");
    frame.classList.remove("pop", "shake");

    const ok = detail.correct;
    $("feedback").className = "feedback " + (ok ? "ok" : "bad");

    const pointsEl = $("feedback-points");
    if (ok) {
      pointsEl.hidden = false;
      pointsEl.textContent = "+" + detail.points + " pts";
      $("feedback").textContent =
        "🎉 Correct! The answer was " + detail.solution + ". Streak: " + detail.game.streak + "!";
      audio.correct(detail.game.combo);
    } else {
      pointsEl.hidden = true;
      $("feedback").textContent =
        "❌ Incorrect. The solution was " + detail.solution + ". Streak reset.";
      audio.wrong();
    }

    void frame.offsetWidth; // Force CSS reflow for animation restart
    frame.classList.add(ok ? "pop" : "shake");
  });

  bus.addEventListener("game:over", (event) => {
    stopTimer();
    setPadEnabled(false);
    $("play-table").hidden = false;
    $("run-over").hidden = false;

    const game = event.detail.game;
    const alertEl = $("run-over-high-alert");
    if (alertEl) alertEl.hidden = true;

    $("run-over-text").textContent =
      "Final score " + game.score + " points in " + game.mode.toUpperCase() +
      " mode. Best streak achieved this run: " + game.streak + ".";

    audio.gameOver();
  });

  bus.addEventListener("session:expired", () => {
    state.user = null;
    showToast("Your session has expired. Please log in again.");
    location.hash = "#/login";
  });

  bus.addEventListener("timer:ended", async (event) => {
    if (!state.game || state.busy) return;

    if (state.game.mode === "timed") {
      state.game.over = true;
      emit("game:over", { game: state.game });
      return;
    }

    if (state.game.mode === "survival" && state.game.awaitingAnswer) {
      showToast("Time expired for this puzzle!");
      await submitAnswer(null, { timeout: true });
    }
  });

  // --- INITIALIZATION ---
  setMuted(state.muted);
  route();
})();
