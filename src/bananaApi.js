/**
 * Generated with AI assistance for CIS046-3 Software For Enterprise - Banana Game.
 *
 * [THEME: INTEROPERABILITY]
 * External HTTPS REST Integration Service:
 * - Calls the third-party Banana API over HTTPS with an 8000ms timeout using AbortController.
 * - Parses and rigorously validates the incoming JSON response schema.
 * - Decouples external network latency and failure from game client logic.
 * - Keeps solution isolated on the server to preserve game integrity.
 */

const BANANA_URL = "https://marcconrad.com/uob/banana/api.php?out=json";
const TIMEOUT_MS = 8000;

async function fetchPuzzle() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(BANANA_URL, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error("Banana API returned HTTP " + response.status);
    }

    const data = await response.json();
    if (!data || typeof data.question !== "string" || data.solution === undefined) {
      throw new Error("Banana API returned an unexpected JSON shape");
    }

    const solution = Number(data.solution);
    if (!Number.isInteger(solution) || solution < 0 || solution > 9) {
      throw new Error("Banana API solution was not a single digit");
    }

    return {
      image: data.question,
      solution
    };
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutError = new Error("The Banana API timed out after 8 seconds.");
      timeoutError.code = "TIMEOUT";
      throw timeoutError;
    }
    const wrap = new Error(err.message || "Could not load a puzzle from the Banana API.");
    wrap.code = "API_FAIL";
    throw wrap;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  fetchPuzzle,
  BANANA_URL,
  TIMEOUT_MS
};
