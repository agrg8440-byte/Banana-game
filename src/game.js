/**
 * Generated with AI assistance for CIS046-3 Software For Enterprise - Banana Game.
 *
 * Game Rules & Domain Logic Engine:
 * 1. Classic Mode: Unlimited puzzles, 10 points each, build a streak.
 * 2. Timed Mode: 60-second speedrun, combo multiplier (up to 8x) for consecutive correct answers.
 * 3. Survival Mode: 3 lives, shrinking puzzle deadline (18s down to 5s as score climbs).
 *
 * [THEME: EVENT-DRIVEN PROGRAMMING]
 * Manages game state transitions, timer snapshots, single-attempt verification, and scoring.
 */

const MODES = ["classic", "timed", "survival"];
const CLASSIC_POINTS = 10;
const TIMED_LIMIT_MS = 60 * 1000;
const SURVIVAL_LIVES = 3;

function isMode(mode) {
  return MODES.includes(mode);
}

function startGame(mode) {
  const now = Date.now();
  const state = {
    mode,
    score: 0,
    streak: 0,
    combo: 1,
    lives: mode === "survival" ? SURVIVAL_LIVES : null,
    startedAt: now,
    over: false,
    awaitingAnswer: false,
    puzzleDeadline: null
  };
  return state;
}

function survivalLimitMs(score) {
  // Starts at 18 seconds and never drops below 5 seconds.
  const shrink = Math.floor(score / 40) * 1500;
  return Math.max(5000, 18000 - shrink);
}

function timedRemainingMs(state) {
  return Math.max(0, TIMED_LIMIT_MS - (Date.now() - state.startedAt));
}

function markPuzzleReady(state) {
  state.awaitingAnswer = true;
  if (state.mode === "survival") {
    state.puzzleDeadline = Date.now() + survivalLimitMs(state.score);
  } else if (state.mode === "timed") {
    state.puzzleDeadline = state.startedAt + TIMED_LIMIT_MS;
  } else {
    state.puzzleDeadline = null;
  }
  return clientTimer(state);
}

function clientTimer(state) {
  if (state.mode === "timed") {
    return {
      kind: "round",
      remainingMs: timedRemainingMs(state),
      totalMs: TIMED_LIMIT_MS
    };
  }
  if (state.mode === "survival" && state.puzzleDeadline) {
    const total = survivalLimitMs(state.score);
    return {
      kind: "puzzle",
      remainingMs: Math.max(0, state.puzzleDeadline - Date.now()),
      totalMs: total
    };
  }
  return { kind: "none", remainingMs: null, totalMs: null };
}

function scoreCorrect(state) {
  if (state.mode === "timed") {
    const points = CLASSIC_POINTS * state.combo;
    state.score += points;
    state.streak += 1;
    state.combo = Math.min(8, state.combo + 1);
    return points;
  }

  state.score += CLASSIC_POINTS;
  state.streak += 1;
  state.combo = 1;
  return CLASSIC_POINTS;
}

function applyWrong(state) {
  state.streak = 0;
  state.combo = 1;
  if (state.mode === "survival") {
    state.lives -= 1;
    if (state.lives <= 0) {
      state.over = true;
    }
  }
}

function applyAnswer(state, isCorrect) {
  if (state.over) {
    return { points: 0, reason: "over" };
  }

  if (state.mode === "timed" && timedRemainingMs(state) <= 0) {
    state.over = true;
    state.awaitingAnswer = false;
    return { points: 0, reason: "time" };
  }

  if (state.mode === "survival" && state.puzzleDeadline && Date.now() > state.puzzleDeadline) {
    applyWrong(state);
    state.awaitingAnswer = false;
    return { points: 0, reason: "puzzle-time", correct: false };
  }

  state.awaitingAnswer = false;

  if (isCorrect) {
    const points = scoreCorrect(state);
    return { points, reason: "ok", correct: true };
  }

  applyWrong(state);
  return { points: 0, reason: "wrong", correct: false };
}

function snapshot(state) {
  return {
    mode: state.mode,
    score: state.score,
    streak: state.streak,
    combo: state.combo,
    lives: state.lives,
    over: state.over,
    awaitingAnswer: state.awaitingAnswer,
    timer: clientTimer(state)
  };
}

module.exports = {
  MODES,
  isMode,
  startGame,
  markPuzzleReady,
  applyAnswer,
  snapshot,
  survivalLimitMs,
  TIMED_LIMIT_MS
};
