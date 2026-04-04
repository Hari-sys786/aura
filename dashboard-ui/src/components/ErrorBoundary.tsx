import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#060608', color: '#fff', padding: 24, gap: 12,
          fontFamily: 'monospace'
        }}>
          <div style={{ fontSize: 32 }}>💥</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444' }}>App crashed</div>
          <div style={{
            background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
            padding: '12px 16px', fontSize: 12, color: '#f87171',
            maxWidth: 500, wordBreak: 'break-word', whiteSpace: 'pre-wrap'
          }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack?.split('\n').slice(0, 5).join('\n')}
          </div>
          <button
            onClick={() => { localStorage.removeItem('aura_token'); window.location.href = '/login' }}
            style={{
              marginTop: 8, padding: '8px 20px', borderRadius: 8,
              background: '#e8a03e', color: '#000', border: 'none',
              cursor: 'pointer', fontWeight: 600, fontSize: 13
            }}
          >
            Clear session &amp; reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
