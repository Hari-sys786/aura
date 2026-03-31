import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Mail } from 'lucide-react'
import { format } from 'date-fns'
import { api } from '../api'
import { PageLoader } from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import styles from './Emails.module.css'

const CATEGORY_COLORS: Record<string, string> = {
  work: 'tag-blue',
  personal: 'tag-green',
  finance: 'tag-green',
  spam: 'tag-red',
  newsletter: 'tag-muted',
  notification: 'tag-muted',
}

export default function Emails() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string | null>(null)

  const { data: emails, isLoading } = useQuery({
    queryKey: ['emails'],
    queryFn: () => api.emails(30),
  })

  const categories = useMemo(() => {
    if (!emails) return []
    return [...new Set(emails.map(e => e.category))].filter(Boolean)
  }, [emails])

  const filtered = useMemo(() => {
    if (!emails) return []
    return emails.filter(e => {
      const matchSearch = !search ||
        e.subject.toLowerCase().includes(search.toLowerCase()) ||
        e.fromName?.toLowerCase().includes(search.toLowerCase()) ||
        e.from.toLowerCase().includes(search.toLowerCase())
      const matchFilter = !filter || e.category === filter
      return matchSearch && matchFilter
    })
  }, [emails, search, filter])

  if (isLoading) return <PageLoader />

  return (
    <div className={`${styles.page} fade-in`}>
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
        >All</button>
        {categories.map(cat => (
          <button
            key={cat}
            className={`${styles.filterBtn} ${filter === cat ? styles.active : ''}`}
            onClick={() => setFilter(f => f === cat ? null : cat)}
          >{cat}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Mail} title="No emails found" description="Try changing your search or filter" />
      ) : (
        <div className={styles.table}>
          <div className={styles.thead}>
            <div className={styles.th}>Sender</div>
            <div className={styles.th}>Subject</div>
            <div className={styles.th}>Category</div>
            <div className={styles.th} style={{ textAlign: 'right' }}>Date</div>
          </div>
          {filtered.map(email => (
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
                {email.date ? format(new Date(email.date), 'MMM d') : '—'}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
