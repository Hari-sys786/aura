import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn, UserPlus, Zap, User, Lock, Mail } from 'lucide-react'
import styles from './Login.module.css'

interface LoginProps {
  onLogin: (token: string, user: string) => void
}

export default function Login({ onLogin }: LoginProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as any)?.from || '/'

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [email, setEmail] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isSetup, setIsSetup] = useState(false) // no users yet → show register

  // Check if first run (no users)
  useEffect(() => {
    fetch('/api/auth/check')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.needsSetup) { setIsSetup(true); setMode('register') } })
      .catch(() => {})
  }, [])

  const reset = () => {
    setError(''); setUsername(''); setPassword(''); setConfirmPass(''); setEmail('')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (mode === 'register') {
      if (password !== confirmPass) { setError('Passwords do not match'); return }
      if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    }

    setLoading(true)
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const body: Record<string, string> = { username, password }
      if (mode === 'register' && email) body.email = email

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (data.ok && data.token) {
        const user = data.user?.username || username
        localStorage.setItem('aura_token', data.token)
        localStorage.setItem('aura_user', user)
        onLogin(data.token, user)
        navigate(from, { replace: true })
      } else {
        setError(data.error || 'Something went wrong')
      }
    } catch {
      setError('Connection failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const isLogin = mode === 'login'

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logo}>
          <div className={styles.logoIcon}><Zap size={22} strokeWidth={2.5} /></div>
          <div>
            <div className={styles.appName}>Aura</div>
            <div className={styles.appSub}>Your Invisible Life Manager</div>
          </div>
        </div>

        {/* Setup banner */}
        {isSetup && (
          <div className={styles.setupBanner}>
            <span>👋</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Welcome! Create your account</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>First account becomes the owner</div>
            </div>
          </div>
        )}

        {/* Tab switch */}
        {!isSetup && (
          <div className={styles.tabs}>
            <button className={`${styles.tab} ${isLogin ? styles.activeTab : ''}`} onClick={() => { setMode('login'); reset() }}>
              <LogIn size={14} /> Sign In
            </button>
            <button className={`${styles.tab} ${!isLogin ? styles.activeTab : ''}`} onClick={() => { setMode('register'); reset() }}>
              <UserPlus size={14} /> Register
            </button>
          </div>
        )}

        <form className={styles.form} onSubmit={submit}>
          {/* Username */}
          <div className={styles.field}>
            <label className={styles.label}>Username</label>
            <div className={styles.inputWrap}>
              <User size={15} className={styles.inputIcon} />
              <input className={styles.input} type="text" placeholder="Enter username"
                value={username} onChange={e => setUsername(e.target.value)}
                autoComplete="username" autoFocus />
            </div>
          </div>

          {/* Email (register only) */}
          {!isLogin && (
            <div className={styles.field}>
              <label className={styles.label}>Email <span style={{ opacity:0.5 }}>(optional)</span></label>
              <div className={styles.inputWrap}>
                <Mail size={15} className={styles.inputIcon} />
                <input className={styles.input} type="email" placeholder="your@email.com"
                  value={email} onChange={e => setEmail(e.target.value)}
                  autoComplete="email" />
              </div>
            </div>
          )}

          {/* Password */}
          <div className={styles.field}>
            <label className={styles.label}>Password</label>
            <div className={styles.inputWrap}>
              <Lock size={15} className={styles.inputIcon} />
              <input className={styles.input} type={showPass ? 'text' : 'password'}
                placeholder={isLogin ? 'Enter password' : 'Min 8 characters'}
                value={password} onChange={e => setPassword(e.target.value)}
                autoComplete={isLogin ? 'current-password' : 'new-password'} />
              <button type="button" className={styles.eyeBtn} onClick={() => setShowPass(p => !p)}>
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Confirm password (register only) */}
          {!isLogin && (
            <div className={styles.field}>
              <label className={styles.label}>Confirm Password</label>
              <div className={styles.inputWrap}>
                <Lock size={15} className={styles.inputIcon} />
                <input className={styles.input} type={showPass ? 'text' : 'password'}
                  placeholder="Re-enter password"
                  value={confirmPass} onChange={e => setConfirmPass(e.target.value)}
                  autoComplete="new-password" />
              </div>
            </div>
          )}

          {/* Password strength indicator */}
          {!isLogin && password.length > 0 && (
            <div className={styles.strengthWrap}>
              <div className={styles.strengthBar}>
                <div className={styles.strengthFill} style={{
                  width: `${Math.min(100, password.length * 8)}%`,
                  background: password.length < 8 ? 'var(--error)' : password.length < 12 ? 'var(--warning)' : 'var(--success)'
                }} />
              </div>
              <span style={{ color: password.length < 8 ? 'var(--error)' : password.length < 12 ? 'var(--warning)' : 'var(--success)', fontSize: 11 }}>
                {password.length < 8 ? 'Too short' : password.length < 12 ? 'Fair' : 'Strong'}
              </span>
            </div>
          )}

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className={styles.submitBtn} disabled={loading || !username || !password}>
            {loading ? <span className={styles.spinner} />
              : isLogin ? <><LogIn size={15} /> Sign In</>
              : <><UserPlus size={15} /> Create Account</>
            }
          </button>
        </form>

        {!isSetup && (
          <div className={styles.switchMode}>
            {isLogin ? "Don't have an account?" : 'Already have an account?'}
            <button className={styles.switchBtn} onClick={() => { setMode(isLogin ? 'register' : 'login'); reset() }}>
              {isLogin ? 'Register' : 'Sign In'}
            </button>
          </div>
        )}

        <div className={styles.footer}>
          🔒 Your data stays on your server. Always.
        </div>
      </div>
    </div>
  )
}
