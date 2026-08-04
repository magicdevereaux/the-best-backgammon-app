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
  deleteAccount,
  updateEmail,
  requestPasswordReset,
  confirmPasswordReset,
  confirmEmailVerification,
  resendEmailVerification,
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
    await register("alice", "securepass123", "alice@example.com");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/register\/$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      username: "alice",
      password: "securepass123",
      email: "alice@example.com",
    });
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

  test("sends an email address when one is supplied", async () => {
    fetch.mockReturnValueOnce(mockResponse({ user: {}, access: "a", refresh: "r" }, { status: 201 }));
    await register("alice", "securepass123", "alice@example.com");
    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      username: "alice",
      password: "securepass123",
      email: "alice@example.com",
    });
  });

  test("still sends the email key when the field was left blank", async () => {
    // Email is required now, so a blank field is a 400 the server gets to
    // phrase. Omitting the key would hide the mistake behind a vaguer error.
    fetch.mockReturnValueOnce(
      mockResponse({ email: ["This field may not be blank."] }, { ok: false, status: 400 })
    );
    await expect(register("alice", "securepass123", "   ")).rejects.toThrow(
      "This field may not be blank."
    );
    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      username: "alice",
      password: "securepass123",
      email: "",
    });
  });

  test("sends an empty string when no address is passed at all", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ email: ["This field is required."] }, { ok: false, status: 400 })
    );
    await expect(register("alice", "securepass123")).rejects.toThrow(
      "This field is required."
    );
  });

  test("surfaces the server's email validation error", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ email: ["Enter a valid email address."] }, { ok: false, status: 400 })
    );
    await expect(register("alice", "securepass123", "nope")).rejects.toThrow(
      "Enter a valid email address."
    );
  });
});

// ---------------------------------------------------------------------------
// updateEmail
// ---------------------------------------------------------------------------

describe("updateEmail(email)", () => {
  test("PATCHes /me/ with the bearer token and the address", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse({ username: "alice", email: "a@example.com" }));

    const user = await updateEmail("a@example.com");

    expect(user).toEqual({ username: "alice", email: "a@example.com" });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/me\/$/);
    expect(options.method).toBe("PATCH");
    expect(options.headers.Authorization).toBe("Bearer acc");
    expect(JSON.parse(options.body)).toEqual({ email: "a@example.com" });
  });

  test("no longer clears the address — the server rejects a blank one", async () => {
    // Clearing used to be supported. It isn't: an account with no address can
    // neither recover its password nor be warned before the turn clock runs
    // out, so the server 400s an empty value and this surfaces that verbatim.
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ email: ["This field may not be blank."] }, { ok: false, status: 400 })
    );
    await expect(updateEmail("")).rejects.toThrow("This field may not be blank.");
    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ email: "" });
  });

  test("returns the payload's email_verified, which a change resets", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ username: "alice", email: "new@example.com", email_verified: false })
    );
    const user = await updateEmail("new@example.com");
    expect(user.email_verified).toBe(false);
  });

  test("surfaces the server's field error on a malformed address", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ email: ["Enter a valid email address."] }, { ok: false, status: 400 })
    );
    await expect(updateEmail("nope")).rejects.toThrow("Enter a valid email address.");
  });

  test("falls back to a generic message when the body says nothing useful", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse(null, { ok: false, status: 500 }));
    await expect(updateEmail("a@example.com")).rejects.toThrow(
      "Could not save your email address."
    );
  });
});

// ---------------------------------------------------------------------------
// requestPasswordReset
// ---------------------------------------------------------------------------

describe("requestPasswordReset(email)", () => {
  const FLAT_200 = {
    detail:
      "If an account with that email address exists, a password reset link has been sent to it.",
  };

  test("POSTs the address to the password-reset endpoint", async () => {
    fetch.mockReturnValueOnce(mockResponse(FLAT_200));
    await requestPasswordReset("  alice@example.com  ");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/password-reset\/$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ email: "alice@example.com" });
  });

  test("resolves the same way for a hit and a miss — no membership oracle", async () => {
    // Both calls get the server's identical 200; nothing about either result
    // may differ, or the caller could tell an account exists.
    fetch.mockReturnValueOnce(mockResponse(FLAT_200));
    const hit = await requestPasswordReset("alice@example.com");
    fetch.mockReturnValueOnce(mockResponse(FLAT_200));
    const miss = await requestPasswordReset("nobody@example.com");
    expect(hit).toEqual(miss);
    expect(hit).toBeUndefined();
  });

  test("rejects with the field error on a malformed address", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ email: ["Enter a valid email address."] }, { ok: false, status: 400 })
    );
    await expect(requestPasswordReset("nope")).rejects.toThrow("Enter a valid email address.");
  });
});

// ---------------------------------------------------------------------------
// confirmPasswordReset
// ---------------------------------------------------------------------------

describe("confirmPasswordReset(uid, token, newPassword)", () => {
  test("POSTs uid, token and new_password to the confirm endpoint", async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ detail: "Your password has been reset. You can now log in." })
    );
    await confirmPasswordReset("MQ", "abc-def", "securepass123");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/password-reset\/confirm\/$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      uid: "MQ",
      token: "abc-def",
      new_password: "securepass123",
    });
  });

  test("surfaces the bad-link error, which arrives as a bare string", async () => {
    fetch.mockReturnValueOnce(
      mockResponse(
        { token: "This password reset link is invalid or has expired." },
        { ok: false, status: 400 }
      )
    );
    await expect(confirmPasswordReset("MQ", "bad", "securepass123")).rejects.toThrow(
      "This password reset link is invalid or has expired."
    );
  });

  test("surfaces an AUTH_PASSWORD_VALIDATORS rejection", async () => {
    fetch.mockReturnValueOnce(
      mockResponse(
        { new_password: ["This password is too common."] },
        { ok: false, status: 400 }
      )
    );
    await expect(confirmPasswordReset("MQ", "abc", "password")).rejects.toThrow(
      "This password is too common."
    );
  });

  test("prefers the link error when both come back — the link is checked first", async () => {
    fetch.mockReturnValueOnce(
      mockResponse(
        {
          token: "This password reset link is invalid or has expired.",
          new_password: ["This password is too short."],
        },
        { ok: false, status: 400 }
      )
    );
    await expect(confirmPasswordReset("MQ", "bad", "x")).rejects.toThrow(
      "This password reset link is invalid or has expired."
    );
  });
});

