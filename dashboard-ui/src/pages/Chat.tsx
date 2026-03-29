import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import styles from './Chat.module.css';

interface Message { role: 'user' | 'assistant'; content: string; }

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const msgsEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { msgsEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.response || data.error || 'No response' }]);
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
              Ask Aura anything — schedule, emails, spending, documents...
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`${styles.msg} ${styles[m.role]}`}>
              {m.content}
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
