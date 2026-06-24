// Pure turn-ownership derivation, extracted from the game screen so it can be
// unit-tested without rendering the whole board.
//
// Inputs:
//   game     — the game payload (needs status, current_turn, player1_user,
//              player2_user)
//   userId   — the logged-in user's id, or null/undefined for a guest
//   seatInfo — device-local seat record { online, seats } or null (see
//              seatRegistry); catches online-vs-guest games the FKs can't.
//
// A game is "gated" (online) when it's between two distinct accounts, or when
// the seat registry says this device is in an online game. Otherwise it's a
// single-device hotseat/guest game and both seats stay interactive here.
export function computeGating({ game, userId, seatInfo }) {
  const iAmP1 =
    userId != null && game.player1_user != null && game.player1_user === userId;
  const iAmP2 =
    userId != null && game.player2_user != null && game.player2_user === userId;
  const twoAccounts =
    game.player1_user != null &&
    game.player2_user != null &&
    game.player1_user !== game.player2_user;

  let gated;
  let mySeats;
  if (twoAccounts) {
    gated = true;
    mySeats = [];
    if (iAmP1) mySeats.push("p1");
    if (iAmP2) mySeats.push("p2");
  } else if (seatInfo) {
    gated = seatInfo.online;
    mySeats = seatInfo.seats;
  } else {
    gated = false;
    mySeats = ["p1", "p2"];
  }

  const active = game.status === "active";
  const iOwnASeat = mySeats.length > 0;
  const isMyTurn = !gated || mySeats.includes(game.current_turn);
  const canInteract = active && isMyTurn;
  const spectating = gated && !iOwnASeat && active;
  const waitingForOpponent = gated && iOwnASeat && !isMyTurn && active;

  return { gated, mySeats, iOwnASeat, isMyTurn, canInteract, spectating, waitingForOpponent };
}
