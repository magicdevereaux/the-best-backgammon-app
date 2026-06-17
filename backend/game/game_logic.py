import random


def roll_dice():
    """
    Roll two six-sided dice for a backgammon turn.

    Rules:
      - Roll two dice, each producing a value from 1–6.
      - If both dice show the same number (doubles), the player gets to move
        that value FOUR times instead of two. Return a list of four identical
        values, e.g. [4, 4, 4, 4].
      - Otherwise return both values as a two-element list, e.g. [3, 5].

    Expected return type: list[int]
    """
    x = random.randint(1,6)
    y = random.randint(1,6)
    if x == y: return [x]*4
    return [x,y]


def get_initial_board_state():
    """
    Return the standard backgammon starting position.

    The board is represented as a list of 24 integers (index 0 = point 1,
    index 23 = point 24). Positive values are Player 1 checkers, negative
    values are Player 2 checkers, and 0 means the point is empty.

    Standard starting layout (from Player 1's perspective):
      Point  1:  +2  (p1 home board anchor)
      Point  6:  -5  (p2 five-point)
      Point  8:  -3  (p2 mid-point)
      Point 12:  +5  (p1 mid-point)
      Point 13:  -5  (p2 mid-point, mirror)
      Point 17:  +3  (p1 mid-point, mirror)
      Point 19:  +5  (p1 five-point, mirror)
      Point 24:  -2  (p2 home board anchor)

    Returns a dict matching the board_state JSON schema from models.py:
      {
        "points": [int, ...],   # length 24
        "bar":    {"p1": 0, "p2": 0},
        "off":    {"p1": 0, "p2": 0},
      }
    """
    points = [0] * 24
    points[0]  =  2
    points[5]  = -5
    points[7]  = -3
    points[11] =  5
    points[12] = -5
    points[16] =  3
    points[18] =  5
    points[23] = -2

    return {
        "points": points,
        "bar": {"p1": 0, "p2": 0},
        "off": {"p1": 0, "p2": 0},
    }


# ---------------------------------------------------------------------------
# Move validation and application
#
# Coordinate conventions used throughout this module:
#   - Points are numbered 1-24 (index = point - 1 in board_state["points"]).
#   - from_point == 0 means the move enters a checker from the bar.
#   - to_point == 25 means the move bears a checker off (for either player —
#     it is always interpreted relative to the moving player's home board).
#   - Player 1 moves in the direction of increasing point numbers (home
#     board = points 19-24); Player 2 moves toward decreasing point numbers
#     (home board = points 1-6).
# ---------------------------------------------------------------------------

P1 = "p1"
P2 = "p2"

DIRECTION = {P1: 1, P2: -1}

# Index ranges (0-based) of each player's home board.
HOME_INDICES = {P1: range(18, 24), P2: range(0, 6)}


def opponent(player):
    """Return the other player's identifier."""
    return P2 if player == P1 else P1


def _checker_sign(player):
    """+1 for player 1's checkers, -1 for player 2's checkers."""
    return 1 if player == P1 else -1


def _entry_point(player, die):
    """Point number (1-24) a checker enters on from the bar with the given die."""
    return die if player == P1 else 25 - die


def _bear_off_distance(player, from_point):
    """Pip distance required to bear a checker off from from_point."""
    return (25 - from_point) if player == P1 else from_point


def _is_point_open(board_state, player, point):
    """True if `player` may land a checker on the given 1-24 point."""
    value = board_state["points"][point - 1]
    return value * _checker_sign(player) >= -1


def can_bear_off(board_state, player):
    """True if all of player's checkers are in their home board and none are on the bar."""
    if board_state["bar"][player] > 0:
        return False
    sign = _checker_sign(player)
    for idx, value in enumerate(board_state["points"]):
        if value * sign > 0 and idx not in HOME_INDICES[player]:
            return False
    return True


def get_legal_moves(board_state, player, dice_values):
    """
    Return the set of legal moves for `player` given the current board and
    remaining dice, as a set of (from_point, to_point, die) tuples.

    If the player has checkers on the bar, only bar-entry moves are returned
    (entering from the bar always takes priority over other moves).
    """
    moves = set()
    if not dice_values:
        return moves

    sign = _checker_sign(player)
    distinct_dice = set(dice_values)

    if board_state["bar"][player] > 0:
        for die in distinct_dice:
            entry = _entry_point(player, die)
            if _is_point_open(board_state, player, entry):
                moves.add((0, entry, die))
        return moves

    bear_off_ok = can_bear_off(board_state, player)
    home_distances = [
        _bear_off_distance(player, idx + 1)
        for idx in HOME_INDICES[player]
        if board_state["points"][idx] * sign > 0
    ] if bear_off_ok else []
    max_home_distance = max(home_distances) if home_distances else 0

    for idx, value in enumerate(board_state["points"]):
        if value * sign <= 0:
            continue
        from_point = idx + 1
        for die in distinct_dice:
            to_point = from_point + DIRECTION[player] * die
            if 1 <= to_point <= 24:
                if _is_point_open(board_state, player, to_point):
                    moves.add((from_point, to_point, die))
            elif bear_off_ok:
                dist = _bear_off_distance(player, from_point)
                if die == dist or (die > dist and dist == max_home_distance):
                    moves.add((from_point, 25, die))

    return moves


def apply_move(board_state, player, from_point, to_point):
    """
    Apply a legal move to board_state, mutating and returning it.

    Handles entering from the bar, hitting a lone opponent checker (sending
    it to the bar), and bearing off.
    """
    points = board_state["points"]
    sign = _checker_sign(player)

    if from_point == 0:
        board_state["bar"][player] -= 1
    else:
        points[from_point - 1] -= sign

    if to_point == 25:
        board_state["off"][player] += 1
    else:
        idx = to_point - 1
        if points[idx] * sign < 0:
            # Hitting a lone opponent blot sends it to the bar.
            points[idx] = sign
            board_state["bar"][opponent(player)] += 1
        else:
            points[idx] += sign

    return board_state


def check_winner(board_state):
    """Return 'p1' or 'p2' if that player has borne off all 15 checkers, else None."""
    if board_state["off"][P1] == 15:
        return P1
    if board_state["off"][P2] == 15:
        return P2
    return None


def detect_win_type(board_state, winner):
    """
    Classify the win as 'normal' (1 pt), 'gammon' (2 pts), or 'backgammon' (3 pts).

    Gammon: loser has borne off 0 checkers.
    Backgammon: loser has borne off 0 checkers AND still has a checker on the
                bar OR in the winner's home board.
    """
    loser = opponent(winner)

    if board_state["off"][loser] > 0:
        return "normal"

    # Loser has 0 borne off — check for backgammon
    if board_state["bar"][loser] > 0:
        return "backgammon"

    loser_sign = _checker_sign(loser)
    for idx in HOME_INDICES[winner]:
        if board_state["points"][idx] * loser_sign > 0:
            return "backgammon"

    return "gammon"


WIN_POINTS = {"normal": 1, "gammon": 2, "backgammon": 3}


def win_points(win_type):
    """Return the number of points awarded for the given win type."""
    return WIN_POINTS[win_type]
