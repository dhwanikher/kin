import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAccessToken, setSignedOutHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Starts true: on a fresh page load we do not yet know whether the refresh
  // cookie will produce a session, and rendering the sign-in form before we
  // find out makes an already-signed-in user flash past a login screen.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSignedOutHandler(() => setUser(null));

    (async () => {
      try {
        const result = await api.refresh();
        if (result?.user) {
          setAccessToken(result.accessToken);
          setUser(result.user);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const adopt = useCallback((result) => {
    setAccessToken(result.accessToken);
    setUser(result.user);
    return result.user;
  }, []);

  const signIn = useCallback(
    async (email, password) => adopt(await api.post('/api/auth/login', { email, password })),
    [adopt]
  );

  const register = useCallback(
    async (name, email, password) => adopt(await api.post('/api/auth/register', { name, email, password })),
    [adopt]
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, register, signOut }),
    [user, loading, signIn, register, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
