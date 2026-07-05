import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  refreshAccessToken,
  register,
  login,
  fetchMe,
  logout,
} from "../authApi";

/*
 * Unit tests for the web auth API layer (frontend/src/api/authApi.js).
 *
 * fetch is mocked so no real network calls happen. localStorage is provided
 * by the jsdom test environment (react-scripts test).
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=authApi
 */

beforeEach(() => {
  global.fetch = jest.fn();
  localStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// Token storage helpers
// ---------------------------------------------------------------------------

describe("token storage helpers", () => {
  test("setTokens persists both access and refresh, getters read them back", () => {
    setTokens("access-abc", "refresh-xyz");
    expect(getAccessToken()).toBe("access-abc");
    expect(getRefreshToken()).toBe("refresh-xyz");
  });

  test("getAccessToken returns null when nothing stored", () => {
    expect(getAccessToken()).toBeNull();
  });

  test("clearTokens removes both tokens", () => {
    setTokens("a", "r");
    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

describe("register(username, password)", () => {
  test("POSTs to the register endpoint with a JSON body", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ user: { username: "alice" }, access: "a", refresh: "r" }, { status: 201 })
    );
    await register("alice", "securepass123");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/register\/$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ username: "alice", password: "securepass123" });
  });

  test("stores the returned tokens and returns the user object", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ user: { username: "alice" }, access: "acc", refresh: "ref" }, { status: 201 })
    );
    const user = await register("alice", "securepass123");
    expect(user).toEqual({ username: "alice" });
    expect(getAccessToken()).toBe("acc");
    expect(getRefreshToken()).toBe("ref");
  });

  test("surfaces the server's username error message", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ username: ["Username already taken."] }, { ok: false, status: 400 })
    );
    await expect(register("alice", "securepass123")).rejects.toThrow("Username already taken.");
  });

  test("surfaces the server's password error message", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ password: ["This password is too short."] }, { ok: false, status: 400 })
    );
    await expect(register("alice", "short")).rejects.toThrow("This password is too short.");
  });

  test("falls back to a generic message when the body has no field errors", async () => {
    fetch.mockReturnValueOnce(mockResponse({}, { ok: false, status: 500 }));
    await expect(register("alice", "securepass123")).rejects.toThrow("Registration failed.");
  });

  test("does not store tokens on a failed registration", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ username: ["taken"] }, { ok: false, status: 400 })
    );
    await expect(register("alice", "securepass123")).rejects.toThrow();
    expect(getAccessToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

describe("login(username, password)", () => {
  test("POSTs credentials, stores tokens, then fetches the user via /me/", async () => {
    fetch
      .mockReturnValueOnce(mockResponse({ access: "acc", refresh: "ref" }))
      .mockReturnValueOnce(mockResponse({ username: "alice", wins: 3 }));

    const user = await login("alice", "securepass123");

    expect(user).toEqual({ username: "alice", wins: 3 });
    expect(getAccessToken()).toBe("acc");

    const [loginUrl] = fetch.mock.calls[0];
    const [meUrl, meOptions] = fetch.mock.calls[1];
    expect(loginUrl).toMatch(/login\/$/);
    expect(meUrl).toMatch(/me\/$/);
    // /me/ must be called with the freshly-stored bearer token
    expect(meOptions.headers.Authorization).toBe("Bearer acc");
  });

  test("throws a friendly message and stores nothing on bad credentials", async () => {
    fetch.mockReturnValueOnce(mockResponse({ detail: "No active account" }, { ok: false, status: 401 }));
    await expect(login("alice", "wrong")).rejects.toThrow("Invalid username or password.");
    expect(getAccessToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchMe
// ---------------------------------------------------------------------------

describe("fetchMe()", () => {
  test("returns null without calling the network when no token is stored", async () => {
    const result = await fetchMe();
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("sends the bearer token and returns the user on success", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse({ username: "alice" }));
    const user = await fetchMe();
    expect(user).toEqual({ username: "alice" });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/me\/$/);
    expect(options.headers.Authorization).toBe("Bearer acc");
  });

  test("returns null (not throw) when the token is rejected", async () => {
    setTokens("stale", "ref");
    fetch.mockReturnValueOnce(mockResponse({}, { ok: false, status: 401 }));
    const user = await fetchMe();
    expect(user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------

describe("refreshAccessToken()", () => {
  test("returns null without a network call when no refresh token exists", async () => {
    const result = await refreshAccessToken();
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("posts the refresh token and stores + returns the new access token", async () => {
    setTokens("old-access", "the-refresh");
    fetch.mockReturnValueOnce(mockResponse({ access: "new-access" }));
    const token = await refreshAccessToken();
    expect(token).toBe("new-access");
    expect(getAccessToken()).toBe("new-access");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/refresh\/$/);
    expect(JSON.parse(options.body)).toEqual({ refresh: "the-refresh" });
  });

  test("clears tokens and returns null when the refresh token is expired", async () => {
    setTokens("old-access", "expired-refresh");
    fetch.mockReturnValueOnce(mockResponse({}, { ok: false, status: 401 }));
    const token = await refreshAccessToken();
    expect(token).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe("logout()", () => {
  test("clears both tokens", () => {
    setTokens("a", "r");
    logout();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});
