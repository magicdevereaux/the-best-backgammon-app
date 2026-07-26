/*
 * Single source of truth for the API origin used by every request the web
 * client makes.
 *
 * Resolution:
 *   REACT_APP_API_BASE_URL unset / empty  -> ""  (root-relative requests, which
 *       is what the Create React App dev proxy in package.json expects)
 *   REACT_APP_API_BASE_URL set            -> that value with any trailing
 *       slashes stripped, so `https://api.example.com/` and
 *       `https://api.example.com` behave identically.
 *
 * Note: `process.env.REACT_APP_API_BASE_URL` must be written out in full for
 * CRA's build-time substitution to find it — do not destructure `process.env`.
 */

/**
 * Strip trailing slashes and surrounding whitespace from a base URL.
 * Returns "" for anything falsy so callers fall back to root-relative paths.
 */
export function normalizeBaseUrl(raw) {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

export const API_BASE_URL = normalizeBaseUrl(process.env.REACT_APP_API_BASE_URL);

/**
 * Join the configured base with a root-relative API path.
 * Absolute URLs are passed through untouched.
 */
export function apiUrl(path = "") {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path;
  if (!API_BASE_URL) return path;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return API_BASE_URL + suffix;
}
