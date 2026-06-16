import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchMe, logout as clearAuth } from "../api/authApi";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // undefined = initial load in progress; null = not logged in; object = logged-in user
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    fetchMe().then(setUser);
  }, []);

  const updateUser = useCallback((userData) => setUser(userData), []);

  const logout = useCallback(() => {
    clearAuth();
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
