import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Emails from './pages/Emails';
import Finance from './pages/Finance';
import Reminders from './pages/Reminders';
import CalendarPage from './pages/CalendarPage';
import Documents from './pages/Documents';
import Subscriptions from './pages/Subscriptions';
import Chat from './pages/Chat';
import Voice from './pages/Voice';
import Settings from './pages/Settings';

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('aura_token'))
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!token) { setChecking(false); return }
    fetch('/api/auth/check', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.ok || d?.needsSetup) {
          localStorage.removeItem('aura_token')
          localStorage.removeItem('aura_user')
          setToken(null)
        }
      })
      .catch(() => { localStorage.removeItem('aura_token'); setToken(null) })
      .finally(() => setChecking(false))
  }, [token])

  const handleLogin = (tok: string, _user: string) => setToken(tok)

  // Loading spinner while verifying token
  if (checking) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--bg)'
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
          animation: 'spin 0.7s linear infinite'
        }} />
      </div>
    )
  }

  return (
    <Routes>
      {/* Public route */}
      <Route
        path="/login"
        element={token ? <Navigate to="/" replace /> : <Login onLogin={handleLogin} />}
      />

      {/* Protected routes — all wrapped in Layout */}
      <Route
        element={
          <ProtectedRoute token={token}>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Overview />} />
        <Route path="/emails" element={<Emails />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/reminders" element={<Reminders />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/subscriptions" element={<Subscriptions />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/voice" element={<Voice />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* Catch-all: redirect to home (protected) or login */}
      <Route path="*" element={<Navigate to={token ? '/' : '/login'} replace />} />
    </Routes>
  )
}
