// Map raw backend / network errors from a join attempt to a friendly message.
// Backend join failures surface as Error(message) from the API client:
//   - "Game is not open to join."          → already started or full
//   - "player2_name is required ..."        → guest needs a name
//   - "API error: 404"                      → no such game id
export function friendlyJoinError(err) {
  const m = (err && err.message) || "";
  if (/not open to join/i.test(m)) return "That game has already started or is full.";
  if (/404|not found/i.test(m)) return "No game found with that code.";
  if (/player2_name/i.test(m)) return "Enter your name to join as a guest.";
  if (/network|fetch|timeout/i.test(m)) return "Can't reach the server. Check your connection.";
  return m || "Couldn't join that game.";
}
