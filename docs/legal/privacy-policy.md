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

- We collect a **username and password**. We do not ask for your email address,
  phone number, real name, or date of birth.
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

The account system does not request or require an email address. If you forget
your password there is currently **no self-service password reset** — see
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
- **No email addresses** or phone numbers.
- **No cross-app or cross-site tracking**, and no data brokers.

## How we use what we collect

We use your data only to run the game:

1. To sign you in and keep you signed in.
2. To run and save your games and matches so you can come back to them, and so
   your opponent sees your moves.
3. To calculate your statistics.
4. To keep the service working and secure — for example, to check that the
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
domain/DNS or CDN provider, and Expo/EAS if you use their build or update
services. If you add push notifications, error tracking, or analytics later,
they must be listed here and the "What we do NOT collect" section corrected.]`

Apple and Google distribute the mobile app through their stores and collect
their own data about downloads under their own privacy policies, which we do not
control.

## How long we keep data

Accounts and game records are kept until they are deleted. `[TODO: state a
retention policy, e.g. "Accounts inactive for 24 months are deleted", or say
plainly that data is kept indefinitely until deletion is requested.]`

## Your choices and rights

### Account deletion

> **`[TODO — REQUIRED BEFORE STORE SUBMISSION]`** Account deletion is **not
> implemented in the API today**. There is no endpoint that deletes a user
> account or its associated game records. Both the Apple App Store and Google
> Play require an in-app path to account deletion for apps that support account
> creation.
>
> Until that is built, this section must not claim self-service deletion. The
> minimum honest interim wording is: *"To delete your account and its game
> records, email `[TODO: contact email]` from the account you wish to delete
> and we will action it manually within `[TODO: number]` days."* — and you must
> actually be able to honour that, by hand, in the Django admin. The permanent
> fix is a delete endpoint plus a delete button in both clients.

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
- **Some game records can currently be modified or deleted by any caller** of
  the API, not only by the players in the game. This is a known defect we are
  working to close; it is recorded in our engineering notes.
- **Game data is readable without authentication**, as described above.
- **There is no password reset** and no recovery email on file. If you lose your
  password, the account cannot currently be recovered.
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
