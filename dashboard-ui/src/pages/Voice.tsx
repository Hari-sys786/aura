import { useState, useRef, useEffect, useCallback } from 'react'
import styles from './Voice.module.css'

interface Message { role: 'user' | 'assistant'; content: string }

interface SpeechRecognitionEvent { results: { [i: number]: { [j: number]: { transcript: string }; isFinal?: boolean }; length: number }; resultIndex: number }
interface SR { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; onresult: ((e: SpeechRecognitionEvent) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }

const getSR = (): (new () => SR) | null => { const w = window as any; return w.SpeechRecognition || w.webkitSpeechRecognition || null }

export default function Voice() {
  const [messages, setMessages] = useState<Message[]>([])
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [currentReply, setCurrentReply] = useState('')
  const [autoListen, setAutoListen] = useState(true)
  const recRef = useRef<SR | null>(null)
  const synth = useRef(window.speechSynthesis)
  const msgsEnd = useRef<HTMLDivElement>(null)
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finalTranscript = useRef('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { msgsEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, currentReply])

  // Speak with sentence chunking — starts speaking first sentence while rest streams
  const speakQueue = useRef<string[]>([])
  const isSpeaking = useRef(false)

  const speakNext = useCallback(() => {
    if (speakQueue.current.length === 0) { isSpeaking.current = false; setSpeaking(false); return }
    isSpeaking.current = true
    setSpeaking(true)
    const text = speakQueue.current.shift()!
    synth.current.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-IN'
    u.rate = 1.1
    const voices = synth.current.getVoices()
    const v = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'))
      || voices.find(v => v.lang.startsWith('en-IN'))
      || voices.find(v => v.lang.startsWith('en'))
    if (v) u.voice = v
    u.onend = () => speakNext()
    u.onerror = () => speakNext()
    synth.current.speak(u)
  }, [])

  const queueSpeak = useCallback((text: string) => {
    speakQueue.current.push(text)
    if (!isSpeaking.current) speakNext()
  }, [speakNext])

  // Streaming send to Aura
  const sendToAura = useCallback(async (text: string) => {
    if (!text.trim()) return
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setProcessing(true)
    setCurrentReply('')
    speakQueue.current = []

    const controller = new AbortController()
    abortRef.current = controller
    let full = ''
    let sentenceBuffer = ''

    try {
      const token = localStorage.getItem('aura_token') || ''
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error.' }])
        setProcessing(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const { token: tok } = JSON.parse(data)
            if (tok) {
              full += tok
              sentenceBuffer += tok
              setCurrentReply(full)

              // Check for sentence boundary — speak each sentence as it completes
              const sentenceEnd = sentenceBuffer.match(/[.!?]\s/)
              if (sentenceEnd) {
                const idx = sentenceBuffer.indexOf(sentenceEnd[0]) + 1
                const sentence = sentenceBuffer.slice(0, idx).trim()
                sentenceBuffer = sentenceBuffer.slice(idx)
                if (sentence) queueSpeak(sentence)
              }
            }
          } catch { /* skip */ }
        }
      }

      // Speak remaining buffer
      if (sentenceBuffer.trim()) queueSpeak(sentenceBuffer.trim())

      setMessages(prev => [...prev, { role: 'assistant', content: full || 'No response' }])
      setCurrentReply('')
      setProcessing(false)

      // Wait for speech to finish, then auto-listen
      const waitForSpeech = () => {
        if (!isSpeaking.current && speakQueue.current.length === 0) {
          if (autoListen) setTimeout(() => startListening(), 300)
        } else {
          setTimeout(waitForSpeech, 200)
        }
      }
      waitForSpeech()

    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error.' }])
      }
      setProcessing(false)
    }
  }, [queueSpeak, autoListen])

  // Start listening
  const startListening = useCallback(() => {
    const SpeechRec = getSR()
    if (!SpeechRec) return
    synth.current.cancel()
    setSpeaking(false)
    isSpeaking.current = false
    speakQueue.current = []

    const rec = new SpeechRec()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-IN'
    finalTranscript.current = ''

    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if ((e.results[i] as any).isFinal) finalTranscript.current += t
        else interim += t
      }
      setTranscript(finalTranscript.current + interim)

      if (silenceTimer.current) clearTimeout(silenceTimer.current)
      if (finalTranscript.current) {
        silenceTimer.current = setTimeout(() => rec.stop(), 1500)
      }
    }

    rec.onend = () => {
      setListening(false)
      const t = finalTranscript.current.trim()
      setTranscript('')
      if (t) sendToAura(t)
    }

    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') console.error('Speech error:', e.error)
      setListening(false)
    }

    recRef.current = rec
    rec.start()
    setListening(true)
    setTranscript('')
  }, [sendToAura])

  const stopListening = useCallback(() => {
    recRef.current?.stop()
    setListening(false)
    if (silenceTimer.current) clearTimeout(silenceTimer.current)
  }, [])

  const stopAll = () => {
    abortRef.current?.abort()
    synth.current.cancel()
    recRef.current?.stop()
    setSpeaking(false)
    setListening(false)
    setProcessing(false)
    isSpeaking.current = false
    speakQueue.current = []
  }

  const toggleMic = () => listening ? stopListening() : startListening()
  const supported = !!getSR()

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.avatar}><span>🔱</span></div>
          <div className={styles.headerInfo}>
            <div className={styles.name}>Aura</div>
            <div className={styles.status}>
              {speaking ? '🔊 Speaking...' : listening ? '🎤 Listening...' : processing ? '🧠 Thinking...' : 'Tap mic to talk'}
            </div>
          </div>
          <button className={styles.autoBtn} onClick={() => setAutoListen(a => !a)} title={autoListen ? 'Auto-listen ON' : 'Auto-listen OFF'}>
            {autoListen ? '🔄' : '⏸'}
          </button>
        </div>

        <div className={styles.messages}>
          {messages.length === 0 && !currentReply && (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>🔱</div>
              <div className={styles.emptyTitle}>Talk to Aura</div>
              <div className={styles.emptyDesc}>Tap the mic and speak. Ask about anything — emails, spending, schedule, or just chat like a friend.</div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`${styles.msg} ${styles[m.role]}`}>{m.content}</div>
          ))}
          {currentReply && (
            <div className={`${styles.msg} ${styles.assistant}`}>{currentReply}</div>
          )}
          {transcript && (
            <div className={`${styles.msg} ${styles.user} ${styles.interim}`}>{transcript}</div>
          )}
          {processing && !currentReply && (
            <div className={`${styles.msg} ${styles.assistant}`}><span className={styles.dots}>● ● ●</span></div>
          )}
          <div ref={msgsEnd} />
        </div>

        <div className={styles.controls}>
          {(speaking || processing) && (
            <button className={styles.stopBtn} onClick={stopAll}>⏹ Stop</button>
          )}
          {!supported ? (
            <div className={styles.unsupported}>Voice not supported. Use Chrome on phone.</div>
          ) : (
            <button
              className={`${styles.micBtn} ${listening ? styles.micActive : ''} ${speaking ? styles.micSpeaking : ''}`}
              onClick={toggleMic}
              disabled={processing}
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
