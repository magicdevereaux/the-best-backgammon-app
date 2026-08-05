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

## Deep links

Two backend emails carry links, and both now have in-app routes at paths that
mirror the web client's exactly:

| Link | Route |
|------|-------|
| `/verify-email/{token}` | [`app/verify-email/[token].jsx`](app/verify-email/[token].jsx) |
| `/reset-password/{uid}/{token}` | [`app/reset-password/[uid]/[token].jsx`](app/reset-password/[uid]/[token].jsx) |

**Three mechanisms reach those routes, and only two of them work today.**

1. **The custom scheme** — `backgammon://verify-email/<token>`. Declared as
   `expo.scheme` in [`app.json`](app.json); expo-router maps the path to the
   route with no extra wiring. Works now, including in Expo Go, and is how you
   test these screens: `npx uri-scheme open "backgammon://verify-email/abc" --ios`.
2. **The web hand-off** — the web client's own `/verify-email` and
   `/reset-password` pages detect a mobile browser and offer an "open in the app"
   button pointing at that same scheme
   ([`frontend/src/utils/appLink.js`](../frontend/src/utils/appLink.js)). This is
   the bridge that works before a domain exists.
3. **Universal links / App Links** — `ios.associatedDomains` and an `autoVerify`
   `android.intentFilters` block are committed but **inert**: they carry
   `YOUR_DOMAIN` placeholders, and the domain must serve the two files in
   [`frontend/public/.well-known/`](../frontend/public/.well-known/). See
   [going-live 1.8](../docs/operations/going-live.md). This is the only mechanism
   that makes an *emailed* link open the app, because mail clients will not
   follow a custom scheme.

**Do not "fix" this by mailing a `backgammon://` link.** Mail clients strip or
refuse custom schemes, and a link that only works for people who already have the
app installed is worse than one that always opens something. The design point of
universal links is that the server keeps mailing one ordinary `https://` URL
built from `FRONTEND_BASE_URL` — the OS decides whether the app or the browser
handles it, and the browser fallback is automatic.

**Universal links are native config**, so they need a new store build: they do
not work in Expo Go, and per the `runtimeVersion` note in `app.json` they cannot
ship as an OTA update to an existing binary.

### Tests for screens live in `src/screens/__tests__/`, not next to the screen

Every other test in this client sits in a `__tests__/` folder beside the thing it
tests. **Route tests are the exception, and must stay one**: expo-router builds
its route table from a `require.context` over the whole `app/` directory whose
ignore list covers only `+html` / `+api` / `+middleware` / `+native-intent`.
Nothing excludes `__tests__`, so a test file under `app/` is registered as a
*route* (`/__tests__/verify-email.test`) and pulled into the Metro bundle graph —
dragging `@testing-library/react-native` in with it. Harmless in dev, and a
production install without devDependencies can fail to resolve it.

So [`src/screens/__tests__/`](src/screens/__tests__/) holds the tests for
`app/verify-email/[token].jsx` and `app/reset-password/[uid]/[token].jsx`, and
reaches back into `app/` with a relative import. Moving them "next to the code"
would look tidier and would quietly put a test library in the shipped bundle.
