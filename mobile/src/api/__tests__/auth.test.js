import {
  register,
  login,
  fetchMe,
  logout,
  deleteAccount,
  updateEmail,
  resendEmailVerification,
  requestPasswordReset,
} from "../auth";
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
      mockResponse(
        { user: { username: "alice" }, access: "acc", refresh: "ref" },
        { status: 201 }
      )
    );
    const user = await register("alice", "securepass123", "a@example.com");

    expect(user).toEqual({ username: "alice" });
    expect(await getAccessToken()).toBe("acc");
    expect(await getRefreshToken()).toBe("ref");

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/register\/$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      username: "alice",
      password: "securepass123",
      email: "a@example.com",
    });
  });

  test("surfaces the server's field error and stores nothing", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ username: ["Username already taken."] }, { ok: false, status: 400 })
    );
    await expect(register("alice", "securepass123", "a@example.com")).rejects.toThrow(
      "Username already taken."
    );
    expect(await getAccessToken()).toBeNull();
  });

  test("trims the email address before sending it", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ user: { username: "alice", email: "a@example.com" }, access: "acc", refresh: "ref" }, { status: 201 })
    );
    await register("alice", "securepass123", "  a@example.com  ");

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      username: "alice",
      password: "securepass123",
      email: "a@example.com", // trimmed
    });
  });

  test("always sends the email field, even blank — the server owns the rule", async () => {
    // Email is required as of ADR-003. The field goes out unconditionally so the
    // refusal is the server's own required-field message rather than a
    // client-side guess that could drift from it.
    fetch.mockReturnValue(
      mockResponse({ email: ["This field is required."] }, { ok: false, status: 400 })
    );
    for (const blank of [undefined, "", "   "]) {
      fetch.mockClear();
      await expect(register("alice", "securepass123", blank)).rejects.toThrow(
        "This field is required."
      );
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
        username: "alice",
        password: "securepass123",
        email: "",
      });
    }
  });

  test("surfaces the required-email 400 and stores nothing", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ email: ["This field is required."] }, { ok: false, status: 400 })
    );
    await expect(register("alice", "securepass123", "")).rejects.toThrow(
      "This field is required."
    );
    expect(await getAccessToken()).toBeNull();
  });

  test("surfaces a malformed-email field error", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ email: ["Enter a valid email address."] }, { ok: false, status: 400 })
    );
    await expect(register("alice", "securepass123", "nope")).rejects.toThrow(
      "Enter a valid email address."
    );
    expect(await getAccessToken()).toBeNull();
  });
});

describe("updateEmail()", () => {
  test("PATCHes /me/ with the bearer token and returns the fresh user", async () => {
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse({ username: "alice", email: "a@example.com" }));

    const user = await updateEmail("  a@example.com  ");
    expect(user).toEqual({ username: "alice", email: "a@example.com" });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/me\/$/);
    expect(options.method).toBe("PATCH");
    expect(options.headers.Authorization).toBe("Bearer acc");
    expect(JSON.parse(options.body)).toEqual({ email: "a@example.com" }); // trimmed
  });

  test("returns the server's email_verified, which a changed address resets", async () => {
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ username: "alice", email: "new@example.com", email_verified: false })
    );
    const user = await updateEmail("new@example.com");
    expect(user.email_verified).toBe(false);
  });

  test("a blank address is refused by the server, not swallowed here", async () => {
    // Clearing used to be supported ("" removed the address). Email is required
    // as of ADR-003, so the server 400s it — this wrapper still sends what it
    // was given, and the refusal is what the UI shows.
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ email: ["This field may not be blank."] }, { ok: false, status: 400 })
    );
    await expect(updateEmail("")).rejects.toThrow("This field may not be blank.");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ email: "" });
  });

  test("surfaces the server's validation message for a malformed address", async () => {
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ email: ["Enter a valid email address."] }, { ok: false, status: 400 })
    );
    await expect(updateEmail("nope")).rejects.toThrow("Enter a valid email address.");
  });
});

describe("resendEmailVerification()", () => {
  test("POSTs to the resend endpoint with the bearer token and no body", async () => {
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ detail: "Confirmation email sent.", email_verified: false })
    );

    const res = await resendEmailVerification();
    expect(res).toEqual({ detail: "Confirmation email sent.", email_verified: false });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/verify-email\/resend\/$/);
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer acc");
    expect(options.body).toBeUndefined();
  });

  test("an already-confirmed address is a 200, not an error", async () => {
    // The address may have been confirmed in a browser since this screen loaded.
    // The server says so with a 200 and email_verified: true, and the caller is
    // meant to trust that over its cached badge.
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ detail: "Your email address is already confirmed.", email_verified: true })
    );

    const res = await resendEmailVerification();
    expect(res.email_verified).toBe(true);
    expect(res.detail).toBe("Your email address is already confirmed.");
  });

  test("the cool-down 429 throws with the server's copy AND the status", async () => {
    // The status is what lets the UI render this as a notice rather than an
    // error — a mail is already on its way, which is what was asked for.
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse(
        { detail: "A confirmation email was just sent. Please wait a minute before asking again." },
        { ok: false, status: 429 }
      )
    );

    await expect(resendEmailVerification()).rejects.toMatchObject({
      message: "A confirmation email was just sent. Please wait a minute before asking again.",
      status: 429,
    });
  });

  test("a 400 for an account with no address is a genuine error", async () => {
    await setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ detail: "Your account has no email address." }, { ok: false, status: 400 })
    );
    await expect(resendEmailVerification()).rejects.toMatchObject({
      message: "Your account has no email address.",
      status: 400,
    });
  });
});

describe("requestPasswordReset()", () => {
  const FLAT = "If an account with that email address exists, a password reset link has been sent to it.";

  test("POSTs the address unauthenticated and returns the server's message", async () => {
    fetch.mockReturnValueOnce(mockResponse({ detail: FLAT }));

    expect(await requestPasswordReset("  a@example.com ")).toBe(FLAT);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/password-reset\/$/);
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBeUndefined();
    expect(JSON.parse(options.body)).toEqual({ email: "a@example.com" });
  });

  test("a hit and a miss are indistinguishable — the client adds no signal", async () => {
    // The backend answers identically either way (anti-enumeration); assert the
    // wrapper passes that through without inventing a difference.
    fetch.mockReturnValue(mockResponse({ detail: FLAT }));
    const known = await requestPasswordReset("registered@example.com");
    const unknown = await requestPasswordReset("nobody@example.com");
    expect(known).toBe(unknown);
    expect(known).toBe(FLAT);
  });

  test("surfaces a malformed-address 400", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ email: ["Enter a valid email address."] }, { ok: false, status: 400 })
    );
    await expect(requestPasswordReset("nope")).rejects.toThrow("Enter a valid email address.");
  });

  test("surfaces the throttle response", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ detail: "Request was throttled." }, { ok: false, status: 429 })
    );
    await expect(requestPasswordReset("a@example.com")).rejects.toThrow("Request was throttled.");
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
