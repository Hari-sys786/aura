import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Bell, CheckCircle, Clock, AlertTriangle, CreditCard, Plus, Trash2 } from 'lucide-react'
import { PageLoader } from '../components/LoadingSpinner'
import styles from './Reminders.module.css'

interface Bill {
  id: string
  vendor: string
  amount: number
  minimumDue?: number
  currency: string
  dueDate: string
  cardLast4?: string
  billType: string
  subject: string
  due?: Date
  daysLeft?: number
}

interface ManualReminder {
  id: string
  title: string
  amount: number
  dueDate: string
  note?: string
  paid: boolean
  createdAt: string
}

const STORAGE_KEY = 'aura_manual_reminders'

const loadManual = (): ManualReminder[] => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
const saveManual = (items: ManualReminder[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(items))

const urgencyColor = (days: number) =>
  days < 0 ? 'var(--error)' : days <= 3 ? 'var(--error)' : days <= 7 ? 'var(--warning)' : 'var(--success)'

const urgencyLabel = (days: number) =>
  days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `${days}d left`

const urgencyBg = (days: number) =>
  days < 0 ? '#ef44441a' : days <= 3 ? '#ef44441a' : days <= 7 ? '#f59e0b1a' : '#22c55e1a'

export default function Reminders() {
  const [manualItems, setManualItems] = useState<ManualReminder[]>(loadManual)
  const [showAdd, setShowAdd] = useState(false)
  const [newItem, setNewItem] = useState({ title: '', amount: '', dueDate: '', note: '' })

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ['bills'],
    queryFn: async () => {
      const token = localStorage.getItem('aura_token') || ''
      const r = await fetch('/api/bills', { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) return []
      const data = await r.json()
      return Array.isArray(data) ? data as Bill[] : []
    },
  })

  const enriched = useMemo(() => {
    const now = new Date()
    return bills
      .filter(b => b.dueDate && b.amount > 0)
      .map(b => {
        const due = new Date(b.dueDate)
        const daysLeft = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        return { ...b, due, daysLeft }
      })
      .filter(b => !isNaN(b.due!.getTime()))
      .sort((a, b) => a.daysLeft! - b.daysLeft!)
  }, [bills])

  const enrichedManual = useMemo(() => {
    const now = new Date()
    return manualItems
      .filter(m => !m.paid)
      .map(m => {
        const due = new Date(m.dueDate)
        const daysLeft = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        return { ...m, due, daysLeft }
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)
  }, [manualItems])

  const paidManual = manualItems.filter(m => m.paid)

  const addManual = () => {
    if (!newItem.title || !newItem.dueDate) return
    const item: ManualReminder = {
      id: Date.now().toString(),
      title: newItem.title,
      amount: parseFloat(newItem.amount) || 0,
      dueDate: newItem.dueDate,
      note: newItem.note || undefined,
      paid: false,
      createdAt: new Date().toISOString(),
    }
    const updated = [...manualItems, item]
    setManualItems(updated)
    saveManual(updated)
    setNewItem({ title: '', amount: '', dueDate: '', note: '' })
    setShowAdd(false)
  }

  const markPaid = (id: string) => {
    const updated = manualItems.map(m => m.id === id ? { ...m, paid: true } : m)
    setManualItems(updated)
    saveManual(updated)
  }

  const deleteManual = (id: string) => {
    const updated = manualItems.filter(m => m.id !== id)
    setManualItems(updated)
    saveManual(updated)
  }

  const totalDue = enriched.reduce((s, b) => s + (b.amount || 0), 0)
    + enrichedManual.reduce((s, m) => s + (m.amount || 0), 0)

  const urgent = [...enriched, ...enrichedManual].filter(b => (b.daysLeft ?? 99) <= 7).length

  if (isLoading) return <PageLoader />

  return (
    <div className={`${styles.page} fade-in`}>

      {/* ── Header Stats ── */}
      <div className={styles.statRow}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ background: '#ef44441a', color: 'var(--error)' }}>
            <Bell size={18} />
          </div>
          <div className={styles.statBody}>
            <div className={styles.statLabel}>Total Due</div>
            <div className={styles.statValue}>₹{totalDue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ background: '#f59e0b1a', color: 'var(--warning)' }}>
            <AlertTriangle size={18} />
          </div>
          <div className={styles.statBody}>
            <div className={styles.statLabel}>Urgent (≤7 days)</div>
            <div className={styles.statValue}>{urgent}</div>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ background: '#60a5fa1a', color: 'var(--accent)' }}>
            <CreditCard size={18} />
          </div>
          <div className={styles.statBody}>
            <div className={styles.statLabel}>From Emails</div>
            <div className={styles.statValue}>{enriched.length}</div>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ background: '#22c55e1a', color: 'var(--success)' }}>
            <CheckCircle size={18} />
          </div>
          <div className={styles.statBody}>
            <div className={styles.statLabel}>Paid</div>
            <div className={styles.statValue}>{paidManual.length}</div>
          </div>
        </div>
      </div>

      {/* ── Email-detected Bills ── */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Detected from Emails</span>
          <span className={styles.badge}>{enriched.length}</span>
        </div>

        {enriched.length === 0 ? (
          <div className={styles.empty}>
            <Clock size={32} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
            <div>No upcoming bills detected from emails</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Bills from credit card statements will appear here automatically</div>
          </div>
        ) : (
          <div className={styles.billList}>
            {enriched.map((b, i) => (
              <div key={b.id || i} className={styles.billItem}
                style={{ borderLeft: `3px solid ${urgencyColor(b.daysLeft!)}`, background: urgencyBg(b.daysLeft!) }}>
                <div className={styles.billIcon} style={{ background: urgencyColor(b.daysLeft!) + '22', color: urgencyColor(b.daysLeft!) }}>
                  <CreditCard size={16} />
                </div>
                <div className={styles.billBody}>
                  <div className={styles.billTitle}>
                    {b.vendor}
                    {b.cardLast4 && <span className={styles.cardTag}>xxxx-{b.cardLast4}</span>}
                  </div>
                  <div className={styles.billSub}>{b.billType} · Detected from email</div>
                  {b.minimumDue && b.minimumDue < b.amount && (
                    <div className={styles.billNote}>Min due: ₹{(b.minimumDue ?? 0).toLocaleString('en-IN')}</div>
                  )}
                </div>
                <div className={styles.billMeta}>
                  <div className={styles.billAmount}>₹{Number(b.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                  <div className={styles.billDueDate}>
                    <Clock size={11} />
                    {b.dueDate}
                  </div>
                  <div className={styles.urgencyBadge} style={{ color: urgencyColor(b.daysLeft!), background: urgencyColor(b.daysLeft!) + '22' }}>
                    {urgencyLabel(b.daysLeft!)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Manual Reminders ── */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Manual Reminders</span>
          <button className={styles.addBtn} onClick={() => setShowAdd(!showAdd)}>
            <Plus size={13} />
            Add
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <div className={styles.addForm}>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Title *</label>
                <input className={styles.input} placeholder="e.g. Electricity Bill"
                  value={newItem.title} onChange={e => setNewItem(p => ({ ...p, title: e.target.value }))} />
              </div>
              <div className={styles.formGroup}>
                <label>Amount (₹)</label>
                <input className={styles.input} type="number" placeholder="0"
                  value={newItem.amount} onChange={e => setNewItem(p => ({ ...p, amount: e.target.value }))} />
              </div>
              <div className={styles.formGroup}>
                <label>Due Date *</label>
                <input className={styles.input} type="date"
                  value={newItem.dueDate} onChange={e => setNewItem(p => ({ ...p, dueDate: e.target.value }))} />
              </div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup} style={{ flex: 2 }}>
                <label>Note (optional)</label>
                <input className={styles.input} placeholder="Any notes..."
                  value={newItem.note} onChange={e => setNewItem(p => ({ ...p, note: e.target.value }))} />
              </div>
              <div className={styles.formActions}>
                <button className={styles.saveBtn} onClick={addManual}>Save</button>
                <button className={styles.cancelBtn} onClick={() => setShowAdd(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {enrichedManual.length === 0 && !showAdd ? (
          <div className={styles.empty}>
            <Bell size={32} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
            <div>No manual reminders yet</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Add reminders for bills not detected automatically</div>
          </div>
        ) : (
          <div className={styles.billList}>
            {enrichedManual.map(m => (
              <div key={m.id} className={styles.billItem}
                style={{ borderLeft: `3px solid ${urgencyColor(m.daysLeft)}`, background: urgencyBg(m.daysLeft) }}>
                <div className={styles.billIcon} style={{ background: urgencyColor(m.daysLeft) + '22', color: urgencyColor(m.daysLeft) }}>
                  <Bell size={16} />
                </div>
                <div className={styles.billBody}>
                  <div className={styles.billTitle}>{m.title}</div>
                  {m.note && <div className={styles.billNote}>{m.note}</div>}
                  <div className={styles.billSub}>Added manually · {format(new Date(m.createdAt), 'MMM d')}</div>
                </div>
                <div className={styles.billMeta}>
                  {m.amount > 0 && <div className={styles.billAmount}>₹{m.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>}
                  <div className={styles.billDueDate}>
                    <Clock size={11} />
                    {format(new Date(m.dueDate), 'MMM d, yyyy')}
                  </div>
                  <div className={styles.urgencyBadge} style={{ color: urgencyColor(m.daysLeft), background: urgencyColor(m.daysLeft) + '22' }}>
                    {urgencyLabel(m.daysLeft)}
                  </div>
                </div>
                <div className={styles.billActions}>
                  <button className={styles.paidBtn} onClick={() => markPaid(m.id)} title="Mark as paid">
                    <CheckCircle size={15} />
                  </button>
                  <button className={styles.deleteBtn} onClick={() => deleteManual(m.id)} title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Paid History ── */}
      {paidManual.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle} style={{ color: 'var(--text-muted)' }}>Paid / Done</span>
            <span className={styles.badge}>{paidManual.length}</span>
          </div>
          <div className={styles.billList}>
            {paidManual.map(m => (
              <div key={m.id} className={styles.billItem} style={{ opacity: 0.55, borderLeft: '3px solid var(--border)' }}>
                <div className={styles.billIcon} style={{ background: '#22c55e1a', color: 'var(--success)' }}>
                  <CheckCircle size={16} />
                </div>
                <div className={styles.billBody}>
                  <div className={styles.billTitle} style={{ textDecoration: 'line-through' }}>{m.title}</div>
                  <div className={styles.billSub}>{format(new Date(m.dueDate), 'MMM d, yyyy')}</div>
                </div>
                <div className={styles.billMeta}>
                  {m.amount > 0 && <div className={styles.billAmount}>₹{m.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>}
                  <div className={styles.urgencyBadge} style={{ color: 'var(--success)', background: '#22c55e1a' }}>Paid</div>
                </div>
                <div className={styles.billActions}>
                  <button className={styles.deleteBtn} onClick={() => deleteManual(m.id)} title="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
