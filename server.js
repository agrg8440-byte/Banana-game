/**
 * Generated with AI assistance for CIS046-3 Software For Enterprise - Banana Game.
 *
 * Express Application & HTTP Routing Architecture.
 *
 * [THEME: VERSION CONTROL]
 * Recommended Git Branching Plan:
 *   main            — production-ready, graded assignment submission
 *   feature/auth    — registration, login, logout, password hashing, session state
 *   feature/game    — Banana API integration, scoring rules, 3 game modes
 *   feature/ui      — accessible HTML5, responsive CSS3, event-driven client JS
 *   See README.md for the step-by-step merge schedule and commit guidelines.
 *
 * [THEME: EVENT-DRIVEN PROGRAMMING]
 * Node.js asynchronous event loop and Express middleware pipeline.
 * Requests trigger event-driven middleware chains (json parsing, session resolution,
 * route dispatching, and asynchronous I/O handlers).
 */

const path = require("path");
const express = require("express");
const session = require("express-session");
const auth = require("./src/auth");
const bananaApi = require("./src/bananaApi");
const userStore = require("./src/userStore");
const game = require("./src/game");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: false }));

// [THEME: VIRTUAL IDENTITY]
// httpOnly prevents client-side script from accessing session cookies (XSS mitigation).
// sameSite="lax" guards against Cross-Site Request Forgery (CSRF).
// secure cookie flag is dynamically set for production HTTPS environments.
app.use(
  session({
    name: "banana.sid",
    secret: process.env.SESSION_SECRET || "banana-game-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function clearPuzzle(req) {
  if (req.session) {
    req.session.puzzleSolution = undefined;
  }
}

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  const user = await userStore.findById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }
  return res.json({ user: userStore.publicProfile(user) });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const result = await auth.register(req.body.username, req.body.password);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ message: "Could not start a session." });
      }
      req.session.userId = result.user.id;
      req.session.username = result.user.username;
      return res.status(201).json({ user: userStore.publicProfile(result.user) });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Registration failed. Please try again." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const result = await auth.login(req.body.username, req.body.password);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    // VIRTUAL IDENTITY: new session id after login so an old anonymous
    // cookie cannot be reused as the logged-in player.
    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ message: "Could not start a session." });
      }
      req.session.userId = result.user.id;
      req.session.username = result.user.username;
      return res.json({ user: userStore.publicProfile(result.user) });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Login failed. Please try again." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie("banana.sid");
    if (err) {
      return res.status(500).json({ message: "Could not log out." });
    }
    return res.json({ ok: true });
  });
});

app.post("/api/game/start", auth.requireAuth, (req, res) => {
  const mode = req.body && req.body.mode;
  if (!game.isMode(mode)) {
    return res.status(400).json({ message: "Choose classic, timed, or survival." });
  }
  req.session.game = game.startGame(mode);
  clearPuzzle(req);
  return res.json({ game: game.snapshot(req.session.game) });
});

app.get("/api/game/puzzle", auth.requireAuth, async (req, res) => {
  const state = req.session.game;
  if (!state || state.over) {
    return res.status(400).json({
      error: "no_run",
      message: "Start a game mode before asking for a puzzle."
    });
  }
  if (state.mode === "timed" && game.snapshot(state).timer.remainingMs <= 0) {
    state.over = true;
    return res.json({ game: game.snapshot(state), over: true });
  }

  // [THEME: INTEROPERABILITY]
  // The server acts as a secure intermediary (BFF - Backend For Frontend):
  // 1. Fetches puzzle from third-party HTTPS Banana API with an 8s timeout.
  // 2. Stores the secret solution in req.session (server-side only).
  // 3. Emits only the public image URL to the browser, making client-side tampering impossible.
  try {
    const puzzle = await bananaApi.fetchPuzzle();
    req.session.puzzleSolution = puzzle.solution;
    const timer = game.markPuzzleReady(state);
    return res.json({
      image: puzzle.image,
      game: game.snapshot(state),
      timer
    });
  } catch (err) {
    clearPuzzle(req);
    return res.status(503).json({
      error: "api_down",
      message: "The banana grove is busy. We could not fetch a puzzle. Please retry."
    });
  }
});

// [THEME: VIRTUAL IDENTITY & EVENT-DRIVEN PROGRAMMING]
// Verifies user's single attempt against session-stored solution, records persistent statistics
// to the user store, and clears the puzzle solution to prevent replay attacks.
app.post("/api/game/answer", auth.requireAuth, async (req, res) => {
  const state = req.session.game;
  if (!state) {
    return res.status(400).json({
      error: "no_run",
      message: "Start a game first."
    });
  }

  const solution = req.session.puzzleSolution;
  if (solution === undefined || !state.awaitingAnswer) {
    return res.status(400).json({
      error: "no_puzzle",
      message: "There is no open puzzle. Load a new one."
    });
  }

  const timedOut = Boolean(req.body && req.body.timeout);
  const guess = timedOut ? null : Number(req.body && req.body.answer);
  if (!timedOut && (!Number.isInteger(guess) || guess < 0 || guess > 9)) {
    return res.status(400).json({ message: "Answer must be a digit from 0 to 9." });
  }

  const isCorrect = !timedOut && guess === solution;
  const result = game.applyAnswer(state, isCorrect);
  clearPuzzle(req);

  const user = await userStore.recordAnswer(req.session.userId, state.mode, {
    correct: result.correct === true,
    runScore: state.score,
    streak: state.streak,
    points: result.points
  });

  return res.json({
    correct: result.correct === true,
    solution,
    guess,
    points: result.points,
    reason: result.reason,
    game: game.snapshot(state),
    stats: user ? userStore.publicProfile(user).stats : null
  });
});

app.get("/api/profile", auth.requireAuth, async (req, res) => {
  const user = await userStore.findById(req.session.userId);
  if (!user) {
    return res.status(401).json({
      error: "session_expired",
      message: "Your session has expired. Please log in again."
    });
  }
  return res.json({ user: userStore.publicProfile(user) });
});

app.get("/api/leaderboard", async (req, res) => {
  const mode = req.query.mode || "classic";
  if (!game.isMode(mode)) {
    return res.status(400).json({ message: "Unknown mode." });
  }
  const rows = await userStore.leaderboard(mode);
  return res.json({ mode, rows });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return next();
  }
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = app.listen(PORT, () => {
  console.log("Banana Game running at http://localhost:" + server.address().port);
});

const fallbackPorts = Number(PORT) === 3000 ? [3001, 0] : [0];
let attemptedPort = PORT;

server.on("error", (err) => {
  if (err.code !== "EADDRINUSE") {
    throw err;
  }

  const fallbackPort = fallbackPorts.shift();
  if (fallbackPort === undefined) {
    throw err;
  }

  console.warn(
    "Port " + attemptedPort + " is already in use. Trying " +
      (fallbackPort === 0 ? "an available port." : "port " + fallbackPort + ".")
  );
  attemptedPort = fallbackPort;
  server.listen(fallbackPort);
});
