import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { setAuthToken, verifyOtp, type User } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (phone: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => {},
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

  const login = async (phone: string, code: string) => {
    const { token, user: u } = await verifyOtp(phone, code);
    setAuthToken(token);
    await AsyncStorage.setItem(KEY, JSON.stringify({ token, user: u }));
    setUser(u);
  };

  const logout = async () => {
    setAuthToken(null);
    await AsyncStorage.removeItem(KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
