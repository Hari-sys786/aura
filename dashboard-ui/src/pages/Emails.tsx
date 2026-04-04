import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Mail, ChevronLeft, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { api } from '../api'
import { PageLoader } from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import styles from './Emails.module.css'

const CATEGORY_COLORS: Record<string, string> = {
  work: 'tag-blue',
  personal: 'tag-green',
  finance: 'tag-green',
  bill: 'tag-green',
  action: 'tag-blue',
  action_required: 'tag-blue',
  spam: 'tag-red',
  newsletter: 'tag-muted',
  notification: 'tag-muted',
  fyi: 'tag-muted',
}

const PAGE_SIZE = 25
/** Format date in IST regardless of browser timezone */
const fmtIST = (d: string, opts?: Intl.DateTimeFormatOptions) => {
  if (!d) return '—'
  const defaults: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }
  return new Intl.DateTimeFormat('en-IN', opts || defaults).format(new Date(d))
}
const fmtISTMonth = (d: string) => {
  const dt = new Date(d)
  // Get year-month in IST
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(dt)
  const y = parts.find(p => p.type === 'year')?.value
  const m = parts.find(p => p.type === 'month')?.value
  return y && m ? `${y}-${m}` : ''
}
const fmtISTMonthLabel = (ym: string) => {
  const dt = new Date(ym + '-15')  // mid-month to avoid edge issues
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', year: '2-digit' }).format(dt)
}
const currentISTMonth = () => {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const y = parts.find(p => p.type === 'year')?.value
  const m = parts.find(p => p.type === 'month')?.value
  return y && m ? `${y}-${m}` : ''
}

export default function Emails() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(() => currentISTMonth())
  const [page, setPage] = useState(1)

  const { data: emails, isLoading } = useQuery({
    queryKey: ['emails'],
    queryFn: () => api.emails(500), // fetch all for proper month filtering
  })

  // Available months from email dates (IST)
  const availableMonths = useMemo(() => {
    const months = new Set<string>()
    // Always include current month
    months.add(currentISTMonth())
    // Add all months that have actual data
    if (emails) {
      emails.forEach(e => {
        if (e.date) months.add(fmtISTMonth(e.date))
      })
    }
    // Only past + current months, never future
    const currentMonth = currentISTMonth()
    return [...months].filter(m => m <= currentMonth).sort((a, b) => b.localeCompare(a))
  }, [emails])

  // Auto-select month with most emails on first load
  const [monthInit, setMonthInit] = useState(false)
  useEffect(() => {
    if (monthInit || !emails?.length || !availableMonths.length) return
    const counts = new Map<string, number>()
    emails.forEach(e => {
      if (e.date) {
        const m = fmtISTMonth(e.date)
        counts.set(m, (counts.get(m) ?? 0) + 1)
      }
    })
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (best) setSelectedMonth(best)
    setMonthInit(true)
  }, [emails, availableMonths, monthInit])

  // Filter by month
  const monthEmails = useMemo(() => {
    if (!emails) return []
    return emails.filter(e => e.date && fmtISTMonth(e.date) === selectedMonth)
  }, [emails, selectedMonth])

  const categories = useMemo(() => {
    return [...new Set(monthEmails.map(e => e.category))].filter(Boolean)
  }, [monthEmails])

  const filtered = useMemo(() => {
    return monthEmails.filter(e => {
      const matchSearch = !search ||
        e.subject.toLowerCase().includes(search.toLowerCase()) ||
        (e.fromName || '').toLowerCase().includes(search.toLowerCase()) ||
        e.from.toLowerCase().includes(search.toLowerCase())
      const matchFilter = !filter || e.category === filter
      return matchSearch && matchFilter
    })
  }, [monthEmails, search, filter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset page on filter/month change
  useEffect(() => { setPage(1) }, [search, filter, selectedMonth])

  const selectedMonthLabel = availableMonths.length
    ? fmtISTMonthLabel(selectedMonth)
    : selectedMonth

  if (isLoading) return <PageLoader />

  return (
    <div className={`${styles.page} fade-in`}>
      {/* Month selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <ChevronLeft size={16} style={{ cursor: 'pointer', opacity: 0.5 }}
          onClick={() => {
            const idx = availableMonths.indexOf(selectedMonth)
            if (idx < availableMonths.length - 1) setSelectedMonth(availableMonths[idx + 1])
          }} />
        {availableMonths.map(m => (
          <button key={m}
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 12, border: 'none', cursor: 'pointer',
              background: selectedMonth === m ? 'var(--accent)' : 'var(--surface-2)',
              color: selectedMonth === m ? '#fff' : 'var(--text-secondary)',
              fontWeight: selectedMonth === m ? 600 : 400,
            }}
            onClick={() => setSelectedMonth(m)}>
            {fmtISTMonthLabel(m)}
          </button>
        ))}
        <ChevronRight size={16} style={{ cursor: 'pointer', opacity: 0.5 }}
          onClick={() => {
            const idx = availableMonths.indexOf(selectedMonth)
            if (idx > 0) setSelectedMonth(availableMonths[idx - 1])
          }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
          {monthEmails.length} emails in {selectedMonthLabel}
        </span>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search className={styles.searchIcon} size={14} />
          <input
            className={styles.search}
            placeholder="Search emails…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button
          className={`${styles.filterBtn} ${filter === null ? styles.active : ''}`}
          onClick={() => setFilter(null)}
        >All ({monthEmails.length})</button>
        {categories.map(cat => (
          <button
            key={cat}
            className={`${styles.filterBtn} ${filter === cat ? styles.active : ''}`}
            onClick={() => setFilter(f => f === cat ? null : cat)}
          >{cat} ({monthEmails.filter(e => e.category === cat).length})</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Mail} title="No emails found" description="Try changing your search, filter, or month" />
      ) : (
        <>
          <div className={styles.table}>
            <div className={styles.thead}>
              <div className={styles.th}>Sender</div>
              <div className={styles.th}>Subject</div>
              <div className={styles.th}>Category</div>
              <div className={styles.th} style={{ textAlign: 'right' }}>Date (IST)</div>
            </div>
            {paginated.map(email => (
              <a
                key={email.id}
                className={styles.row}
                href={`https://mail.google.com/mail/u/0/#inbox/${email.id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className={styles.sender}>
                  <span className={styles.senderName}>{email.fromName || email.from}</span>
                  <span className={styles.senderEmail}>{email.from}</span>
                </div>
                <div className={styles.subject}>{email.subject}</div>
                <div>
                  <span className={`tag ${CATEGORY_COLORS[email.category] ?? 'tag-muted'}`}>
                    {email.category}
                  </span>
                </div>
                <div className={styles.date}>
                  {email.date ? fmtIST(email.date) : '—'}
                </div>
              </a>
            ))}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 16 }}>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Page {page} of {totalPages} · {filtered.length} emails
              </span>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
