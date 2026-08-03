# Legal documents

Two drafts live here:

- [privacy-policy.md](privacy-policy.md)
- [terms-of-service.md](terms-of-service.md)

## Status: drafts. Not usable as-is.

They were written against the code as it actually exists — what
[`backend/game/models.py`](../../backend/game/models.py) stores, what
[`RegisterSerializer`](../../backend/game/serializers.py) collects (username and
password, plus an **optional** email), and what the
clients keep on-device. That address is used for **two** things — password reset
and the turn reminder `manage.py send_turn_reminders` sends — and the privacy
policy has to keep saying both, along with the opt-out
(`UserPreferences.turn_reminder_emails`, default on, writable at
`PATCH /api/auth/me/`) that makes the second one defensible. They deliberately
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

One item remains. The rest of this list records gaps that have since shipped, and
the claims the drafts now make because of them — each of which becomes a false
statement if the feature behind it changes.

- **Account deletion is implemented** (as of 2026-07-26) — `DELETE /api/auth/me/`
  requires the account's current password, with a danger-zone control on the web
  profile page and the mobile profile screen. Deletion **anonymises rather than
  destroys**: user FKs are `on_delete=SET_NULL`, so display names, boards and
  results survive for opponents while the account is unlinked; only unjoined
  lobby adverts are removed. Outstanding refresh tokens are blacklisted. The
  privacy policy's "Account deletion" section already describes it that way.
  **Still outstanding for Play:** a *web-accessible deletion request URL*, which
  needs the app to be hosted. A `[TODO — REQUIRED BEFORE STORE SUBMISSION]`
  notice sits in the policy at that spot; delete it once the URL exists.
- **Password reset is implemented** — an email address is optional at
  registration and addable later via `PATCH /api/auth/me/`, and both clients can
  request a reset link. Both documents now say so, with the correct caveat: an
  account with **no address on file** still cannot be recovered. (The emailed
  link points at the *web* client only — there is no mobile deep link yet — but
  that is a product gap, not a claim either document makes.)
- **A second outbound mail exists, and it is opt-out.** The turn reminder is
  unsolicited in a way the reset link is not, so the policy now describes it
  explicitly: on by default for accounts with an address, off from the profile in
  either app, named in a footer on every message, and irrelevant to anyone who
  never supplied an address — because none is required to play. **If that opt-out
  is ever removed, weakened, or defaulted differently, the policy is false the
  same day.** Server side it is `UserPreferences.turn_reminder_emails`
  ([data-model.md](../architecture/data-model.md#userpreferences)); the mail is
  [`send_turn_reminders`](../../backend/game/management/commands/send_turn_reminders.py),
  which is dormant until a cron is scheduled
  ([railway-deploy.md step 8](../operations/railway-deploy.md#8-schedule-the-turn-reminder-cron)).
- **The remaining API limitation is read access, and it is disclosed, not
  hidden** — anyone holding a game's link or id can read that game's full state,
  which is how online games are shared and joined, and guest seats carry no
  verifiable identity. Write/delete on games and matches is **closed**: both
  viewsets dropped `ModelViewSet`, so PUT/PATCH/DELETE return 405 and every
  mutation goes through a seat-checked custom action. See
  [going-live.md](../operations/going-live.md). If the read surface is ever
  narrowed, update the "Limitations you should know about" section of the
  privacy policy and section 6 of the terms so they keep matching reality.

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
