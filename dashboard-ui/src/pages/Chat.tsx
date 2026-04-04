import { useState, useRef, useEffect } from 'react';
import { Send, Zap, Brain } from 'lucide-react';
import styles from './Chat.module.css';

interface Message { role: 'user' | 'assistant'; content: string; model?: string; ms?: number; }

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [fastMode, setFastMode] = useState(true); // default: fast
  const msgsEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { msgsEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    const start = Date.now();
    try {
      const token = localStorage.getItem('aura_token') || '';
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ message: msg, fast: fastMode }),
      });
      const data = await res.json();
      const ms = Date.now() - start;
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response || data.error || 'No response',
        model: data.model,
        ms,
      }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error. Try again.' }]);
    }
    setLoading(false);
  };

  return (
    <div className={styles.page}>
      <div className={styles.chatArea}>
        <div className={styles.messages}>
          {messages.length === 0 && (
            <div className={styles.empty}>
              Ask Aura anything — schedule, emails, spending, life advice, or just chat.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`${styles.msg} ${styles[m.role]}`}>
              <div>{m.content}</div>
              {m.role === 'assistant' && m.ms && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, opacity: 0.6 }}>
                  {m.model ? m.model.split('/').pop() : ''} · {m.ms < 1000 ? `${m.ms}ms` : `${(m.ms / 1000).toFixed(1)}s`}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className={`${styles.msg} ${styles.assistant}`}>
              <span className={styles.dots}>● ● ●</span>
            </div>
          )}
          <div ref={msgsEnd} />
        </div>
        <div className={styles.inputBar}>
          <button
            onClick={() => setFastMode(f => !f)}
            title={fastMode ? 'Fast mode (quick responses)' : 'Quality mode (detailed, slower)'}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              color: fastMode ? 'var(--accent)' : 'var(--text-muted)', fontSize: 11,
            }}>
            {fastMode ? <Zap size={14} /> : <Brain size={14} />}
            {fastMode ? 'Fast' : 'Quality'}
          </button>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Ask Aura anything..."
            className={styles.input}
            autoComplete="off"
          />
          <button onClick={send} className={styles.sendBtn} disabled={loading}>
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
