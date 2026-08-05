// Hand-off from the web client to the native app.
//
// The server mails exactly two `https://` links, both built from
// `FRONTEND_BASE_URL`, and both land here in the browser:
//
//   {FRONTEND_BASE_URL}/verify-email/{token}
//   {FRONTEND_BASE_URL}/reset-password/{uid}/{token}
//
// A phone user therefore finishes an app flow in a browser tab. Universal links
// (iOS) / App Links (Android) are the real fix — the OS would open the app
// directly and the web page would never render — but they need a live domain
// plus an `apple-app-site-association` / `assetlinks.json` served from it and
// signed against the app's team and package ids. None of that exists yet. Until
// it does, the *web page is the only thing that can bridge to the app*, and the
// bridge it has is the custom scheme the mobile app already declares:
// `backgammon://`, with in-app routes mirroring the two paths above.
//
// A custom scheme is a much weaker instrument than a universal link and the
// difference dictates the whole design of this module:
//
//   * It fails **silently**. On a device without the app installed the
//     navigation either does nothing at all or raises a browser-chrome error
//     dialog the page cannot see, cannot catch, and cannot recover from. There
//     is no feature detection — no `canOpenURL` from a web page, no callback,
//     no timeout that isn't a guess. So the browser flow must remain complete
//     and primary on its own, and this is only ever an addition next to it.
//   * It must be **user-initiated**. Auto-firing the scheme on mount is the
//     usual implementation of this feature and it is the bad one: on the
//     majority of visitors (no app) it burns a navigation for nothing, and it
//     fights the back button, because the failed attempt can still land in
//     history. A button the user chooses to press cannot do either.
//
// Hence: no redirect, no gate, no auto-navigate. Just an href, offered where it
// could plausibly work.

// The scheme the mobile app registers. Kept here as one constant so the two
// builders below — and any third that shows up — cannot drift from each other.
const APP_SCHEME = "backgammon://";

// Coarse on purpose. This is a *presentation* decision (show a button or don't),
// never an access decision, so it is allowed to be approximate — but it is
// allowed to be approximate in one direction only.
//
// A false positive costs trust: a desktop visitor taps "Open in the app", the
// scheme does nothing, and the page looks broken in a way they cannot diagnose.
// A false negative costs a tap: a phone user finishes in the browser, exactly as
// they do today with no button at all. So every uncertain case resolves to
// `false`.
//
// The notable uncertain case is **iPadOS**, which has reported a desktop
// `Macintosh` user-agent since iPadOS 13 and is deliberately *not* detected
// here. Sniffing it out means the `Macintosh` + `maxTouchPoints > 0` trick,
// which also matches a touchscreen Mac and would put a dead button in front of
// desktop users — the expensive kind of wrong. An iPad user gets the browser
// flow.
//
// The user-agent is a parameter with a lazy default rather than something read
// at module scope, so tests can pass one directly and callers get the ambient
// one without a module-level snapshot of a value that can be redefined.
export function isMobileBrowser(userAgent) {
  const ua =
    userAgent ??
    (typeof navigator !== "undefined" && navigator ? navigator.userAgent : "");
  if (!ua || typeof ua !== "string") return false;
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|Windows Phone|Opera Mini|IEMobile/i.test(
    ua
  );
}

// Both builders percent-encode their segments. The values are server-generated
// and URL-safe today (a signed token; a base64url-encoded pk), so this changes
// nothing in practice — it is here so that a future token format containing a
// `/` or a `#` produces a wrong-but-encoded URL the app rejects, rather than a
// URL that silently reroutes inside the app.
export function verifyEmailAppUrl(token) {
  return `${APP_SCHEME}verify-email/${encodeURIComponent(token ?? "")}`;
}

export function resetPasswordAppUrl(uid, token) {
  return `${APP_SCHEME}reset-password/${encodeURIComponent(
    uid ?? ""
  )}/${encodeURIComponent(token ?? "")}`;
}
