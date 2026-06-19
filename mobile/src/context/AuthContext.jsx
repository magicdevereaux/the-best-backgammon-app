import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { fetchMe, logout as apiLogout } from "../api/auth";

// user: undefined = loading, null = guest, object = authenticated.
const AuthContext = createContext({
  user: undefined,
  updateUser: () => {},
  logout: async () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    let active = true;
    fetchMe()
      .then((u) => active && setUser(u))
      .catch(() => active && setUser(null));
    return () => {
      active = false;
    };
  }, []);

  const updateUser = useCallback((u) => setUser(u), []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
