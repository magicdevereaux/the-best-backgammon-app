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
