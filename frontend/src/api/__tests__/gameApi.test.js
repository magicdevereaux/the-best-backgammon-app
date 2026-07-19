import { fetchGames, fetchGame, createGame, rollDice, moveChecker, confirmTurn, offerDouble, respondToDouble } from '../gameApi';

/*
 * All tests here FAIL until you implement the functions in gameApi.js.
 * Every function currently throws "is not yet implemented".
 *
 * The tests mock global.fetch so no real network calls are made.
 * Your implementations must call fetch() and return the parsed JSON.
 *
 * Run with:
 *   cd frontend && npm test -- --testPathPattern=gameApi
 */

// Replace global fetch with a Jest mock before each test
beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Helper: build a mock Response that fetch() will return
function mockResponse(body, { ok = true, status = 200 } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// fetchGames
// ---------------------------------------------------------------------------

describe('fetchGames()', () => {
  test('calls fetch at all', async () => {
    fetch.mockReturnValueOnce(mockResponse([]));
    await fetchGames();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('makes a GET request (no method means GET, or explicit)', async () => {
    fetch.mockReturnValueOnce(mockResponse([]));
    await fetchGames();
    const [, options = {}] = fetch.mock.calls[0];
    const method = (options.method || 'GET').toUpperCase();
    expect(method).toBe('GET');
  });

  test('hits an endpoint containing "games"', async () => {
    fetch.mockReturnValueOnce(mockResponse([]));
    await fetchGames();
    const [url] = fetch.mock.calls[0];
    expect(url).toMatch(/games/);
  });

  test('returns the array the API sends back', async () => {
    const games = [{ id: 1, status: 'active' }, { id: 2, status: 'waiting' }];
    fetch.mockReturnValueOnce(mockResponse(games));
    const result = await fetchGames();
    expect(result).toEqual(games);
  });

  test('throws when the server responds with an error status', async () => {
    fetch.mockReturnValueOnce(mockResponse({}, { ok: false, status: 500 }));
    await expect(fetchGames()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// fetchGame
// ---------------------------------------------------------------------------

describe('fetchGame(id)', () => {
  test('calls fetch with the game id in the URL', async () => {
    fetch.mockReturnValueOnce(mockResponse({ id: 42 }));
    await fetchGame(42);
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('42');
  });

  test('returns the game object', async () => {
    const game = { id: 7, status: 'active', player1_name: 'Alice' };
    fetch.mockReturnValueOnce(mockResponse(game));
    const result = await fetchGame(7);
    expect(result).toEqual(game);
  });

  test('throws on 404', async () => {
    fetch.mockReturnValueOnce(mockResponse({}, { ok: false, status: 404 }));
    await expect(fetchGame(99999)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

describe('createGame(data)', () => {
  const payload = { player1_name: 'Alice', player2_name: 'Bob' };

  test('makes a POST request', async () => {
    fetch.mockReturnValueOnce(mockResponse({ id: 1, ...payload }));
    await createGame(payload);
    const [, options] = fetch.mock.calls[0];
    expect(options.method.toUpperCase()).toBe('POST');
  });

  test('sends Content-Type: application/json', async () => {
    fetch.mockReturnValueOnce(mockResponse({ id: 1 }));
    await createGame(payload);
    const [, options] = fetch.mock.calls[0];
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
  });

  test('serialises the payload as JSON in the request body', async () => {
    fetch.mockReturnValueOnce(mockResponse({ id: 1 }));
    await createGame(payload);
    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual(payload);
  });

  test('returns the created game object (with id)', async () => {
    const created = { id: 1, ...payload, status: 'waiting' };
    fetch.mockReturnValueOnce(mockResponse(created));
    const result = await createGame(payload);
    expect(result).toMatchObject({ id: 1, player1_name: 'Alice' });
  });
});

// ---------------------------------------------------------------------------
// rollDice
// ---------------------------------------------------------------------------

describe('rollDice(id)', () => {
  test('makes a POST request', async () => {
    fetch.mockReturnValueOnce(mockResponse({ dice_values: [3, 5] }));
    await rollDice(1);
    const [, options] = fetch.mock.calls[0];
    expect(options.method.toUpperCase()).toBe('POST');
  });

  test('hits the roll_dice endpoint for the given id', async () => {
    fetch.mockReturnValueOnce(mockResponse({ dice_values: [3, 5] }));
    await rollDice(42);
    const [url] = fetch.mock.calls[0];
    expect(url).toMatch(/42/);
    expect(url).toMatch(/roll_dice/);
  });

  test('returns the updated game object', async () => {
    const updated = { id: 1, dice_values: [3, 5] };
    fetch.mockReturnValueOnce(mockResponse(updated));
    const result = await rollDice(1);
    expect(result).toEqual(updated);
  });
});

// ---------------------------------------------------------------------------
// moveChecker
// ---------------------------------------------------------------------------

describe('moveChecker(id, fromPoint, toPoint)', () => {
  test('makes a POST request', async () => {
    fetch.mockReturnValueOnce(mockResponse({}));
    await moveChecker(1, 6, 8);
    const [, options] = fetch.mock.calls[0];
    expect(options.method.toUpperCase()).toBe('POST');
  });

  test('hits the move_checker endpoint for the given id', async () => {
    fetch.mockReturnValueOnce(mockResponse({}));
    await moveChecker(5, 6, 8);
    const [url] = fetch.mock.calls[0];
    expect(url).toMatch(/5/);
    expect(url).toMatch(/move_checker/);
  });

  test('sends from_point and to_point in the body', async () => {
    fetch.mockReturnValueOnce(mockResponse({}));
    await moveChecker(1, 6, 8);
    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ from_point: 6, to_point: 8 });
  });

  test('returns the updated game object', async () => {
    const updated = { id: 1, board_state: {} };
    fetch.mockReturnValueOnce(mockResponse(updated));
    const result = await moveChecker(1, 1, 2);
    expect(result).toEqual(updated);
  });
});

// ---------------------------------------------------------------------------
// confirmTurn
// ---------------------------------------------------------------------------

describe('confirmTurn(id, moves)', () => {
  const moves = [{ from_point: 1, to_point: 2 }, { from_point: 2, to_point: 4 }];

  test('makes a POST request', async () => {
    fetch.mockReturnValueOnce(mockResponse({}));
    await confirmTurn(1, moves);
    const [, options] = fetch.mock.calls[0];
    expect(options.method.toUpperCase()).toBe('POST');
  });

  test('hits the confirm_turn endpoint for the given id', async () => {
    fetch.mockReturnValueOnce(mockResponse({}));
    await confirmTurn(5, moves);
    const [url] = fetch.mock.calls[0];
    expect(url).toMatch(/5/);
    expect(url).toMatch(/confirm_turn/);
  });

  test('sends the moves array in the body', async () => {
    fetch.mockReturnValueOnce(mockResponse({}));
    await confirmTurn(1, moves);
    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ moves });
  });

  test('returns the updated game object', async () => {
    const updated = { id: 1, board_state: {}, current_turn: 'p2', dice_values: [] };
    fetch.mockReturnValueOnce(mockResponse(updated));
    const result = await confirmTurn(1, moves);
    expect(result).toEqual(updated);
  });

  test('throws and surfaces the server error message on an illegal move', async () => {
    fetch.mockReturnValueOnce(mockResponse({ error: 'Illegal move.' }, { ok: false, status: 400 }));
    await expect(confirmTurn(1, moves)).rejects.toThrow('Illegal move.');
  });
});

// ---------------------------------------------------------------------------
// offerDouble / respondToDouble
// ---------------------------------------------------------------------------

describe('offerDouble(id)', () => {
  test('POSTs to the offer_double endpoint for the given id', async () => {
    fetch.mockReturnValueOnce(mockResponse({}));
    await offerDouble(7);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/7/);
    expect(url).toMatch(/offer_double/);
    expect(options.method.toUpperCase()).toBe('POST');
  });

  test('surfaces the server error on an illegal offer', async () => {
    fetch.mockReturnValueOnce(
      mockResponse({ error: 'You can only double before rolling.' }, { ok: false, status: 400 })
    );
    await expect(offerDouble(1)).rejects.toThrow('You can only double before rolling.');
  });
});

describe('respondToDouble(id, accept)', () => {
  test('POSTs the accept flag to the respond_to_double endpoint', async () => {
    fetch.mockReturnValueOnce(mockResponse({}));
    await respondToDouble(3, true);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/3/);
    expect(url).toMatch(/respond_to_double/);
    expect(JSON.parse(options.body)).toEqual({ accept: true });
  });

  test('sends accept: false for a drop', async () => {
    fetch.mockReturnValueOnce(mockResponse({}));
    await respondToDouble(3, false);
    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ accept: false });
  });
});
