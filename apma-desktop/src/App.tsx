import { useState, useCallback } from 'react';
import { useAuthStore } from './store';
import { getStoredCredentials } from './services/api';
import SplashScreen from './screens/SplashScreen';
import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';

export default function App() {
  const { isAuthenticated, setAuth } = useAuthStore();
  const [ready, setReady] = useState(false);

  const handleSplashDone = useCallback(async () => {
    try {
      const creds = await getStoredCredentials();
      if (creds) setAuth(creds.baseUrl);
    } finally {
      setReady(true);
    }
  }, []);

  if (!ready) return <SplashScreen onDone={handleSplashDone} />;
  return isAuthenticated ? <DashboardScreen /> : <LoginScreen />;
}
