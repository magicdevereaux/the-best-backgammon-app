# Legal documents

Two drafts live here:

- [privacy-policy.md](privacy-policy.md)
- [terms-of-service.md](terms-of-service.md)

## Status: drafts. Not usable as-is.

They were written against the code as it actually exists — what
[`backend/game/models.py`](../../backend/game/models.py) stores, what
[`RegisterSerializer`](../../backend/game/serializers.py) collects (username and
password only, no email), and what the clients keep on-device. They deliberately
do **not** describe analytics, advertising, tracking, crash reporting, payments,
or third-party SDKs, because none of those exist in this app. If any of those are
ever added, **both documents must be corrected before that ship** — the honesty
of these drafts is the only thing making them worth anything.

Three things stand between these drafts and publication:

### 1. Fill in every `[TODO: ...]`

Both files are salted with obvious `[TODO: ...]` placeholders. Search for `TODO`
and resolve all of them. They cover, at minimum:

- the operating legal entity's name (and postal address, if a business)
- a real contact email address
- effective and last-updated dates
- governing jurisdiction and venue for disputes
- hosting provider, server/log location, and log retention period
- data retention policy
- minimum age, matching your declared store age rating
- which privacy regimes (GDPR / UK GDPR / CCPA) you actually fall under
- liability cap, and whether you want an arbitration clause
- whether the software is being published under the repo's `LICENSE` or kept
  closed-source

### 2. Get a legal review

These are a starting point written by a developer tool, not legal advice. A
lawyer in your jurisdiction should read both before you publish them, especially
the liability, governing-law, and GDPR/CCPA sections.

### 3. Fix the blocking gaps in the product

Two items are called out in the drafts as blockers rather than papered over:

- **Account deletion is not implemented.** There is no API endpoint that deletes
  a user account or its game records. **Both the Apple App Store and Google Play
  require an account-deletion path for any app that lets users create an
  account** — Play additionally requires a web-accessible deletion request URL.
  Until an endpoint plus a delete button in both clients exists, the drafts point
  users at a manual email request, and that request has to genuinely be honoured
  by hand in the Django admin.
- **Known API security gaps are disclosed, not hidden** — unauthenticated read
  access to game records, unguarded write/delete on games and matches, and
  unverifiable guest seats. See
  [going-live.md](../operations/going-live.md). When those are fixed, update the
  "Limitations you should know about" section of the privacy policy and section
  6 of the terms so they keep matching reality.

There is also **no password reset** (no email is on file), which both documents
state plainly. Adding one would be worth it before launch.

## Hosting the policy

Markdown in this repo is not enough. **Both stores require the privacy policy to
be reachable at a public URL** that you enter in App Store Connect and the Play
Console — Play also requires the same link inside the app or store listing, and
Apple requires a privacy-policy link in the App Store listing. Publish the
rendered policy somewhere stable (a GitHub Pages site, a static page on the
project's domain, or the marketing site) and keep that URL alive for as long as
the app is listed. A link to a file in a private repo will fail review.

The terms of service do not strictly need a URL for Apple — if you provide none,
Apple applies its standard EULA — but publishing them alongside the policy is
the better path, and Play expects them if you reference them anywhere.
