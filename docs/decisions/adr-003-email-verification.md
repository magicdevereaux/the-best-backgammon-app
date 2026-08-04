# ADR-003: Email is required; verification gates the reminder mail and nothing else

**Status: accepted and implemented.** Agreed and built 2026-08-03. Everything
under [The design, as built](#the-design-as-built) exists in the code: the
`EmailVerification` model
([`models.py`](../../backend/game/models.py), migration
[`0008_emailverification.py`](../../backend/game/migrations/0008_emailverification.py)),
a **required** `RegisterSerializer.email`, a read-only `email_verified` on
`UserSerializer`, `POST /api/auth/verify-email/confirm/` and
`POST /api/auth/verify-email/resend/`, the `EMAIL_VERIFICATION_*` settings, and
the `EmailVerification.is_verified` gate in
[`send_turn_reminders`](../../backend/game/management/commands/send_turn_reminders.py).
Endpoint reference:
[api.md](../architecture/api.md#post-apiauthverify-emailconfirm); the flow
end to end is in [auth.md](../architecture/auth.md#email-verification).

This ADR depends on [ADR-002](adr-002-inactivity-forfeit.md). The 48-hour
inactivity forfeit is what turned an email address from a convenience into a
load-bearing part of playing a game, and it is the reason both halves of this
decision — *required*, and *not a wall* — go the way they do.

## Context: three questions that were being answered as one

"Should we verify email addresses?" hides three separate questions, and this app
answers them differently:

1. **Does playing need an account?** **No**, and that has not changed. Guest
   seats (a null user FK) carry local, hotseat and shared-link play; the whole
   "pick a name and start" path needs no registration at all. See
   [overview.md](../architecture/overview.md).
2. **Does an *account* need an email address?** **Now yes.** Previously
   optional.
3. **Does that address need to be *proven* before the account works?** **No.**
   An unverified account is a fully working account.

Conflating them produces the usual bad outcome — a signup wall on a game that
never needed accounts in the first place. Kept separate, each has an
unremarkable answer.

## Why the address is required now

`RegisterSerializer.email` was `required=False, allow_blank=True` for most of
this app's life, and the reasoning written beside it was sound *at the time*:
requiring an address would tax the guest-friendly "pick a name, start playing"
path this app is built around.

Two things changed.

- **Guest seats now serve that path properly.** The argument was really an
  argument for *play without registration*, and that is exactly what guest seats
  deliver. It no longer reaches the registration form: what an account is *for*
  is online play, persistent stats and recovery, and all three assume the app can
  reach you.
- **[ADR-002](adr-002-inactivity-forfeit.md) gave the app a way to lose you a
  game while you are not looking.** After `TURN_TIMEOUT_HOURS` (default 48) an
  opponent may claim a forfeit. The **only** warning channel is
  `manage.py send_turn_reminders` — **mobile push does not exist anywhere in the
  tree** and is owner-blocked on EAS credentials, so email is not one
  notification channel among several, it is the notification layer. An optional
  address therefore meant shipping a mechanic that loses players games behind an
  **opt-out-by-omission** notification layer: the players least likely to have
  supplied an address are exactly the ones most likely to be forfeited.

`allow_blank=False` matters as much as `required=True` — both clients previously
sent `""` for an empty field, and a blank address is exactly as unreachable as a
missing one. `PATCH /api/auth/me/` refuses a blank address for the same reason:
an account must not be able to walk into a state the front door forbids. The two
things a user might actually want a blank address *for* have their own routes —
`turn_reminder_emails` ("stop mailing me") and `DELETE /api/auth/me/` ("remove
my address"), which removes all of it.

## Why there is no verification wall

The pattern to avoid is the familiar B2B SaaS one: *verify within N days or lose
access*. It is a poor fit twice over.

- **It is a convention from a different product category.** Consumer games and
  social apps overwhelmingly let unverified accounts work and gate a narrow set
  of capabilities instead. A hard wall is a signup funnel decision borrowed from
  products whose users are being invoiced.
- **It interacts specifically badly with this app's own clock.** A verification
  window running *concurrently* with a 48-hour turn deadline means a player who
  registers, starts a game and gets distracted for three days comes back to find
  their account locked **and** their game forfeited — punished twice, once by a
  mechanic they never saw and once by an administrative deadline that had nothing
  to do with playing. There is no version of that which reads as anything but
  the app being broken.

So verification gates **exactly one thing**: turn-reminder mail. Login, game
play, `GET`/`PATCH /api/auth/me/`, password reset, account deletion, stats,
matchmaking-by-link — all untouched, and all tested that way. The scope of the
gate is enforced in one place, a single `EmailVerification.is_verified(user)`
call inside `send_turn_reminders._process`, and that is deliberate: a gate
spread over several call sites is a gate that grows.

## Why verify at all: deliverability, not security

This is the part usually got backwards. Verification here **does not protect the
account**. It protects the *sending channel*.

`send_turn_reminders` is the only **bulk, scheduled, unprompted** sender in the
app. Everything else it mails — the password-reset link, the verification link
itself — goes to one person who asked for it seconds earlier. A cron mailing
"move now or lose" to every typo'd, mistyped and abandoned address in the table
earns bounces and spam complaints in volume; those sink the sending domain's
reputation; and a sunk reputation lands the **legitimate** reminders in spam
folders. The people harmed by unverified reminders are the players who confirmed.

The corollary is what keeps the gate narrow: **a reset link sent to an
unverified address is comparatively harmless.** Only the person reading that
mailbox can follow it, so a typo produces a dead link in a stranger's inbox, not
a compromise. That asymmetry — bulk unprompted mail is a reputation problem,
one-off requested mail is not — is the whole reason the gate sits where it does
and nowhere else.

## Sequencing: this had to land before the first cron run

None of this bites today. The reminder command is **dormant until a platform
cron is scheduled** ([railway-deploy.md step 8](../operations/railway-deploy.md#8-schedule-the-turn-reminder-cron),
tracked as owner work in
[going-live.md 1.6](../operations/going-live.md#16-backups-admin-credentials-and-the-three-dormant-subsystems)).

But it had to be built **before** that cron's first run, not after, and the
reason is one-way: **you cannot un-burn a domain reputation.** A first run
against an unfiltered table is a single irreversible event; verification added
afterwards would protect nothing that had already been spent. This is now a
recorded ordering constraint in the go-live ledger.

## Grandfathering: nothing is rewritten and nobody is locked out

Accounts that predate the requirement are left exactly as they are.

- **`RegisterSerializer` validates input; it does not audit the table.** An
  existing account with a blank address keeps working, keeps playing, and keeps
  logging in.
- **The migration adds no backfill.** Nobody has proven anything, so the correct
  value for every existing row is "unverified", and the absence of a row already
  means that.
- **Nothing regresses, provably.** No cron has ever been scheduled, so no
  reminder has ever been sent, so no player loses a notification they were
  previously receiving. The unverified state is the state everyone was already
  in.
- `send_turn_reminders` keeps its "registered seat with no address on file" skip,
  with the comment updated to say why that is still an ordinary state rather than
  an error.

## The design, as built

### `EmailVerification` — and why it stores an address, not a boolean

The model ([`models.py`](../../backend/game/models.py)) is a `OneToOneField` on
Django's stock `User`, following `UserPreferences`' conventions exactly:

- **The row is optional; absence means unverified.** The same "absence means
  defaults" convention `UserPreferences` uses, and for the same reason — there
  is nowhere to add a column to a stock `User` without swapping the model out
  from under six migrations of FKs.
- **`verified_email` stores the address that was proven**, not a `verified`
  boolean. This is the field that makes the whole thing correct.
  `is_verified(user)` compares the stored address to `user.email` **on every
  read** (case-folded, because `normalise_email` lowercases only the domain
  half). A bare boolean would stay `True` after `PATCH /api/auth/me/` moved the
  address somewhere else, and the very next cron tick would mail an unproven
  mailbox with the flag insisting it was fine. Storing the proven address makes
  **an email change self-invalidating** — no signal, no hook, no cleanup step
  anyone has to remember to call, and no way for the flag and the address to
  disagree.
- **`last_sent_at` lives on the same row**, which is why the row can exist while
  still unverified — a resend cool-down needs somewhere to live from the first
  send onwards.

### The token: signed, not stored — and deliberately not the reset generator

`EmailVerificationConfirmSerializer` uses `django.core.signing` over
`{"uid", "email"}` with `settings.EMAIL_VERIFICATION_SALT`, so there is **no
token table** to write, expire or clean up; expiry is `loads(max_age=...)`
against `EMAIL_VERIFICATION_TIMEOUT_HOURS` (default **72**).

Password reset uses `default_token_generator` instead, and the difference is the
point. That generator hashes the user's **password hash** into the token to get
single-use semantics for free — exactly right for a token that *changes a
credential*, and exactly wrong here. A user who changes their password while a
verification link is in flight should not have that link silently stop working;
the two events have nothing to do with each other.

**The address travels inside the signature.** Request a link for `a@x.com`,
`PATCH` the account to `b@y.com`, then click the old link: the token verifies —
it is genuinely ours and unexpired — but names an address the account no longer
holds, so it is refused. Without that, mail sent to `a@x.com` would prove
`b@y.com`.

### Claim-then-send, again

`issue_email_verification` in [`views.py`](../../backend/game/views.py) stamps
`last_sent_at` **before** calling the mail backend, and leaves it stamped **even
when the send fails**. That is the same ordering `send_turn_reminders` uses and
it is chosen the same way: a provider can accept a message and *then* error, so
treating a failure as "nothing was sent" turns a retry into a way to flood an
inbox. Losing one automatic mail to a genuine outage is recoverable — the resend
button is one screen away — and duplicates are not.

The per-row cool-down (`EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS`, default
**60**) is not redundant with the `email_verify_resend` throttle. Throttle
counters live in `CACHES`, which is `LocMemCache` **per gunicorn worker** unless
`REDIS_URL` is set, so on the deployment as configured today the throttle is not
actually a global limit. The database row is.

`send_email_verification` **never raises** — a mail backend having a bad
afternoon must not turn registration or an address change into a 500. The
account is created, the address is saved, the user is simply not verified yet,
which is a state the app is designed to handle.

### The two endpoints

| Route | Auth | Why |
|---|---|---|
| `POST /api/auth/verify-email/confirm/` | **none** | the link is followed from a mail client, possibly on a device that never logged in; the token already proves the only thing this endpoint cares about |
| `POST /api/auth/verify-email/resend/` | **required** | it can only ever mail the caller's own address, so unlike `PasswordResetRequestView` it has no enumeration problem and no third party to protect |

Confirm is **idempotent** — mail clients prefetch and people double-click, so the
second call is a 200, not an error. Resend answers **200 for an
already-verified account** for the same reason: a user who clicks Resend after
the link worked in another tab has done nothing wrong, and telling them it failed
would suggest their verified account is not. Confirm's failure is **one flat
message** for expired, forged and wrong-account alike, mirroring the reset
confirm: they are all "this link is no good, get another one" to the reader, and
splitting them tells a prober which guess was structurally valid.

Full status codes and bodies:
[api.md](../architecture/api.md#post-apiauthverify-emailconfirm).

## Rejected alternatives

- **Keep email optional (i.e. no account requirement at all).** This is the
  status quo ante and it is the one option that is *actively harmful* now rather
  than merely conservative: it pairs a forfeit clock with a notification layer
  that half the players are not enrolled in. Note the related-but-different
  question — *do you need an account to play?* — is still answered "no", by guest
  seats. Nothing about this decision pushes anyone through a signup form.
- **A timed lockout: "verify within N days or the account stops working."**
  Rejected on the grounds in [Why there is no verification wall](#why-there-is-no-verification-wall):
  it is a B2B SaaS convention, and here it would run a second, invisible deadline
  alongside a 48-hour turn clock, so the punishment for a three-day absence is a
  locked account *and* a forfeited game.
- **Verify before login: no session until the address is confirmed.** The
  hardest wall and the worst fit. It puts a mail round-trip between "I want to
  play backgammon" and playing backgammon, it fails completely for anyone whose
  confirmation lands in spam — which is precisely the population an unwarmed
  sending domain produces — and it buys nothing the narrow gate does not, since
  the *only* thing that needed protecting was a bulk sender. It would also make
  a mail outage an outage of registration itself.
- **A boolean `verified` flag.** Rejected for the self-invalidation reason
  [above](#emailverification--and-why-it-stores-an-address-not-a-boolean): it
  requires every future code path that touches `User.email` to remember to clear
  it, and the failure mode of forgetting is mailing an unproven address.
- **A stored token table.** Rejected as state nobody needs: a signed token needs
  no row, no expiry sweep and no cleanup command, and there is no revocation
  requirement here that would justify one.

## Consequences

- **The reminder audience is now "verified **and** opted in", not "has an
  address".** That is a smaller audience than before, deliberately, and it is
  the audience whose mail will actually arrive.
- **`FRONTEND_BASE_URL` gains a third consumer.** The verification link is
  `{FRONTEND_BASE_URL}/verify-email/{token}` (`build_email_verification_url`,
  built exactly as `build_password_reset_url` and `build_game_url` are). A wrong
  value now breaks three things.
- **The emailed link lands on the *web* client, and there is still no mobile
  deep link** — so a mobile user finishes verification in a browser, exactly as
  they finish a password reset there. Same limitation, same cause, tracked in the
  same place ([going-live.md 2.3](../operations/going-live.md#23-polish-and-hygiene)).
- **Two new throttle scopes** — `email_verify_resend` (5/hour, matching
  `password_reset` because it mails on demand) and `email_verify_confirm`
  (20/hour, matching `password_reset_confirm` because it guesses against a signed
  token). Both env-overridable, both disabled under test.
- **A go-live ordering constraint is now recorded**: verification must be live
  before the reminder cron is scheduled
  ([going-live.md 1.6](../operations/going-live.md#16-backups-admin-credentials-and-the-three-dormant-subsystems)).
- **`email_verified` is a new read-only field on every `/api/auth/me/` payload**,
  so both clients can prompt for confirmation without a second request. It is
  derived, never stored as an assertion, and flips back to `false` on its own
  when the address moves.

See [ADR-002](adr-002-inactivity-forfeit.md) for the clock this exists to warn
about, and [ADR-001](adr-001-combined-moves.md) for the other standing decision.
