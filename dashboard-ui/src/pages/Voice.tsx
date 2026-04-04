import { useState, useRef, useEffect, useCallback } from 'react'
import styles from './Voice.module.css'

interface Message { role: 'user' | 'assistant'; content: string; }

// Speech Recognition types
interface SpeechRecognitionEvent { results: { [index: number]: { [index: number]: { transcript: string } }; length: number }; resultIndex: number }
interface SpeechRecognitionInstance { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; onresult: ((e: SpeechRecognitionEvent) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }

const getSpeechRecognition = (): (new () => SpeechRecognitionInstance) | null => {
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export default function Voice() {
  const [messages, setMessages] = useState<Message[]>([])
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [autoListen, setAutoListen] = useState(true)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const synthRef = useRef(window.speechSynthesis)
  const msgsEnd = useRef<HTMLDivElement>(null)
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { msgsEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Speak text using browser TTS
  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      synthRef.current.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'en-IN'
      utterance.rate = 1.05
      utterance.pitch = 1.0
      // Try to find a good voice
      const voices = synthRef.current.getVoices()
      const preferred = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'))
        || voices.find(v => v.lang.startsWith('en-IN'))
        || voices.find(v => v.lang.startsWith('en'))
      if (preferred) utterance.voice = preferred
      utterance.onend = () => { setSpeaking(false); resolve() }
      utterance.onerror = () => { setSpeaking(false); resolve() }
      setSpeaking(true)
      synthRef.current.speak(utterance)
    })
  }, [])

  // Send text to Aura and get response
  const sendToAura = useCallback(async (text: string) => {
    if (!text.trim()) return
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setProcessing(true)
    try {
      const token = localStorage.getItem('aura_token') || ''
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ message: text, fast: true }),
      })
      const data = await res.json()
      const reply = data.response || data.error || 'No response'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
      setProcessing(false)
      await speak(reply)
      // Auto-listen again after speaking
      if (autoListen) startListening()
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error.' }])
      setProcessing(false)
    }
  }, [speak, autoListen])

  // Start listening
  const startListening = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition) return

    // Stop any ongoing speech
    synthRef.current.cancel()
    setSpeaking(false)

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-IN'

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let final = ''
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if ((e.results[i] as any).isFinal) final += t
        else interim += t
      }
      setTranscript((final || '' ) + interim)

      // Reset silence timer on every result
      if (silenceTimer.current) clearTimeout(silenceTimer.current)
      if (final) {
        // Wait 1.5s of silence after final result to send
        silenceTimer.current = setTimeout(() => {
          recognition.stop()
        }, 1500)
      }
    }

    recognition.onend = () => {
      setListening(false)
      const t = transcript.trim()
      if (t) {
        setTranscript('')
        sendToAura(t)
      }
    }

    recognition.onerror = (e: { error: string }) => {
      if (e.error !== 'no-speech') console.error('Speech error:', e.error)
      setListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
    setTranscript('')
  }, [sendToAura, transcript])

  // Stop listening
  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
    if (silenceTimer.current) clearTimeout(silenceTimer.current)
  }, [])

  // Toggle
  const toggleMic = () => {
    if (listening) stopListening()
    else startListening()
  }

  // Stop speaking
  const stopSpeaking = () => {
    synthRef.current.cancel()
    setSpeaking(false)
  }

  const supported = !!getSpeechRecognition()

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.avatar}>
            <span>🔱</span>
          </div>
          <div className={styles.headerInfo}>
            <div className={styles.name}>Aura</div>
            <div className={styles.status}>
              {speaking ? '🔊 Speaking...' : listening ? '🎤 Listening...' : processing ? '🧠 Thinking...' : 'Tap mic to talk'}
            </div>
          </div>
          <button
            className={styles.autoBtn}
            onClick={() => setAutoListen(a => !a)}
            title={autoListen ? 'Auto-listen ON' : 'Auto-listen OFF'}
          >
            {autoListen ? '🔄' : '⏸'}
          </button>
        </div>

        {/* Messages */}
        <div className={styles.messages}>
          {messages.length === 0 && (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>🔱</div>
              <div className={styles.emptyTitle}>Talk to Aura</div>
              <div className={styles.emptyDesc}>Tap the microphone and speak naturally. Ask about emails, spending, schedule, or just chat.</div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`${styles.msg} ${styles[m.role]}`}>
              {m.content}
            </div>
          ))}
          {transcript && (
            <div className={`${styles.msg} ${styles.user} ${styles.interim}`}>
              {transcript}
            </div>
          )}
          {processing && (
            <div className={`${styles.msg} ${styles.assistant}`}>
              <span className={styles.dots}>● ● ●</span>
            </div>
          )}
          <div ref={msgsEnd} />
        </div>

        {/* Controls */}
        <div className={styles.controls}>
          {speaking && (
            <button className={styles.stopBtn} onClick={stopSpeaking}>
              ⏹ Stop
            </button>
          )}
          {!supported ? (
            <div className={styles.unsupported}>Voice not supported in this browser. Use Chrome.</div>
          ) : (
            <button
              className={`${styles.micBtn} ${listening ? styles.micActive : ''} ${speaking ? styles.micSpeaking : ''}`}
              onClick={toggleMic}
              disabled={processing || speaking}
            >
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
