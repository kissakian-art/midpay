import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { loginPassword, setAuthToken, signup as apiSignup, type User } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  signup: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => {},
  signup: async () => {},
  logout: async () => {},
});

const KEY = "midpay.session";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { token: string; user: User };
          setAuthToken(saved.token);
          setUser(saved.user);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = async (token: string, u: User) => {
    setAuthToken(token);
    await AsyncStorage.setItem(KEY, JSON.stringify({ token, user: u }));
    setUser(u);
  };

  const login = async (phone: string, password: string) => {
    const { token, user: u } = await loginPassword(phone, password);
    await persist(token, u);
  };

  const signup = async (phone: string, password: string) => {
    const { token, user: u } = await apiSignup(phone, password);
    await persist(token, u);
  };

  const logout = async () => {
    setAuthToken(null);
    await AsyncStorage.removeItem(KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
