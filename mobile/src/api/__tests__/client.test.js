import { request } from "../client";
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from "../tokenStore";

/*
 * Tests for the shared mobile request() wrapper (mobile/src/api/client.js),
 * focused on bearer-token injection and the single 401 -> refresh -> retry.
 *
 * Run with:
 *   cd mobile && CI=true npx jest client
 */

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(async () => {
  global.fetch = jest.fn();
  await clearTokens();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("request() auth behaviour", () => {
  test("sends no Authorization header when logged out", async () => {
    fetch.mockReturnValueOnce(mockResponse([]));
    await request("/api/games/");
    const [, options] = fetch.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  test("attaches the stored access token as a bearer header", async () => {
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse([]));
    await request("/api/games/");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/games\/$/);
    expect(options.headers.Authorization).toBe("Bearer acc");
  });

  test("surfaces the server error message on a non-401 failure", async () => {
    fetch.mockReturnValueOnce(mockResponse({ error: "Game is not active." }, { ok: false, status: 400 }));
    await expect(request("/api/games/1/roll_dice/", { method: "POST" })).rejects.toThrow(
      "Game is not active."
    );
  });

  test("on 401, refreshes and retries once with the new token", async () => {
    await setTokens("stale", "good-refresh");
    fetch
      .mockReturnValueOnce(mockResponse({}, { ok: false, status: 401 })) // original
      .mockReturnValueOnce(mockResponse({ access: "fresh" })) // refresh
      .mockReturnValueOnce(mockResponse({ id: 7 })); // retry

    const data = await request("/api/games/7/");

    expect(data).toEqual({ id: 7 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][1].headers.Authorization).toBe("Bearer fresh");
    expect(await getAccessToken()).toBe("fresh");
  });

  test("on 401 with no refresh token, gives up without a refresh call", async () => {
    await setTokens("stale"); // no refresh stored
    fetch.mockReturnValueOnce(mockResponse({ detail: "invalid" }, { ok: false, status: 401 }));

    await expect(request("/api/games/1/")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("on 401 where the refresh also fails, clears tokens and throws", async () => {
    await setTokens("stale", "expired-refresh");
    fetch
      .mockReturnValueOnce(mockResponse({}, { ok: false, status: 401 })) // original
      .mockReturnValueOnce(mockResponse({}, { ok: false, status: 401 })); // refresh rejected

    await expect(request("/api/games/1/")).rejects.toThrow();
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2); // original + refresh, no retry
  });
});
