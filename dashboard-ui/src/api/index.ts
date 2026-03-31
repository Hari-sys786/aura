const BASE = '/api'

const getToken = () => localStorage.getItem('aura_token') || ''

const authHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${getToken()}`,
})

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() })
  if (res.status === 401) {
    localStorage.removeItem('aura_token')
    window.location.reload()
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  if (res.status === 401) {
    localStorage.removeItem('aura_token')
    window.location.reload()
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface SystemStatus {
  version: string
  uptime: number
  memory: { heap: number; total: number }
  plugins: Plugin[]
  scheduler: unknown
  cache: unknown
  data: {
    emails: number
    events: number
    transactions: number
    documents: number
    subscriptions: number
  }
}

export interface Plugin {
  name: string
  version: string
  state: string
}

export interface Email {
  id: string
  from: string
  fromName: string
  subject: string
  category: string
  date: string
  confidence: number
}

export interface CalendarEvent {
  id: string
  summary: string
  start: string
  end: string
  location?: string
  allDay: boolean
}

export interface Transaction {
  id: string
  amount: number
  currency: string
  type: string
  category: string
  merchant: string
  description?: string
  source?: string
  reference?: string
  tags?: string[]
  date: string
}

export interface Document {
  id: string
  originalName: string
  category: string
  size: number
  tags: string[]
  expiryDate?: string
  createdAt: string
}

export interface Subscription {
  id: string
  name: string
  amount: number
  currency: string
  frequency: string
  category: string
  status: string
  nextRenewal: string
}

export const api = {
  status: () => get<SystemStatus>('/status'),
  emails: (limit = 30) => get<Email[]>(`/emails?limit=${limit}`),
  calendar: () => get<CalendarEvent[]>('/calendar'),
  transactions: (limit = 50) => get<Transaction[]>(`/transactions?limit=${limit}`),
  documents: () => get<Document[]>('/documents'),
  subscriptions: () => get<Subscription[]>('/subscriptions'),
  plugins: () => get<Plugin[]>('/plugins'),
  chat: (message: string) => post<{ response: string }>('/chat', { message }),
}
