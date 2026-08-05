# `.well-known/` — Universal Links (iOS) and App Links (Android)

> **Status: dormant configuration.** Nothing here has been deployed, served, or
> verified. It cannot be, yet — there is no domain, no Apple Team ID, and no app
> signing certificate. The files are correct templates with the unknown values
> marked as placeholders. Until an owner fills them in and a domain serves them,
> emailed links simply open in the browser, which is the intended fallback.

## What this is for

The backend mails two plain `https://` links, both built from
`FRONTEND_BASE_URL` ([`backend/game/views.py`](../../../backend/game/views.py)):

```
{FRONTEND_BASE_URL}/verify-email/{token}
{FRONTEND_BASE_URL}/reset-password/{uid}/{token}
```

The web client serves both, and the mobile app has matching in-app routes. These
two files are what let iOS and Android recognise those URLs as belonging to the
app and hand them straight to it when it is installed — falling back to the
browser when it is not.

**That means no server change and no change to the emailed link is required.**
One URL works for web, for iOS with the app installed, for Android with the app
installed, and for anyone with no app at all. Do not "fix" this by mailing a
`backgammon://` link; that would break every recipient without the app.

## Owner checklist

| Value | Appears in | Where it comes from |
|---|---|---|
| `YOUR_DOMAIN` | [`mobile/app.json`](../../../mobile/app.json) — `ios.associatedDomains` and both `android.intentFilters` `data` entries | The bare host of the deployed web client. Host only: no scheme, no path, no port. Must match the host in `FRONTEND_BASE_URL` exactly. |
| `YOUR_APPLE_TEAM_ID` | `apple-app-site-association` (twice: `appID` and `appIDs`) | developer.apple.com → Membership. 10 characters. **Requires a paid Apple Developer account** — none exists yet. |
| `REPLACE_ME_WITH_SHA256_FINGERPRINT_FROM_eas_credentials` | `assetlinks.json` | `cd mobile && eas credentials` → Android → the build credentials' SHA-256 fingerprint. **No EAS build has ever run**, so this certificate does not exist yet. Colon-separated uppercase hex, e.g. `1A:2B:…` (64 hex pairs). |

If Google Play App Signing is enabled (the default for the Play Store), Google
re-signs the app with **its own** key. Then the fingerprint that matters is the
one under Play Console → Setup → App integrity → *App signing key certificate* —
not the upload key. The safe move is to list **both** fingerprints in
`sha256_cert_fingerprints`; the array accepts multiple entries, which also lets
you serve one file that satisfies both a debug/internal build and the store
build.

The bundle id / package name `com.magicdevereaux.backgammon` is already real and
matches `mobile/app.json`; leave it alone.

## Serving requirements

These are strict, and getting them wrong fails **silently** — the OS just opens
the browser instead, with no error anywhere.

Both files must be reachable over HTTPS with a valid certificate at:

```
https://<domain>/.well-known/apple-app-site-association
https://<domain>/.well-known/assetlinks.json
```

- **HTTP 200, no redirect of any kind.** Not `http` → `https`, not apex → `www`,
  not a trailing-slash normalisation. This is the most common reason universal
  links quietly do nothing. Whichever host is in `associatedDomains` must serve
  the file *itself*.
- **`Content-Type: application/json` on both.** The AASA file has **no
  extension** on purpose (Apple requires that), so most static hosts will guess
  `text/plain` or `application/octet-stream` and iOS will reject it. Add an
  explicit header rule for `/.well-known/apple-app-site-association`. On Vercel
  that is a `headers` entry in `vercel.json`; on nginx a `location` block.
- **No authentication, and not behind the SPA fallback.** If the host rewrites
  unknown paths to `index.html`, exclude `/.well-known/*` or you will serve HTML
  with a 200.
- **Do not sign the AASA file.** Plain JSON only; the signed/CMS form is long
  obsolete.

## How these files ship

CRA copies everything in `frontend/public/` verbatim into `build/` (only
`index.html` is templated), and dot-directories are included — so
`build/.well-known/` appears in every `npm run build` with no extra config. This
`README.md` ships too, which is harmless and by design: it keeps the
instructions next to the files they describe.

Note that some deploy pipelines and archive tools drop dot-prefixed entries. If
the files 404 in production but exist locally, check that first.

## Rebuild required — this is not an OTA change

`ios.associatedDomains` is an entitlement and `android.intentFilters` is
manifest config. Both are **native**, so:

- they do **not** work in Expo Go — you need a development build or a store build;
- they do **not** arrive via `eas update`. Per the `//runtimeVersion` note in
  [`mobile/app.json`](../../../mobile/app.json), pushing native config as an OTA
  would ship JS to a binary that cannot honour it. Bump `expo.version` and cut a
  new build.

Editing *these two files* alone needs no rebuild — they are served, not bundled.
But changing the **domain** does, because it is baked into the binary.

## Verifying

**iOS** — check Apple's CDN has picked up the file (it caches, and can lag up to
24h after a change):

```
https://app-site-association.cdn-apple.com/a/v1/<domain>
```

If that returns your JSON, the server half is correct. Then install a real build
(not Expo Go), and tap a link from Notes or Mail — typing the URL into Safari's
address bar deliberately does *not* trigger a universal link. `Settings → Developer
→ Universal Links → Diagnostics` on a dev-provisioned device gives per-URL detail.

**Android** — from an adb-connected device with the app installed:

```
adb shell pm verify-app-links --re-verify com.magicdevereaux.backgammon
adb shell pm get-app-links com.magicdevereaux.backgammon
```

The second prints each host with a state; you want `verified`. Anything else
(`none`, `1024`, `legacy_failure`) means the fetch or the fingerprint failed.
Google's checker is also useful:
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<domain>&relation=delegate_permission/common.handle_all_urls`

**Before any of that**, the local sanity check is just that all three JSON files
parse — `apple-app-site-association` included, despite having no extension.

## Scope is deliberately narrow

Both platforms are scoped to `/verify-email/*` and `/reset-password/*` only, not
to the whole host. A host-wide filter would hijack every link to the marketing
site, the lobby, and the shared `/game/` URLs into an app with no screen for
them. Widen this only alongside real in-app routes for whatever you add.
