/**
 * Generated with AI assistance for CIS046-3 Software For Enterprise - Banana Game.
 *
 * [THEME: VIRTUAL IDENTITY]
 * Player Identity & Authentication Service:
 * - Passwords hashed securely using bcrypt (10 salt rounds).
 * - Generic error messages prevent username enumeration attacks.
 * - Constant-time comparison dummy mitigation guards against timing side-channels.
 * - Strict server-side credential validation (3-20 char alphanumeric username, 8+ char password).
 * - Middleware authorization guard (requireAuth).
 */

const bcrypt = require("bcryptjs");
const userStore = require("./userStore");

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
const GENERIC_LOGIN_ERROR = "Invalid username or password.";

function validateCredentials(username, password) {
  const errors = [];
  if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
    errors.push("Username must be 3–20 letters, numbers, or underscores.");
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 72) {
    errors.push("Password must be between 8 and 72 characters.");
  }
  return errors;
}

async function register(username, password) {
  const errors = validateCredentials(username, password);
  if (errors.length > 0) {
    return { ok: false, status: 400, message: errors[0] };
  }

  const existing = await userStore.findByUsername(username);
  if (existing) {
    return { ok: false, status: 409, message: "That username is already taken." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userStore.createUser({ username, passwordHash });
  return { ok: true, user };
}

async function login(username, password) {
  if (typeof username !== "string" || typeof password !== "string") {
    return { ok: false, status: 401, message: GENERIC_LOGIN_ERROR };
  }

  const user = await userStore.findByUsername(username);
  // Always hash something so timing is closer when the user does not exist.
  const hash = user ? user.passwordHash : "$2a$10$invalidhashplaceholderxxxxxxxxxxxxxxxxxxxxxxx";
  const match = await bcrypt.compare(password, hash);

  if (!user || !match) {
    return { ok: false, status: 401, message: GENERIC_LOGIN_ERROR };
  }

  return { ok: true, user };
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      error: "session_expired",
      message: "Your session has expired. Please log in again."
    });
  }
  return next();
}

module.exports = {
  register,
  login,
  requireAuth,
  validateCredentials
};
