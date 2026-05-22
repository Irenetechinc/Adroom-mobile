import { useState } from 'react';
import { useAuthStore } from './store';
import { getStoredCredentials } from './services/api';
import SplashScreen from './screens/SplashScreen';
import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';

export default function App() {
  const { isAuthenticated, setAuth } = useAuthStore();
  const [ready, setReady] = useState(false);

  function handleSplashDone() {
    getStoredCredentials().then((creds) => {
      if (creds) setAuth(creds.baseUrl);
    }).finally(() => setReady(true));
  }

  if (!ready) {
    return <SplashScreen onDone={handleSplashDone} />;
  }

  return isAuthenticated ? <DashboardScreen /> : <LoginScreen />;
}
