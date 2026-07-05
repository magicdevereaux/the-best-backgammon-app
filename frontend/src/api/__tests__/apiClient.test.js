import { request } from "../apiClient";
import { setTokens, getAccessToken, getRefreshToken } from "../authApi";

/*
 * Tests for the shared request() wrapper (frontend/src/api/apiClient.js),
 * focused on the auth behaviour: bearer-token injection and the single
 * 401 -> refresh -> retry cycle.
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=apiClient
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

describe("request() auth behaviour", () => {
  test("attaches no Authorization header when logged out", async () => {
    fetch.mockReturnValueOnce(mockResponse([]));
    await request("/api/games/");
    const [, options] = fetch.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  test("attaches the stored access token as a bearer header", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse([]));
    await request("/api/games/");
    const [, options] = fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer acc");
  });

  test("returns parsed JSON on success", async () => {
    fetch.mockReturnValueOnce(mockResponse({ id: 1 }));
    const data = await request("/api/games/1/");
    expect(data).toEqual({ id: 1 });
  });

  test("surfaces the server error message on a non-401 failure", async () => {
    fetch.mockReturnValueOnce(mockResponse({ error: "Game is not active." }, { ok: false, status: 400 }));
    await expect(request("/api/games/1/roll_dice/", { method: "POST" })).rejects.toThrow(
      "Game is not active."
    );
  });

  test("on 401, refreshes the token and retries the request once with the new token", async () => {
    setTokens("stale-access", "good-refresh");
    fetch
      // 1st call: original request rejected
      .mockReturnValueOnce(mockResponse({}, { ok: false, status: 401 }))
      // 2nd call: refresh endpoint issues a new access token
      .mockReturnValueOnce(mockResponse({ access: "fresh-access" }))
      // 3rd call: retried original request succeeds
      .mockReturnValueOnce(mockResponse({ id: 7 }));

    const data = await request("/api/games/7/");

    expect(data).toEqual({ id: 7 });
    expect(fetch).toHaveBeenCalledTimes(3);

    // The retry (3rd call) must carry the refreshed bearer token.
    const [, retryOptions] = fetch.mock.calls[2];
    expect(retryOptions.headers.Authorization).toBe("Bearer fresh-access");
    expect(getAccessToken()).toBe("fresh-access");
  });

  test("on 401 with no refresh token, gives up without retrying", async () => {
    setTokens("stale-access", ""); // refresh cleared
    localStorage.removeItem("refresh");
    fetch.mockReturnValueOnce(mockResponse({ detail: "token invalid" }, { ok: false, status: 401 }));

    await expect(request("/api/games/1/")).rejects.toThrow();
    // one original attempt only; no refresh call, no retry
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("on 401 where the refresh also fails, clears tokens and throws", async () => {
    setTokens("stale-access", "expired-refresh");
    fetch
      .mockReturnValueOnce(mockResponse({}, { ok: false, status: 401 }))
      .mockReturnValueOnce(mockResponse({}, { ok: false, status: 401 })); // refresh rejected

    await expect(request("/api/games/1/")).rejects.toThrow();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2); // original + refresh, no retry
  });
});
