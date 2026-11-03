/**
 * Generated with AI assistance for CIS046-3 Software For Enterprise - Banana Game.
 *
 * [THEME: VIRTUAL IDENTITY]
 * Data Access Layer (Repository Pattern):
 * - Isolates persistent user profiles, bcrypt password hashes, and gameplay statistics.
 * - Thread-safe atomic file writing (writeChain promise queue + temporary file rename)
 *   to eliminate race conditions and file corruption.
 * - Fully abstracted async interface (findById, findByUsername, createUser, recordAnswer,
 *   leaderboard) allowing seamless future migration to MongoDB, PostgreSQL, or SQLite.
 */

const fs = require("fs/promises");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "users.json");

/** Simple queue so two requests cannot corrupt the JSON file. */
let writeChain = Promise.resolve();

function emptyStats() {
  return {
    highScore: 0,
    totalScore: 0,
    bestStreak: 0,
    played: 0,
    correct: 0
  };
}

function defaultUserStats() {
  return {
    classic: emptyStats(),
    timed: emptyStats(),
    survival: emptyStats()
  };
}

async function ensureFile() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ users: [] }, null, 2), "utf8");
  }
}

async function readAll() {
  await ensureFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.users || !Array.isArray(parsed.users)) {
      return { users: [] };
    }
    return parsed;
  } catch {
    return { users: [] };
  }
}

async function writeAll(data) {
  writeChain = writeChain.then(async () => {
    const tmp = DATA_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, DATA_FILE);
  }).catch((err) => {
    console.error("userStore write failed:", err.message);
  });
  return writeChain;
}

async function findByUsername(username) {
  const data = await readAll();
  const key = username.toLowerCase();
  return data.users.find((user) => user.username.toLowerCase() === key) || null;
}

async function findById(id) {
  const data = await readAll();
  return data.users.find((user) => user.id === id) || null;
}

async function createUser({ username, passwordHash }) {
  const data = await readAll();
  const user = {
    id: "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    username,
    passwordHash,
    createdAt: new Date().toISOString(),
    stats: defaultUserStats()
  };
  data.users.push(user);
  await writeAll(data);
  return user;
}

/**
 * [THEME: VIRTUAL IDENTITY]
 * Apply one answered puzzle to the player's persistent stats.
 * - highScore: peak single-run score for leaderboard ranking
 * - bestStreak: longest consecutive correct answers streak
 * - played / correct: total attempts and successes for accuracy calculations
 * - totalScore: lifetime accumulated points across games
 */
async function recordAnswer(userId, mode, { correct, runScore, streak, points }) {
  const data = await readAll();
  const user = data.users.find((entry) => entry.id === userId);
  if (!user) {
    return null;
  }
  if (!user.stats) {
    user.stats = defaultUserStats();
  }
  if (!user.stats[mode]) {
    user.stats[mode] = emptyStats();
  }

  const bucket = user.stats[mode];
  bucket.played += 1;
  if (correct) {
    bucket.correct += 1;
  }
  bucket.totalScore += (Number.isFinite(points) ? points : (correct ? 10 : 0));
  if (runScore > bucket.highScore) {
    bucket.highScore = runScore;
  }
  if (streak > bucket.bestStreak) {
    bucket.bestStreak = streak;
  }

  await writeAll(data);
  return user;
}

function publicProfile(user) {
  if (!user) {
    return null;
  }
  const stats = user.stats || defaultUserStats();
  const modes = ["classic", "timed", "survival"];
  const summary = {
    highScore: 0,
    totalScore: 0,
    bestStreak: 0,
    played: 0,
    correct: 0
  };

  modes.forEach((mode) => {
    const bucket = stats[mode] || emptyStats();
    summary.highScore = Math.max(summary.highScore, bucket.highScore);
    summary.totalScore += (bucket.totalScore || 0);
    summary.bestStreak = Math.max(summary.bestStreak, bucket.bestStreak);
    summary.played += bucket.played;
    summary.correct += bucket.correct;
  });

  const accuracy = summary.played === 0 ? 0 : Math.round((summary.correct / summary.played) * 100);

  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    stats,
    summary: {
      ...summary,
      accuracy
    }
  };
}

function leaderboard(mode) {
  return readAll().then((data) => {
    const rows = data.users.map((user) => {
      const bucket = (user.stats && user.stats[mode]) || emptyStats();
      const accuracy = bucket.played === 0 ? 0 : Math.round((bucket.correct / bucket.played) * 100);
      return {
        username: user.username,
        highScore: bucket.highScore,
        bestStreak: bucket.bestStreak,
        played: bucket.played,
        accuracy
      };
    });

    return rows
      .filter((row) => row.played > 0)
      .sort((a, b) => {
        if (b.highScore !== a.highScore) {
          return b.highScore - a.highScore;
        }
        if (b.bestStreak !== a.bestStreak) {
          return b.bestStreak - a.bestStreak;
        }
        return b.accuracy - a.accuracy;
      })
      .slice(0, 10);
  });
}

module.exports = {
  findByUsername,
  findById,
  createUser,
  recordAnswer,
  publicProfile,
  leaderboard,
  emptyStats
};