// ---------------------------------------------------------------------------
// confirmEmailVerification
// ---------------------------------------------------------------------------

describe("confirmEmailVerification(token)", () => {
  const OK = {
    detail: "Your email address is confirmed.",
    email: "alice@example.com",
    email_verified: true,
  };

  test("POSTs the token to the confirm endpoint", async () => {
    fetch.mockReturnValueOnce(mockResponse(OK));
    await confirmEmailVerification("  tok-abc  ");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/verify-email\/confirm\/$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ token: "tok-abc" });
  });

  test("sends no Authorization header — the token is the credential", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse(OK));
    await confirmEmailVerification("tok-abc");
    const [, options] = fetch.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  test("resolves with the server's payload", async () => {
    fetch.mockReturnValueOnce(mockResponse(OK));
    await expect(confirmEmailVerification("tok-abc")).resolves.toEqual(OK);
  });

  test("is idempotent — a second use of the same token still resolves", async () => {
    fetch.mockReturnValueOnce(mockResponse(OK)).mockReturnValueOnce(mockResponse(OK));
    await confirmEmailVerification("tok-abc");
    await expect(confirmEmailVerification("tok-abc")).resolves.toEqual(OK);
  });

  test("surfaces the dead-link field error", async () => {
    fetch.mockReturnValueOnce(
      mockResponse(
        { token: ["This verification link is invalid or has expired."] },
        { ok: false, status: 400 }
      )
    );
    await expect(confirmEmailVerification("bad")).rejects.toThrow(
      "This verification link is invalid or has expired."
    );
  });

  test("falls back to a generic message when the body says nothing useful", async () => {
    fetch.mockReturnValueOnce(mockResponse(null, { ok: false, status: 500 }));
    await expect(confirmEmailVerification("tok")).rejects.toThrow(
      "Could not confirm your email address."
    );
  });
});

// ---------------------------------------------------------------------------
// resendEmailVerification
// ---------------------------------------------------------------------------

describe("resendEmailVerification()", () => {
  test("POSTs to the resend endpoint with the bearer token and no body", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ detail: "Confirmation email sent.", email_verified: false })
    );

    await resendEmailVerification();

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/verify-email\/resend\/$/);
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer acc");
    expect(options.body).toBeUndefined();
  });

  test("resolves the sent case with throttled false", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ detail: "Confirmation email sent.", email_verified: false })
    );
    await expect(resendEmailVerification()).resolves.toEqual({
      detail: "Confirmation email sent.",
      email_verified: false,
      throttled: false,
    });
  });

  test("resolves the already-confirmed case, which is a 200 too", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({
        detail: "Your email address is already confirmed.",
        email_verified: true,
      })
    );
    const result = await resendEmailVerification();
    expect(result.email_verified).toBe(true);
    expect(result.throttled).toBe(false);
  });

  test("resolves the 60-second cool-down rather than throwing", async () => {
    // A 429 here means "we only just sent it" — the answer the user wanted, not
    // an error, so it must not reject and become red text.
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse(
        { detail: "A confirmation email was just sent. Try again in a minute." },
        { ok: false, status: 429 }
      )
    );
    const result = await resendEmailVerification();
    expect(result.throttled).toBe(true);
    expect(result.detail).toMatch(/just sent/i);
  });

  test("rejects when the account has no address to send to", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse(
        { detail: "Add an email address before asking for a confirmation link." },
        { ok: false, status: 400 }
      )
    );
    await expect(resendEmailVerification()).rejects.toThrow(
      "Add an email address before asking for a confirmation link."
    );
  });

  test("falls back to a generic message when the body says nothing useful", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse(null, { ok: false, status: 500 }));
    await expect(resendEmailVerification()).rejects.toThrow(
      "Could not send a confirmation email."
    );
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

// ---------------------------------------------------------------------------
// deleteAccount
// ---------------------------------------------------------------------------

describe("deleteAccount(password)", () => {
  test("DELETEs /me/ with the bearer token and the confirming password", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse(null, { status: 204 }));

    await expect(deleteAccount("securepass123")).resolves.toBe(true);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/me\/$/);
    expect(options.method).toBe("DELETE");
    expect(options.headers.Authorization).toBe("Bearer acc");
    expect(JSON.parse(options.body)).toEqual({ password: "securepass123" });
  });

  test("clears the stored tokens on a 204", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse(null, { status: 204 }));
    await deleteAccount("securepass123");
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  test("surfaces the server's wrong-password field error and keeps the tokens", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(
      mockResponse({ password: ["Password is incorrect."] }, { ok: false, status: 400 })
    );
    await expect(deleteAccount("wrong")).rejects.toThrow("Password is incorrect.");
    expect(getAccessToken()).toBe("acc");
  });

  test("falls back to a generic message when the body has no field errors", async () => {
    setTokens("acc", "ref");
    fetch.mockReturnValueOnce(mockResponse(null, { ok: false, status: 500 }));
    await expect(deleteAccount("securepass123")).rejects.toThrow(
      "Could not delete your account. Please try again."
    );
  });
});
