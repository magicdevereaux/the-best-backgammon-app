import { register, login, fetchMe, logout, deleteAccount } from "../auth";
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from "../tokenStore";

/*
 * Tests for the mobile auth API (mobile/src/api/auth.js). fetch is mocked;
 * SecureStore is the in-memory mock from jest.setup.js.
 *
 * Run with:
 *   cd mobile && CI=true npx jest auth
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

describe("register()", () => {
  test("POSTs credentials, stores the returned tokens, returns the user", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ user: { username: "alice" }, access: "acc", refresh: "ref" }, { status: 201 })
    );
    const user = await register("alice", "securepass123");

    expect(user).toEqual({ username: "alice" });
    expect(await getAccessToken()).toBe("acc");
    expect(await getRefreshToken()).toBe("ref");

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/register\/$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ username: "alice", password: "securepass123" });
  });

  test("surfaces the server's field error and stores nothing", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ username: ["Username already taken."] }, { ok: false, status: 400 })
    );
    await expect(register("alice", "securepass123")).rejects.toThrow("Username already taken.");
    expect(await getAccessToken()).toBeNull();
  });
});

describe("login()", () => {
  test("stores tokens then resolves the user via /me/ with the bearer token", async () => {
    fetch
      .mockReturnValueOnce(mockResponse({ access: "acc", refresh: "ref" })) // login
      .mockReturnValueOnce(mockResponse({ username: "alice", wins: 5 })); // /me/

    const user = await login("alice", "securepass123");

    expect(user).toEqual({ username: "alice", wins: 5 });
    expect(await getAccessToken()).toBe("acc");

    const [, meOptions] = fetch.mock.calls[1];
    expect(fetch.mock.calls[1][0]).toMatch(/\/api\/auth\/me\/$/);
    expect(meOptions.headers.Authorization).toBe("Bearer acc");
  });

  test("throws a friendly message and stores nothing on bad credentials", async () => {
    fetch.mockReturnValueOnce(mockResponse({ detail: "No active account" }, { ok: false, status: 401 }));
    await expect(login("alice", "wrong")).rejects.toThrow("Invalid username or password.");
    expect(await getAccessToken()).toBeNull();
  });
});

describe("fetchMe()", () => {
  test("returns null without any network call when no token is stored", async () => {
    const result = await fetchMe();
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("returns the user when the token is valid", async () => {
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse({ username: "alice" }));
    expect(await fetchMe()).toEqual({ username: "alice" });
  });

  test("returns null (swallows the error) when the request fails", async () => {
    // access token only, no refresh -> request() 401 has nothing to refresh with,
    // so it throws and fetchMe catches it and returns null.
    await setTokens("stale");
    fetch.mockReturnValueOnce(mockResponse({}, { ok: false, status: 401 }));
    expect(await fetchMe()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1); // no refresh attempt
  });
});

describe("logout()", () => {
  test("clears both tokens", async () => {
    await setTokens("acc", "ref");
    await logout();
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
  });
});

describe("deleteAccount()", () => {
  test("DELETEs /me/ with the bearer token and the confirming password", async () => {
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse(null, { status: 204 }));

    await expect(deleteAccount("securepass123")).resolves.toBe(true);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/me\/$/);
    expect(options.method).toBe("DELETE");
    expect(options.headers.Authorization).toBe("Bearer acc");
    expect(JSON.parse(options.body)).toEqual({ password: "securepass123" });
  });

  test("clears SecureStore on a 204", async () => {
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse(null, { status: 204 }));
    await deleteAccount("securepass123");
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
  });

  test("surfaces the server's wrong-password field error and keeps the tokens", async () => {
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ password: ["Password is incorrect."] }, { ok: false, status: 400 })
    );
    await expect(deleteAccount("wrong")).rejects.toThrow("Password is incorrect.");
    expect(await getAccessToken()).toBe("acc");
  });

  test("falls back to a generic message when the body has no field errors", async () => {
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse(null, { ok: false, status: 500 }));
    await expect(deleteAccount("securepass123")).rejects.toThrow(
      "Could not delete your account. Please try again."
    );
  });
});
