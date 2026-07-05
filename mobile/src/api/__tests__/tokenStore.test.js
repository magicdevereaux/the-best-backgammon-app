import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  setAccessToken,
  clearTokens,
} from "../tokenStore";

/*
 * Tests for the SecureStore-backed token store (mobile/src/api/tokenStore.js).
 * expo-secure-store is mocked in jest.setup.js with an in-memory object.
 *
 * Run with:
 *   cd mobile && CI=true npx jest tokenStore
 */

beforeEach(async () => {
  await clearTokens();
});

describe("tokenStore", () => {
  test("getters return null when nothing is stored", async () => {
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
  });

  test("setTokens persists both access and refresh", async () => {
    await setTokens("acc", "ref");
    expect(await getAccessToken()).toBe("acc");
    expect(await getRefreshToken()).toBe("ref");
  });

  test("setTokens with no refresh leaves the existing refresh untouched", async () => {
    await setTokens("acc1", "ref1");
    await setTokens("acc2"); // refresh omitted
    expect(await getAccessToken()).toBe("acc2");
    expect(await getRefreshToken()).toBe("ref1");
  });

  test("setAccessToken updates only the access token", async () => {
    await setTokens("acc1", "ref1");
    await setAccessToken("acc2");
    expect(await getAccessToken()).toBe("acc2");
    expect(await getRefreshToken()).toBe("ref1");
  });

  test("clearTokens removes both tokens", async () => {
    await setTokens("acc", "ref");
    await clearTokens();
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
  });
});
