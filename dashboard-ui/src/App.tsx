import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Emails from './pages/Emails';
import Finance from './pages/Finance';
import Reminders from './pages/Reminders';
import CalendarPage from './pages/CalendarPage';
import Documents from './pages/Documents';
import Subscriptions from './pages/Subscriptions';
import Chat from './pages/Chat';
import Settings from './pages/Settings';

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('aura_token'))
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!token) { setChecking(false); return }
    // Verify token is still valid
    fetch('/api/auth/check', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { localStorage.removeItem('aura_token'); setToken(null) }
      })
      .catch(() => { localStorage.removeItem('aura_token'); setToken(null) })
      .finally(() => setChecking(false))
  }, [token])

  if (checking) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
        <div style={{ width:32, height:32, borderRadius:'50%', border:'2px solid var(--border)', borderTopColor:'var(--accent)', animation:'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  if (!token) {
    return <Login onLogin={(tok, _user) => setToken(tok)} />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/emails" element={<Emails />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/reminders" element={<Reminders />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/subscriptions" element={<Subscriptions />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
