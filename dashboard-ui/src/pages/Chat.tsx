import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Zap } from 'lucide-react'
import { format } from 'date-fns'
import { api } from '../api'
import styles from './Chat.module.css'

interface Message {
  id: string
  role: 'user' | 'ai'
  content: string
  ts: Date
}

const SUGGESTIONS = [
  'What are my upcoming bills?',
  'Summarize my emails',
  'Any expiring documents?',
  'Show my spending this month',
]

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = useCallback(async (text: string) => {
    const msg = text.trim()
    if (!msg || loading) return

    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: msg, ts: new Date() }])
    setInput('')
    setLoading(true)

    try {
      const res = await api.chat(msg)
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: res.response,
        ts: new Date(),
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: 'Sorry, I encountered an error. Please try again.',
        ts: new Date(),
      }])
    } finally {
      setLoading(false)
    }
  }, [loading])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className={`${styles.page} fade-in`}>
      <div className={styles.messages}>
        {messages.length === 0 ? (
          <div className={styles.welcome}>
            <div className={styles.welcomeIcon}>
              <Zap size={22} color="var(--accent)" />
            </div>
            <div className={styles.welcomeTitle}>Chat with Aura</div>
            <div className={styles.welcomeSub}>
              Your AI life management agent. Ask me anything about your data.
            </div>
            <div className={styles.suggestions}>
              {SUGGESTIONS.map(s => (
                <button key={s} className={styles.suggestion} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`${styles.message} ${msg.role === 'user' ? styles.user : ''}`}>
              <div className={`${styles.avatar} ${msg.role === 'ai' ? styles.ai : styles.user}`}>
                {msg.role === 'ai' ? '⚡' : 'U'}
              </div>
              <div>
                <div className={`${styles.bubble} ${msg.role === 'ai' ? styles.ai : styles.user}`}>
                  {msg.content}
                </div>
                <div className={styles.timestamp}>{format(msg.ts, 'h:mm a')}</div>
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className={styles.message}>
            <div className={`${styles.avatar} ${styles.ai}`}>⚡</div>
            <div className={styles.typing}>
              <div className={styles.typingDot} />
              <div className={styles.typingDot} />
              <div className={styles.typingDot} />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className={styles.inputArea}>
        <div className={styles.inputWrap}>
          <textarea
            ref={inputRef}
            className={styles.input}
            placeholder="Ask Aura anything…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
          />
        </div>
        <button
          className={styles.sendBtn}
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
        >
          <Send size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
