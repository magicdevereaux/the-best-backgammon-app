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

- We collect a **username and password**, and an **email address only if you
  choose to give us one** — it is optional, and used solely to send you a
  password-reset link. We do not ask for your phone number, real name, or date
  of birth.
- We store the **games you play**: the board position, dice, scores, and the
  display names shown on each seat.
- We do **not** use advertising, analytics, tracking pixels, crash-reporting
  services, or any third-party SDK that profiles you.
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
| Email address | **Optional.** Only stored if you choose to supply one, at registration or later from your profile. Never shown to other players. |

An email address is used for one thing only: sending you a password-reset link
when you ask for one. We do not send marketing, newsletters, or notifications.
If you do not give us an address, everything else works exactly the same — but a
forgotten password cannot then be reset, because we would have no way to check
the request came from you. See
[Limitations you should know about](#limitations-you-should-know-about).

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
- **No crash or performance reporting service.**
- **No location data**, contacts, photos, camera, microphone, calendar, or
  health data. The app requests none of these permissions.
- **No payments.** There are no purchases, subscriptions, or in-app currency, so
  we hold no payment or billing information.
- **No chat or messaging.** The app has no chat feature, so there are no
  messages to store.
- **No phone numbers.** (An email address is collected only if you volunteer
  one, and only to send password-reset links — see "Account information" above.)
- **No cross-app or cross-site tracking**, and no data brokers.

## How we use what we collect

We use your data only to run the game:

1. To sign you in and keep you signed in.
2. To run and save your games and matches so you can come back to them, and so
   your opponent sees your moves.
3. To calculate your statistics.
4. To send you a password-reset link, if you asked for one and have an email
   address on file. We send no other mail.
5. To keep the service working and secure — for example, to check that the
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
domain/DNS or CDN provider, your outbound **email/SMTP provider** (password-reset
mail is sent through one, so whoever you use handles your address), and Expo/EAS
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
game still in progress becomes unplayable for your seat.

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
