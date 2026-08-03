// Friendly readings of raw backend / network errors.
//
// Mirrors mobile/src/api/errors.js — the two clients must tell a player the same
// story about the same 400. Keep the predicates and the copy identical.

/*
 * The claim-vs-move race.
 *
 * A move and the opponent's inactivity claim can cross in flight: you confirm a
 * turn at the moment they claim a win on time, their claim lands first, and the
 * server answers your move with a 400 saying the game was already claimed. The
 * next poll then flips the board to "finished" underneath the message.
 *
 * Nobody did anything wrong here, and the raw server sentence reads like an
 * accusation, so both clients special-case it: this predicate identifies it, and
 * TIMEOUT_CLAIMED_MESSAGE replaces the generic action-failed line.
 *
 * Matched on the message text because that is all the API gives us — every
 * refusal arrives as `{ "error": "..." }` and `request` throws it as an Error
 * (see api/apiClient.js). Deliberately loose about the exact wording, and
 * deliberately applied ONLY to gameplay actions: `claim_timeout`'s own refusals
 * ("there is nobody to claim a timeout against") would otherwise match here and
 * mean something else entirely.
 */
export function isTimeoutClaimedError(err) {
  const message = (err && err.message) || "";
  if (!/claim|forfeit/i.test(message)) return false;
  return /\b(time|timed|timeout|clock|deadline)\b/i.test(message) || /on time/i.test(message);
}

// Shown in place of that 400. Calm and non-blaming: the player did move in
// time as far as their own device was concerned, and the outcome is not
// something they can now change.
export const TIMEOUT_CLAIMED_MESSAGE =
  "Your opponent claimed the win on time just before your move reached the " +
  "server — the two crossed in transit, so this game is already over.";
