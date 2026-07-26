import { resolveApiConfig } from "../config";

/*
 * Tests for backend host resolution (mobile/src/api/config.js).
 *
 * The headline risk these guard: development auto-detection (Expo Go on a
 * physical device finding the dev machine's LAN IP with zero configuration)
 * must keep working exactly as before, while release builds must refuse to
 * silently fall back to an unreachable localhost.
 *
 * Run with:
 *   cd mobile && CI=true npx jest config
 */

// Every input is passed explicitly so no test depends on the real environment.
const DEV = {
  manualOverride: null,
  envUrl: undefined,
  extraUrl: undefined,
  hostUri: null,
  dev: true,
  platformOS: "ios",
};
const RELEASE = { ...DEV, dev: false };

describe("development auto-detection (must not regress)", () => {
  test("uses the Metro LAN host, dropping the Metro port, for the Django port", () => {
    const { baseUrl, source, error } = resolveApiConfig({
      ...DEV,
      hostUri: "192.168.1.50:8081",
    });
    expect(baseUrl).toBe("http://192.168.1.50:8000");
    expect(source).toBe("metro-hostUri");
    expect(error).toBeNull();
  });

  test("handles a hostUri with no port", () => {
    expect(resolveApiConfig({ ...DEV, hostUri: "192.168.1.50" }).baseUrl).toBe(
      "http://192.168.1.50:8000"
    );
  });

  test("an empty extra.apiUrl (the shipped app.json default) does not disable auto-detection", () => {
    const { baseUrl, source } = resolveApiConfig({
      ...DEV,
      extraUrl: "",
      envUrl: "",
      hostUri: "10.1.2.3:8081",
    });
    expect(baseUrl).toBe("http://10.1.2.3:8000");
    expect(source).toBe("metro-hostUri");
  });

  test("whitespace-only config is ignored too", () => {
    expect(
      resolveApiConfig({ ...DEV, extraUrl: "   ", hostUri: "10.1.2.3:8081" }).baseUrl
    ).toBe("http://10.1.2.3:8000");
  });

  test("falls back to 10.0.2.2 on Android and localhost elsewhere when there is no hostUri", () => {
    expect(resolveApiConfig({ ...DEV, platformOS: "android" }).baseUrl).toBe(
      "http://10.0.2.2:8000"
    );
    expect(resolveApiConfig({ ...DEV, platformOS: "ios" }).baseUrl).toBe(
      "http://localhost:8000"
    );
    expect(resolveApiConfig({ ...DEV, platformOS: "ios" }).source).toBe("loopback");
  });

  test("plaintext http is fine in development", () => {
    const { baseUrl, error } = resolveApiConfig({
      ...DEV,
      envUrl: "http://192.168.1.50:8000",
    });
    expect(baseUrl).toBe("http://192.168.1.50:8000");
    expect(error).toBeNull();
  });
});

describe("precedence", () => {
  const all = {
    ...DEV,
    manualOverride: "http://manual.test:8000",
    envUrl: "https://env.test",
    extraUrl: "https://extra.test",
    hostUri: "192.168.1.50:8081",
  };

  test("MANUAL_OVERRIDE beats everything", () => {
    const { baseUrl, source } = resolveApiConfig(all);
    expect(baseUrl).toBe("http://manual.test:8000");
    expect(source).toBe("MANUAL_OVERRIDE");
  });

  test("EXPO_PUBLIC_API_URL beats extra.apiUrl and hostUri", () => {
    const { baseUrl, source } = resolveApiConfig({ ...all, manualOverride: null });
    expect(baseUrl).toBe("https://env.test");
    expect(source).toBe("EXPO_PUBLIC_API_URL");
  });

  test("extra.apiUrl beats hostUri", () => {
    const { baseUrl, source } = resolveApiConfig({
      ...all,
      manualOverride: null,
      envUrl: undefined,
    });
    expect(baseUrl).toBe("https://extra.test");
    expect(source).toBe("expo.extra.apiUrl");
  });

  test("trailing slashes are trimmed so paths concatenate cleanly", () => {
    expect(resolveApiConfig({ ...DEV, envUrl: "https://api.test/" }).baseUrl).toBe(
      "https://api.test"
    );
    expect(resolveApiConfig({ ...DEV, envUrl: "https://api.test///" }).baseUrl).toBe(
      "https://api.test"
    );
  });
});

