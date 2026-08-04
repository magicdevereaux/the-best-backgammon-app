# Privacy Policy

**DRAFT — not yet reviewed by a lawyer. See [README.md](README.md) before publishing.**

**Effective date:** `[TODO: effective date, e.g. 1 September 2026]`
**Last updated:** `[TODO: last-updated date]`

This policy explains what The Best Backgammon App ("the App") collects, why, and
what you can do about it. It describes the App as it is actually built — it does
not reserve rights to data we do not collect.

The App is operated by `[TODO: legal entity name — individual or registered
company, e.g. "Jane Doe" or "Devereaux Software Ltd"]` ("we", "us"), contactable
at `[TODO: contact email address]`.

## Short version

- We collect a **username and password**, and an **email address**, which is
  required to register — used only for three things: confirming the address
  itself, sending you a password-reset link, and reminding you when a game is
  waiting on your
  move. We do not ask for your phone number, real name, or date of birth.
- **You can play without giving us an email address at all**, and everything
  except password recovery and those reminders works the same way.
- **Turn reminders are on by default** for accounts that have an address, and you
  can switch them off at any time from your profile in either app. Every reminder
  we send says so and tells you where the switch is.
- We store the **games you play**: the board position, dice, scores, and the
  display names shown on each seat.
- Neither app contains advertising, analytics, tracking pixels, a crash-reporting
  SDK, or any third-party SDK that profiles you. (Server-side error reporting is
  covered in [What we do NOT collect](#what-we-do-not-collect).)
- We do **not** sell or share your data with third parties for their own
  purposes.
- Game records, including the display names on them, are **publicly readable**
  through the App's API. Do not use a display name you would not want a stranger
  to see.

## What we collect

### Account information

When you register an account, we store:

| Data | Notes |
|------|-------|
| Username | Chosen by you. Shown to your opponents. |
| Password | Stored only as a salted **hash** (Django's default password hasher). We cannot read your password. |
| Account creation date | Recorded automatically when the account is created. |
| Email address | **Required to register**, and changeable later from your profile. Never shown to other players. You can play without giving us one at all by using hotseat or guest seats, which need no account. Accounts created before we required an address may still have none. |
| Email confirmation | Whether you have confirmed your address, when you confirmed it, which address you confirmed, and when we last sent you a confirmation link. Used only to decide whether we may send you turn reminders. |
| Email preferences | Whether you want turn-reminder emails. Stored only once you change it — until then we simply treat it as "on", the default. |

An email address is used for exactly three things, all about your own account and
your own games:

1. **Confirming the address** — one link, sent when you register and again if you
   change your address or ask us to resend it. Confirming is what lets us send
   you turn reminders; nothing else about your account depends on it, and you can
   play normally without ever confirming.
2. **Password reset** — sending you a reset link when you ask for one. We only
   ever send this because you asked for it.
3. **Turn reminders** — only ever to a **confirmed** address, and telling you that a game is waiting on you and roughly how
   long you have left to play before your opponent can claim the win. **At most
   one such message per turn**, only for games you are actually playing, and only
   when your time to move is genuinely running low. You did not ask for these
   individually, so you can turn them off — see
   [Turn reminders, and how to switch them off](#turn-reminders-and-how-to-switch-them-off).

We do not send marketing or newsletters, we do not share your address with
anyone, and we never show it to other players. **No email address is required to
play.** If you do not give us one, everything else works exactly the same — you
simply get no reminders, and a forgotten password cannot then be reset, because
we would have no way to check the request came from you. See
[Limitations you should know about](#limitations-you-should-know-about).

### Turn reminders, and how to switch them off

If your account has an email address, turn reminders are **on by default**. We
default them on because they are about a game you are already playing, on a clock
that can cost you the game while you are not looking — but we also make them easy
to refuse, because you gave us the address for password reset rather than for
game mail.

**To switch them off:** open your **profile** in the web app or the mobile app
and turn off **"Turn reminder emails"**. The change takes effect immediately, and
you can turn it back on the same way. Every reminder we send carries a footer
that says why you received it and names that exact setting.

Switching reminders off does not affect anything else: your games, your
statistics, and password reset all continue to work, and you will still see the
countdown inside the app.

We do not use a tracking pixel or an "unsubscribe" link in these messages. The
setting sits behind the login you already have, which is one fewer way for
anybody else to change your preferences.

### Gameplay data

For every game and match, we store:

- The **display names** entered for each seat (these may be your username, or
  any free text a player typed for a guest).
- The **board position**, dice values, whose turn it is, and the doubling-cube
  state.
- The **result**: winner, win type (single / gammon / backgammon / dropped
  double), points, and match scores.
- Timestamps for when the game or match was created and last updated.
- A link between a game seat and your account, if you were signed in when you
  took that seat.

### Statistics

Your win/loss record, gammon and backgammon counts, points won and lost, and win
percentage are **calculated on demand** from your finished games. They are not
stored as a separate profile — deleting the underlying games would change them.

### Authentication tokens

Signing in issues a short-lived access token (valid one hour) and a refresh
token (valid seven days). These are stored **on your own device**: in browser
`localStorage` on the web, and in the operating system's secure keystore
(Keychain / Keystore, via `expo-secure-store`) in the mobile app. They are sent
to our server with each request to prove who you are. Signing out deletes them
from your device.

The mobile app also keeps a small **device-local record of which seats you are
playing**, so it knows which controls to show you. It stays on your device.

### Technical data

Our server, and the hosting provider it runs on, may keep standard web-server
logs — IP address, timestamp, requested URL, and user agent — for operating and
securing the service. `[TODO: name your hosting provider and the country/region
your servers and logs are located in, e.g. "Hosted on Fly.io in the EU (Frankfurt)".
Also state your log retention period, e.g. "Logs are retained for 30 days".]`

## What we do NOT collect

To be explicit, because app stores ask and because these are genuine absences in
the code, not policy promises:

- **No advertising and no ad identifiers.** There is no ad SDK in the app.
- **No analytics or telemetry SDK.** We do not measure your behaviour in-app.
- **No crash or performance reporting SDK in either app.** Neither the web client
  nor the mobile app contains one, so nothing on your device reports your
  behaviour or your crashes to anyone.

  > **`[TODO — CHECK THIS BEFORE YOU PUBLISH]`** This bullet is about the *apps*,
  > and that half is unconditionally true. The **server** is a different matter:
  > error reporting to **Sentry** is wired into the backend and switches on the
  > moment a `SENTRY_DSN` is configured. It is not configured today, so nothing is
  > sent anywhere — but if you set that variable when you deploy, Sentry becomes a
  > service provider that may receive the contents of a failed request, and it
  > must be named in [Service providers](#service-providers) below. Decide, then
  > either say so there or delete this notice.
- **No location data**, contacts, photos, camera, microphone, calendar, or
  health data. The app requests none of these permissions.
- **No payments.** There are no purchases, subscriptions, or in-app currency, so
  we hold no payment or billing information.
- **No chat or messaging.** The app has no chat feature, so there are no
  messages to store.
- **No phone numbers.** (An email address is collected to confirm the address,
  send password-reset links and send turn reminders — see "Account information"
  above.)
- **No marketing email, no newsletter, and no mailing list.** The only messages
  we ever send are the three described above, and one of them is switchable.
- **No cross-app or cross-site tracking**, and no data brokers.

## How we use what we collect

We use your data only to run the game:

1. To sign you in and keep you signed in.
2. To run and save your games and matches so you can come back to them, and so
   your opponent sees your moves.
3. To calculate your statistics.
4. To send you a link confirming your email address — when you register, when
   you change the address, and when you ask us to send another.
5. To send you a password-reset link, if you asked for one and have an email
   address on file.
6. To email you a turn reminder when a game is waiting on your move and your time
   to play it is running out — if you have **confirmed** your address and have not
   switched reminders off. At most one message per turn.

   We send no other mail. In particular we do not email you about other people's
   games, about new features, or about anything we would like you to buy.
6. To keep the service working and secure — for example, to check that the
   person making a move is the player whose turn it is, and to investigate abuse
   or technical faults.

We do not profile you, target advertising at you, or make automated decisions
about you.

## Who can see your data

- **Your opponent** sees the display name on your seat and every move you make.
  That is the game.
- **Anyone**, including people without an account, can currently read game
  records — including the display names on them and their results — through the
  App's public API and the list of open games. Online games are joined via a
  shareable link or code, so anyone holding that link can join or watch the
  game. **Choose a display name accordingly.**
- Your **password hash is never exposed** by the API, and neither is your token.
- Administrators of the service can see stored data through the Django admin
  interface, and will only do so to operate, support, or debug the service.

We do **not** sell your data, and we do not share it with third parties for
their own marketing or profiling. We may disclose data if we are legally
required to, or where it is necessary to protect the service or its users.

## Service providers

Running the App involves `[TODO: list every third party that actually processes
data on your behalf — your hosting/server provider, your database host, your
domain/DNS or CDN provider, your outbound **email/SMTP provider** (both the
password-reset mail and the turn reminders are sent through one, so whoever you
use handles your address), and Expo/EAS
if you use their build or update services. If you add push notifications, error
tracking, or analytics later, they must be listed here and the "What we do NOT
collect" section corrected.]`

Apple and Google distribute the mobile app through their stores and collect
their own data about downloads under their own privacy policies, which we do not
control.

## How long we keep data

Accounts and game records are kept until they are deleted. `[TODO: state a
retention policy, e.g. "Accounts inactive for 24 months are deleted", or say
plainly that data is kept indefinitely until deletion is requested.]`

## Your choices and rights

### Account deletion

You can delete your account at any time from the profile screen in either the
web app or the mobile app. You will be asked to re-enter your password to
confirm. Deletion takes effect immediately and signs you out everywhere.

Deleting your account **unlinks it from your past games rather than erasing
them.** Your chosen display name, the boards you played, and the results stay
visible to your opponents, so their own game history is not damaged by your
decision. Games you had created but nobody had joined are removed entirely. Any
game still in progress becomes unplayable for your seat. Your email address, your
password hash and your saved email preferences are deleted outright — with the
address gone, no further mail of any kind can reach you.

> **`[TODO — REQUIRED BEFORE STORE SUBMISSION]`** In-app deletion exists, but
> Google Play additionally requires a **web-accessible account-deletion request
> URL** that a person can use without installing the app. That page cannot exist
> until the service is hosted. Publish one, link it here, and then delete this
> notice. Confirm the two paragraphs above still match what you ship.

### Other rights

Depending on where you live — for example under the **GDPR** in the UK and EU,
or the **CCPA/CPRA** in California — you may have the right to access, correct,
export, or delete your data, and to object to some processing. To exercise any
of these, contact `[TODO: contact email]`. We will respond within the period
required by the applicable law.

`[TODO: confirm which of these regimes actually apply to you — that depends on
where you and your users are. If you serve EU/UK users you should also state
your lawful basis for processing (performance of a contract, for running the
game you asked us to run, and legitimate interests, for security) and name an EU
or UK representative if one is required of you.]`

### Other controls

- You can play the App **without an account** using hotseat and guest seats.
  Guest seats are not linked to any identity.
- You can play **without giving us an email address** by using hotseat or guest
  seats, which need no account at all. A registered account does require an
  address, and you can change it later from your profile — but you cannot blank
  it, because registration requires one. If you want the address gone, delete the
  account (see below), which removes it along with everything else. If you only
  want the mail to stop, switch off turn reminders.
- You can leave your address **unconfirmed** indefinitely. Nothing is locked or
  taken away; the only consequence is that we will not send you turn reminders.
- You can **switch off turn-reminder emails** from your profile at any time, from
  either app. See
  [Turn reminders, and how to switch them off](#turn-reminders-and-how-to-switch-them-off).
- You can sign out at any time, which removes your tokens from your device.
- You can choose any display name you like for a guest seat.

## Children

The App is not directed at children and we do not knowingly collect data from
children under `[TODO: age threshold — commonly 13 under COPPA in the US, or 16
in parts of the EU. This should match the age rating you declare on the App
Store and Play Store.]`. If you believe a child has created an account, contact
us at `[TODO: contact email]` and we will delete it.

## Security

We protect your password with industry-standard salted hashing, authenticate
requests with signed tokens, and check server-side that the player making a move
is the player whose turn it is.

### Limitations you should know about

We would rather tell you than imply a level of protection we do not have:

- **Guest seats cannot be verified.** A seat not tied to a registered account has
  no identity behind it, so we cannot prevent someone else from acting on a guest
  seat in a game they can reach. Sign in and use a registered seat if that
  matters to you.
- **Game data is readable without authentication**, as described above. Anyone
  who has a game's link or id can read that game's full state; this is how an
  online game is shared and joined.
- **Password recovery depends on you giving us an email address.** Adding one is
  optional, and if there is no address on your account we have no way to verify
  that a reset request is really yours — so an account with no email on file
  cannot be recovered if you lose the password.
- No system is perfectly secure. Please do not reuse a password you use anywhere
  else, and do not put sensitive information in a display name.

`[TODO: once the items above are fixed, update this section — it must keep
describing the service as it actually is, not as intended.]`

## International transfers

Your data is stored on servers located in `[TODO: country/region]`. If you use
the App from elsewhere, your data will be transferred to and processed there.
`[TODO: if you serve EU/UK users from outside the EU/UK, name the transfer
mechanism you rely on, e.g. Standard Contractual Clauses.]`

## Changes to this policy

If we change this policy we will update the "Last updated" date above and, for
material changes, give notice in the App before the change takes effect.

## Contact

Questions, requests, or complaints: `[TODO: contact email address]`
`[TODO: postal address — the App Store and some privacy laws expect one for a
business operator.]`

`[TODO: if you are subject to the GDPR, add the right to lodge a complaint with
your local supervisory authority, e.g. the ICO in the UK.]`
