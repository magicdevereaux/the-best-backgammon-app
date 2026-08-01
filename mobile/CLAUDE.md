# mobile/CLAUDE.md

Notes for the **Expo mobile client only**. Repo-wide context is in the root
[`CLAUDE.md`](../CLAUDE.md).

## API host resolution

[`src/api/config.js`](src/api/config.js) resolves the backend base URL in this
order, first match winning:

1. `MANUAL_OVERRIDE` — a `const` in that file, `null` by default. Set it to a
   fixed URL (e.g. `"http://192.168.1.50:8000"`) for a physical device on another
   network, or to point a dev build at a deployed backend.
2. `EXPO_PUBLIC_API_URL` — inlined into the bundle at build time.
3. `expo.extra.apiUrl` — from `app.json`, via `Constants.expoConfig.extra.apiUrl`.
4. Metro `hostUri` — **dev only**. Expo Go / dev-client report the dev-machine
   LAN IP, so a physical device reaches Django with zero configuration.
5. Loopback — **dev only**. Android emulator `10.0.2.2`, otherwise `localhost`.
6. Otherwise a hard configuration error.

A release build has no `hostUri`, so steps 4–5 are unavailable: it **must** be
given an explicit `https://` URL. A missing or plaintext-`http://` host is
reported as a configuration error and `assertApiConfigured()` **throws at the
first API call** rather than silently pointing at an unreachable localhost.

Because dev resolution goes through the LAN IP, the Django server has to be
reachable from the device: run it as `runserver 0.0.0.0:8000` and add the host to
`ALLOWED_HOSTS`.
