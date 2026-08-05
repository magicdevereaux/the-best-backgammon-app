import {
  isMobileBrowser,
  resetPasswordAppUrl,
  verifyEmailAppUrl,
} from "../appLink";

/*
 * The web→app hand-off helper. Two things are worth pinning down here:
 *
 *  1. The URLs, because they are an integration contract with the mobile app's
 *     route table (`backgammon://verify-email/:token`,
 *     `backgammon://reset-password/:uid/:token`) in a repo where nothing checks
 *     the two halves against each other at build time.
 *  2. The *direction* of the detector's uncertainty. It is allowed to miss a
 *     phone; it is not allowed to claim a desktop is one, because a dead
 *     "Open in the app" button on a machine that can never honour the scheme is
 *     the failure that costs trust.
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=appLink
 */

// Real strings, not invented ones — a regex tuned against paraphrased
// user-agents proves nothing.
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const WINDOWS_FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0";

describe("isMobileBrowser", () => {
  test("recognises iOS and Android", () => {
    expect(isMobileBrowser(IPHONE)).toBe(true);
    expect(isMobileBrowser(ANDROID)).toBe(true);
  });

  test("does not fire on desktop browsers", () => {
    expect(isMobileBrowser(MAC_CHROME)).toBe(false);
    expect(isMobileBrowser(WINDOWS_FIREFOX)).toBe(false);
  });

  test("an unknown or absent user-agent resolves to false, not true", () => {
    // The whole point of the conservative direction: when we cannot tell, we
    // show the browser flow alone, which always works.
    expect(isMobileBrowser("")).toBe(false);
    expect(isMobileBrowser(null)).toBe(false);
    expect(isMobileBrowser(undefined)).toBe(false);
    expect(isMobileBrowser("Some-Crawler/1.0")).toBe(false);
    expect(isMobileBrowser(12345)).toBe(false);
  });

  test("falls back to the ambient navigator when given no argument", () => {
    const original = navigator.userAgent;
    Object.defineProperty(window.navigator, "userAgent", {
      value: ANDROID,
      configurable: true,
    });
    expect(isMobileBrowser()).toBe(true);

    Object.defineProperty(window.navigator, "userAgent", {
      value: original,
      configurable: true,
    });
  });
});

describe("app URLs", () => {
  test("verify-email carries the token on the app's route", () => {
    expect(verifyEmailAppUrl("tok-abc")).toBe("backgammon://verify-email/tok-abc");
  });

  test("reset-password carries uid and token in order", () => {
    expect(resetPasswordAppUrl("MQ", "abc-def")).toBe(
      "backgammon://reset-password/MQ/abc-def"
    );
  });

  test("segments are percent-encoded so a stray slash cannot reroute in-app", () => {
    expect(verifyEmailAppUrl("a/b")).toBe("backgammon://verify-email/a%2Fb");
    expect(resetPasswordAppUrl("M#Q", "a/b")).toBe(
      "backgammon://reset-password/M%23Q/a%2Fb"
    );
  });
});
