import { useEffect, useState } from 'react';
import { useAuthStore } from './store';
import { getStoredCredentials } from './services/api';
import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';

export default function App() {
  const { isAuthenticated, setAuth } = useAuthStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getStoredCredentials().then((creds) => {
      if (creds) setAuth(creds.baseUrl);
    }).finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#0f172a', color:'#94a3b8', fontSize:14 }}>
        Initialising APMA…
      </div>
    );
  }

  return isAuthenticated ? <DashboardScreen /> : <LoginScreen />;
}
