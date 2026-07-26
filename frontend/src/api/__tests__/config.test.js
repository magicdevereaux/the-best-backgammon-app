import { normalizeBaseUrl } from "../config";

/*
 * Tests for the API base-URL resolution (frontend/src/api/config.js).
 *
 * The env-driven cases reload the module with a mutated process.env, because
 * API_BASE_URL is resolved once at module load (mirroring CRA's build-time
 * inlining of REACT_APP_* variables).
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=config
 */

const ORIGINAL_ENV = process.env.REACT_APP_API_BASE_URL;

function loadConfigWith(value) {
  let mod;
  jest.isolateModules(() => {
    if (value === undefined) {
      delete process.env.REACT_APP_API_BASE_URL;
    } else {
      process.env.REACT_APP_API_BASE_URL = value;
    }
    // eslint-disable-next-line global-require
    mod = require("../config");
  });
  return mod;
}

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.REACT_APP_API_BASE_URL;
  } else {
    process.env.REACT_APP_API_BASE_URL = ORIGINAL_ENV;
  }
});

// ---------------------------------------------------------------------------
// normalizeBaseUrl
// ---------------------------------------------------------------------------

describe("normalizeBaseUrl()", () => {
  test("returns an empty string for undefined, null and empty input", () => {
    expect(normalizeBaseUrl(undefined)).toBe("");
    expect(normalizeBaseUrl(null)).toBe("");
    expect(normalizeBaseUrl("")).toBe("");
    expect(normalizeBaseUrl("   ")).toBe("");
  });

  test("passes a clean origin through unchanged", () => {
    expect(normalizeBaseUrl("https://api.example.com")).toBe("https://api.example.com");
  });

  test("strips a single trailing slash", () => {
    expect(normalizeBaseUrl("https://api.example.com/")).toBe("https://api.example.com");
  });

  test("strips repeated trailing slashes", () => {
    expect(normalizeBaseUrl("https://api.example.com///")).toBe("https://api.example.com");
  });

  test("keeps a sub-path but drops its trailing slash", () => {
    expect(normalizeBaseUrl("https://example.com/backend/")).toBe("https://example.com/backend");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeBaseUrl("  https://api.example.com/  ")).toBe("https://api.example.com");
  });
});

// ---------------------------------------------------------------------------
// API_BASE_URL / apiUrl
// ---------------------------------------------------------------------------

describe("API_BASE_URL resolution", () => {
  test("defaults to an empty string when REACT_APP_API_BASE_URL is unset", () => {
    const { API_BASE_URL } = loadConfigWith(undefined);
    expect(API_BASE_URL).toBe("");
  });

  test("is an empty string when the variable is set but blank", () => {
    const { API_BASE_URL } = loadConfigWith("");
    expect(API_BASE_URL).toBe("");
  });

  test("uses an explicitly configured value", () => {
    const { API_BASE_URL } = loadConfigWith("https://api.example.com");
    expect(API_BASE_URL).toBe("https://api.example.com");
  });

  test("normalises a trailing slash on the configured value", () => {
    const { API_BASE_URL } = loadConfigWith("https://api.example.com/");
    expect(API_BASE_URL).toBe("https://api.example.com");
  });
});

describe("apiUrl()", () => {
  test("leaves paths root-relative when no base is configured (dev-proxy behaviour)", () => {
    const { apiUrl } = loadConfigWith(undefined);
    expect(apiUrl("/api/games/")).toBe("/api/games/");
    expect(apiUrl("/api/auth/login/")).toBe("/api/auth/login/");
  });

  test("prefixes the configured base", () => {
    const { apiUrl } = loadConfigWith("https://api.example.com");
    expect(apiUrl("/api/games/")).toBe("https://api.example.com/api/games/");
  });

  test("never produces a double slash when the base has a trailing slash", () => {
    const { apiUrl } = loadConfigWith("https://api.example.com/");
    const url = apiUrl("/api/games/1/roll_dice/");
    expect(url).toBe("https://api.example.com/api/games/1/roll_dice/");
    expect(url).not.toMatch(/[^:]\/\//);
  });

  test("still joins correctly when the path lacks a leading slash", () => {
    const { apiUrl } = loadConfigWith("https://api.example.com");
    expect(apiUrl("api/games/")).toBe("https://api.example.com/api/games/");
  });

  test("preserves query strings", () => {
    const { apiUrl } = loadConfigWith("https://api.example.com/");
    expect(apiUrl("/api/games/?status=waiting")).toBe(
      "https://api.example.com/api/games/?status=waiting"
    );
  });

  test("passes absolute URLs through untouched", () => {
    const { apiUrl } = loadConfigWith("https://api.example.com");
    expect(apiUrl("https://other.example.org/api/games/")).toBe(
      "https://other.example.org/api/games/"
    );
  });
});

// ---------------------------------------------------------------------------
// Wiring: the API modules must go through the configured base
// ---------------------------------------------------------------------------

describe("API modules honour the configured base", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
  });

  function mockOk(body) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }

  test("request() prefixes the base with no double slash", async () => {
    let request;
    jest.isolateModules(() => {
      process.env.REACT_APP_API_BASE_URL = "https://api.example.com/";
      // eslint-disable-next-line global-require
      ({ request } = require("../apiClient"));
    });
    global.fetch = jest.fn().mockReturnValueOnce(mockOk([]));
    await request("/api/games/");
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.example.com/api/games/");
  });

  test("authApi endpoints are prefixed with the base", async () => {
    let login;
    jest.isolateModules(() => {
      process.env.REACT_APP_API_BASE_URL = "https://api.example.com/";
      // eslint-disable-next-line global-require
      ({ login } = require("../authApi"));
    });
    global.fetch = jest
      .fn()
      .mockReturnValueOnce(mockOk({ access: "a", refresh: "r" }))
      .mockReturnValueOnce(mockOk({ username: "alice" }));
    await login("alice", "securepass123");
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.example.com/api/auth/login/");
    expect(global.fetch.mock.calls[1][0]).toBe("https://api.example.com/api/auth/me/");
  });

  test("request() keeps paths root-relative when no base is set", async () => {
    let request;
    jest.isolateModules(() => {
      delete process.env.REACT_APP_API_BASE_URL;
      // eslint-disable-next-line global-require
      ({ request } = require("../apiClient"));
    });
    global.fetch = jest.fn().mockReturnValueOnce(mockOk([]));
    await request("/api/games/");
    expect(global.fetch.mock.calls[0][0]).toBe("/api/games/");
  });
});
