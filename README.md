# The Best Backgammon App

Django + React backgammon application. Several pieces are intentionally left
incomplete as exercises — search the codebase for `TODO` to find them all.

## Quick start

### Backend

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

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

App will be at `http://localhost:3000`. Requests to `/api/*` are proxied to
Django automatically.

## What's intentionally incomplete

| File | What to implement |
|---|---|
| `backend/game/models.py` | `Game` model fields |
| `backend/game/serializers.py` | `GameSerializer` Meta class |
| `backend/game/game_logic.py` | `roll_dice()` function |
| `frontend/src/api/gameApi.js` | All five fetch functions |
| `frontend/src/components/Board.jsx` | Board rendering logic |

## Project layout

```
backend/
  backgammon/        Django project (settings, root urls)
  game/              Django app
    models.py        Game model  ← TODO
    serializers.py   DRF serializer  ← TODO
    views.py         ViewSet + roll_dice / move_checker actions
    game_logic.py    Pure game logic  ← TODO (roll_dice)
    urls.py          Router wiring

frontend/
  src/
    api/gameApi.js         Fetch helpers  ← TODO
    components/Board.jsx   Board renderer  ← TODO
    components/Dice.jsx    Dice display (complete)
    components/GameControls.jsx
    hooks/useGame.js       State hook (complete)
    pages/GamePage.jsx
    pages/LobbyPage.jsx
```
