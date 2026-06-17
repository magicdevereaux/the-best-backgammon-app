# The Best Backgammon App

A full-stack backgammon app — Django REST API + React frontend. Supports hotseat play, online games with shareable links, user accounts, match modes, and gammon/backgammon detection.

## Features

- **Full backgammon rules** — bar entry, bearing off, hitting blots, doubles
- **Move staging** — tentative moves with legal-move highlighting before confirming a turn
- **Single game mode** — play until one player bears off all 15 checkers
- **Match mode** — first to reach 3, 5, 7, or 9 points wins the match
- **Gammon / backgammon detection** — worth 2 and 3 points respectively
- **Game over screen** — shows win type, points awarded, and running match score
- **User accounts** — register/login, JWT auth, win/loss and stats tracking
- **Profile page** — lifetime stats: games, wins, losses, gammons, backgammons, points won/lost, win %, gammon rate
- **Lobby** — create online games with a shareable link, or play hotseat as a guest

## Quick start

### Backend

```bash
cd backend

python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

API will be at `http://localhost:8000/api/`.

### Frontend

```bash
cd frontend
npm install
npm start
```

App will be at `http://localhost:3000`. Requests to `/api/*` are proxied to Django automatically.

### Resetting the dev database

The dev database is a local SQLite file. If you need to reset it (e.g. after adding new migrations):

1. Stop the Django dev server (Ctrl+C in the terminal where it's running)
2. Delete `backend/db.sqlite3`
3. Run `python manage.py migrate` again

## Running tests

```bash
cd backend
source venv/Scripts/activate   # or venv\Scripts\activate on Windows
python manage.py test game.tests
```

The test runner uses an in-memory database, so you don't need to reset the dev DB to run tests.

## Project layout

```
backend/
  backgammon/          Django project (settings, root urls)
  game/
    models.py          Game and Match models
    serializers.py     DRF serializers (GameSerializer, MatchSerializer, UserSerializer)
    views.py           ViewSets — GameViewSet, MatchViewSet, auth views
    game_logic.py      Pure game logic (moves, bear-off, win detection, gammon detection)
    urls.py            Router wiring
    migrations/        Django migrations
    tests/
      test_views.py    Game endpoint tests (141 tests)
      test_auth.py     Auth + user stats tests
      test_lobby.py    Lobby / join flow tests
      test_match.py    Match, gammon/backgammon detection, score tracking tests

frontend/src/
  api/
    apiClient.js       Shared fetch helper (JWT injection, silent refresh)
    gameApi.js         Game endpoint wrappers
    matchApi.js        Match endpoint wrappers
    authApi.js         Auth endpoint wrappers
  components/
    Board.jsx          Board renderer with legal-move highlighting
    Dice.jsx           Dice display
    GameControls.jsx   Roll / Reset / Confirm buttons
    GameOverScreen.jsx End-of-game modal (win type, points, match score)
    MatchScore.jsx     In-game match score display
  hooks/
    useGame.js         Game state hook with staged turn management
  pages/
    LobbyPage.jsx      Lobby with hotseat, online game, and match creation
    GamePage.jsx       Active game view
    ProfilePage.jsx    User stats
    LoginPage.jsx
    RegisterPage.jsx
  context/
    AuthContext.jsx    JWT auth state
```

## API overview

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register/` | Create account |
| POST | `/api/auth/login/` | Get JWT tokens |
| POST | `/api/auth/refresh/` | Refresh access token |
| GET | `/api/auth/me/` | Current user + stats |
| GET/POST | `/api/games/` | List games / create game |
| GET | `/api/games/?status=waiting` | Open lobby games |
| POST | `/api/games/{id}/join/` | Join a waiting game |
| POST | `/api/games/{id}/roll_dice/` | Roll dice for current turn |
| POST | `/api/games/{id}/confirm_turn/` | Commit staged moves |
| GET/POST | `/api/matches/` | List matches / create match |
| GET | `/api/matches/{id}/` | Match detail + current score |
| POST | `/api/matches/{id}/next_game/` | Start the next game in a match |
| POST | `/api/matches/{id}/join/` | Join a waiting match |

## Gammon / backgammon rules

A **gammon** is worth 2 points: the winner bore off all 15 checkers before the loser bore off any.

A **backgammon** is worth 3 points: the loser still has a checker on the bar or in the winner's home board when the winner finishes.

A normal win is worth 1 point.

In match mode, games continue until one player accumulates enough points to reach the target. The winner of each game goes first in the next.
