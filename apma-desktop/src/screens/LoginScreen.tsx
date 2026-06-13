import { useState } from 'react';
import { saveCredentials, apmaApi } from '../services/api';
import { useAuthStore } from '../store';

export default function LoginScreen() {
  const { setAuth } = useAuthStore();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey]   = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!baseUrl || !apiKey) { setError('Both fields are required.'); return; }
    setLoading(true);
    setError('');
    try {
      await saveCredentials(baseUrl.trim(), apiKey.trim());
      await apmaApi.dashboard();
      setAuth(baseUrl.trim());
    } catch (err: any) {
      await saveCredentials('', '');
      setError(err.message || 'Connection failed. Check your backend URL and API key.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f172a', padding:24 }}>
      <div style={{ width:'100%', maxWidth:420 }}>
        <div style={{ textAlign:'center', marginBottom:40 }}>
          <div style={{ fontSize:36, marginBottom:8 }}>🎯</div>
          <h1 style={{ fontSize:28, fontWeight:900, color:'#f1f5f9', letterSpacing:'-0.02em' }}>APMA</h1>
          <p style={{ color:'#6366f1', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.15em', marginTop:4 }}>Autonomous Political Marketing Agent</p>
          <p style={{ color:'#475569', fontSize:11, marginTop:4 }}>from AdRoom AI</p>
        </div>

        <form onSubmit={handleLogin} className="card" style={{ display:'flex', flexDirection:'column', gap:20 }}>
          <div>
            <label>Backend URL</label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://backend.adroomai.com"
            />
          </div>
          <div>
            <label>APMA API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Your 64-character API key"
              autoComplete="current-password"
            />
          </div>
          {error && (
            <div style={{ background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.3)', borderRadius:8, padding:'10px 14px', color:'#ef4444', fontSize:13 }}>
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width:'100%', justifyContent:'center' }}>
            {loading ? 'Connecting…' : 'Connect to APMA'}
          </button>
        </form>

        <p style={{ textAlign:'center', color:'#475569', fontSize:12, marginTop:20 }}>
          Credentials are stored securely on this device only.<br />
          Contact your administrator for your API key.
        </p>
      </div>
    </div>
  );
}
