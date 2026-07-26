import Constants from "expo-constants";
import { Platform } from "react-native";

/*
 * Resolves the backend base URL for every environment the app ships in.
 *
 * Precedence (first match wins):
 *   1. MANUAL_OVERRIDE      — hardcoded dev escape hatch, see below.
 *   2. EXPO_PUBLIC_API_URL  — env var, inlined into the bundle at build time
 *                             (Expo SDK 49+). Set it in `.env`, an EAS build
 *                             profile's `env` block, or the shell.
 *   3. expo.extra.apiUrl    — from app.json, readable via
 *                             Constants.expoConfig.extra.apiUrl.
 *   4. Metro `hostUri`      — DEV ONLY. Expo Go / dev-client report the
 *                             dev-machine LAN IP, so a physical device reaches
 *                             the Django server with zero configuration.
 *   5. Loopback             — DEV ONLY. Android emulator 10.0.2.2, else
 *                             localhost.
 *
 * A release build has no `hostUri`, so steps 4/5 are unavailable: it MUST be
 * given an explicit `https://` URL. Anything else (missing, or plaintext
 * `http://`, which iOS ATS and Android `usesCleartextTraffic=false` block on
 * modern target SDKs) is reported as a configuration error instead of silently
 * falling back to an unreachable localhost.
 */

// Port the Django dev server listens on.
const DJANGO_PORT = 8000;

// Set this to a fixed URL (e.g. "http://192.168.1.50:8000") to override
// everything below. Useful for physical devices on a different network or when
// pointing a dev build at a deployed backend. Leave null for normal use.
const MANUAL_OVERRIDE = null;

const ABSOLUTE_URL = /^https?:\/\//i;
const HTTPS_URL = /^https:\/\//i;

// Metro exposes the dev-machine host (LAN IP) during development only.
export function metroHostUri() {
  return (
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest2?.extra?.expoGo?.debuggerHost ||
    null
  );
}

function trimUrl(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

/**
 * Pure resolver — every input is injectable so the precedence rules are
 * testable without touching the real environment.
 *
 * @returns {{ baseUrl: string|null, error: string|null, source: string }}
 */
export function resolveApiConfig({
  manualOverride = MANUAL_OVERRIDE,
  envUrl = process.env.EXPO_PUBLIC_API_URL,
  extraUrl = Constants.expoConfig?.extra?.apiUrl,
  hostUri = metroHostUri(),
  dev = typeof __DEV__ !== "undefined" ? __DEV__ : false,
  platformOS = Platform.OS,
} = {}) {
  const candidates = [
    ["MANUAL_OVERRIDE", manualOverride],
    ["EXPO_PUBLIC_API_URL", envUrl],
    ["expo.extra.apiUrl", extraUrl],
  ];

  for (const [source, raw] of candidates) {
    const baseUrl = trimUrl(raw);
    if (!baseUrl) continue;

    if (!ABSOLUTE_URL.test(baseUrl)) {
      return {
        baseUrl: null,
        source,
        error:
          `Invalid API URL from ${source}: "${baseUrl}". ` +
          `It must be an absolute URL starting with https:// (or http:// in development).`,
      };
    }
    if (!dev && !HTTPS_URL.test(baseUrl)) {
      return {
        baseUrl,
        source,
        error:
          `Insecure API URL from ${source}: "${baseUrl}". ` +
          `Release builds must use https:// — plaintext HTTP is blocked by iOS App Transport ` +
          `Security and by Android's default usesCleartextTraffic=false (targetSdk >= 28), ` +
          `so every request would fail.`,
      };
    }
    return { baseUrl, source, error: null };
  }

  // Nothing configured. Development can auto-detect; a release build cannot.
  if (dev) {
    const host = hostUri ? String(hostUri).split(":")[0] : null;
    if (host) {
      return {
        baseUrl: `http://${host}:${DJANGO_PORT}`,
        source: "metro-hostUri",
        error: null,
      };
    }
    // Android emulator maps 10.0.2.2 -> host loopback; iOS sim uses localhost.
    const loopback = platformOS === "android" ? "10.0.2.2" : "localhost";
    return {
      baseUrl: `http://${loopback}:${DJANGO_PORT}`,
      source: "loopback",
      error: null,
    };
  }

  return {
    baseUrl: null,
    source: "unconfigured",
    error:
      "No API URL configured for this build. Metro host auto-detection only works in " +
      "development, so a release build needs an explicit https:// backend URL: set " +
      "EXPO_PUBLIC_API_URL (see mobile/.env.example or the EAS build profile's env block) " +
      "or expo.extra.apiUrl in mobile/app.json.",
  };
}

const resolved = resolveApiConfig();

export const API_BASE_URL = resolved.baseUrl;
export const API_URL_SOURCE = resolved.source;
export const API_CONFIG_ERROR = resolved.error;

if (API_CONFIG_ERROR) {
  // Loud on purpose: this is the difference between "app works" and "every
  // request fails with an opaque network error".
  console.error(`[api/config] ${API_CONFIG_ERROR}`);
}

/**
 * Throws if the app has no usable backend URL, so the failure surfaces in the
 * UI's normal error path instead of as a mystery network timeout.
 */
export function assertApiConfigured() {
  if (API_CONFIG_ERROR) throw new Error(API_CONFIG_ERROR);
  if (!API_BASE_URL) throw new Error("API base URL is not configured.");
}
