/* Jest setup: in-memory mock for SecureStore so token/seat persistence works
   in tests without native modules. */
jest.mock("expo-secure-store", () => {
  const store = {};
  return {
    getItemAsync: jest.fn(async (k) => (k in store ? store[k] : null)),
    setItemAsync: jest.fn(async (k, v) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k) => { delete store[k]; }),
  };
});