describe("release builds", () => {
  test("accept an explicit https URL", () => {
    const { baseUrl, error, source } = resolveApiConfig({
      ...RELEASE,
      envUrl: "https://api.example.com",
    });
    expect(baseUrl).toBe("https://api.example.com");
    expect(error).toBeNull();
    expect(source).toBe("EXPO_PUBLIC_API_URL");
  });

  test("reject a plaintext http URL loudly instead of using it silently", () => {
    const { error, source } = resolveApiConfig({
      ...RELEASE,
      extraUrl: "http://api.example.com",
    });
    expect(error).toMatch(/https:\/\//);
    expect(error).toMatch(/http:\/\/api\.example\.com/);
    expect(error).toMatch(/App Transport Security|usesCleartextTraffic/);
    expect(source).toBe("expo.extra.apiUrl");
  });

  test("never fall back to a Metro host or to localhost", () => {
    const { baseUrl, source, error } = resolveApiConfig({
      ...RELEASE,
      hostUri: "192.168.1.50:8081",
      platformOS: "android",
    });
    expect(baseUrl).toBeNull();
    expect(source).toBe("unconfigured");
    expect(error).toMatch(/EXPO_PUBLIC_API_URL/);
    expect(error).toMatch(/extra\.apiUrl/);
  });

  test("reject a non-absolute URL", () => {
    const { baseUrl, error } = resolveApiConfig({
      ...RELEASE,
      envUrl: "api.example.com",
    });
    expect(baseUrl).toBeNull();
    expect(error).toMatch(/absolute URL/);
  });

  test("a non-absolute URL is rejected in development too", () => {
    const { baseUrl, error } = resolveApiConfig({ ...DEV, envUrl: "/api" });
    expect(baseUrl).toBeNull();
    expect(error).toMatch(/absolute URL/);
  });
});

describe("module wiring", () => {
  const OLD_ENV = process.env.EXPO_PUBLIC_API_URL;

  function loadConfig({ constants = {}, dev = true, envUrl } = {}) {
    let mod;
    const prevDev = global.__DEV__;
    if (envUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = envUrl;
    global.__DEV__ = dev;
    jest.isolateModules(() => {
      jest.doMock("expo-constants", () => ({ __esModule: true, default: constants }));
      mod = require("../config");
    });
    global.__DEV__ = prevDev;
    return mod;
  }

  afterEach(() => {
    jest.dontMock("expo-constants");
    jest.resetModules();
    if (OLD_ENV === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = OLD_ENV;
  });

  test("reads hostUri from Constants.expoConfig in a dev build", () => {
    const mod = loadConfig({ constants: { expoConfig: { hostUri: "172.16.0.9:8081" } } });
    expect(mod.API_BASE_URL).toBe("http://172.16.0.9:8000");
    expect(mod.API_CONFIG_ERROR).toBeNull();
    expect(() => mod.assertApiConfigured()).not.toThrow();
  });

  test("falls back to the Expo Go debuggerHost when expoConfig has no hostUri", () => {
    const mod = loadConfig({
      constants: { expoConfig: {}, expoGoConfig: { debuggerHost: "172.16.0.9:8081" } },
    });
    expect(mod.API_BASE_URL).toBe("http://172.16.0.9:8000");
  });

  test("reads extra.apiUrl from the app config", () => {
    const mod = loadConfig({
      constants: { expoConfig: { hostUri: "172.16.0.9:8081", extra: { apiUrl: "https://cfg.test" } } },
    });
    expect(mod.API_BASE_URL).toBe("https://cfg.test");
    expect(mod.API_URL_SOURCE).toBe("expo.extra.apiUrl");
  });

  test("reads EXPO_PUBLIC_API_URL from the environment", () => {
    const mod = loadConfig({
      constants: { expoConfig: { hostUri: "172.16.0.9:8081" } },
      envUrl: "https://env.test",
    });
    expect(mod.API_BASE_URL).toBe("https://env.test");
    expect(mod.API_URL_SOURCE).toBe("EXPO_PUBLIC_API_URL");
  });

  test("an unconfigured release build logs an error and makes assertApiConfigured throw", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const mod = loadConfig({ constants: { expoConfig: {} }, dev: false });
    expect(mod.API_BASE_URL).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("EXPO_PUBLIC_API_URL"));
    expect(() => mod.assertApiConfigured()).toThrow(/No API URL configured/);
    spy.mockRestore();
  });
});

describe("request() refuses to run against a broken config", () => {
  afterEach(() => {
    jest.dontMock("../config");
    jest.resetModules();
  });

  test("throws the configuration error instead of issuing a fetch", async () => {
    let client;
    jest.isolateModules(() => {
      jest.doMock("../config", () => ({
        API_BASE_URL: null,
        API_CONFIG_ERROR: "boom: no API URL configured",
        API_URL_SOURCE: "unconfigured",
        assertApiConfigured: () => {
          throw new Error("boom: no API URL configured");
        },
      }));
      client = require("../client");
    });
    global.fetch = jest.fn();

    await expect(client.request("/api/games/")).rejects.toThrow("boom: no API URL configured");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
