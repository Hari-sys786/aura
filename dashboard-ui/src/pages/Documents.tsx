import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, FileText, Grid, List, AlertTriangle } from 'lucide-react'
import { format, differenceInDays } from 'date-fns'
import { api } from '../api'
import { PageLoader } from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import styles from './Documents.module.css'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const CAT_ICON_COLORS: Record<string, string> = {
  invoice: '#e8a03e',
  contract: '#60a5fa',
  passport: '#4ade80',
  insurance: '#c084fc',
  receipt: '#34d399',
  id: '#f87171',
}

export default function Documents() {
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')

  const { data: documents, isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: api.documents,
  })

  const filtered = useMemo(() => {
    if (!documents) return []
    return documents.filter(d =>
      !search ||
      d.originalName.toLowerCase().includes(search.toLowerCase()) ||
      d.category.toLowerCase().includes(search.toLowerCase()) ||
      d.tags?.some(t => t.toLowerCase().includes(search.toLowerCase()))
    )
  }, [documents, search])

  if (isLoading) return <PageLoader />
  if (!documents?.length) return <EmptyState icon={FileText} title="No documents" description="Documents will appear here when uploaded" />

  const isExpiringSoon = (expiryDate?: string) => {
    if (!expiryDate) return false
    return differenceInDays(new Date(expiryDate), new Date()) < 30
  }

  return (
    <div className={`${styles.page} fade-in`}>
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search className={styles.searchIcon} size={14} />
          <input
            className={styles.search}
            placeholder="Search documents…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className={styles.viewToggle}>
          <button className={`${styles.viewBtn} ${view === 'grid' ? styles.active : ''}`} onClick={() => setView('grid')}>
            <Grid size={14} />
          </button>
          <button className={`${styles.viewBtn} ${view === 'list' ? styles.active : ''}`} onClick={() => setView('list')}>
            <List size={14} />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No matching documents" />
      ) : view === 'grid' ? (
        <div className={styles.grid}>
          {filtered.map(doc => {
            const expiring = isExpiringSoon(doc.expiryDate)
            const color = CAT_ICON_COLORS[doc.category] ?? 'var(--text-muted)'
            return (
              <div key={doc.id} className={`${styles.docCard} ${expiring ? styles.expiring : ''}`}>
                <div className={styles.docIcon}>
                  <FileText size={18} color={color} strokeWidth={1.8} />
                </div>
                <div className={styles.docName}>{doc.originalName}</div>
                <div className={styles.docMeta}>
                  <span className={`tag tag-muted`}>{doc.category}</span>
                  <span className={styles.docSize}>{formatSize(doc.size)}</span>
                </div>
                {expiring && doc.expiryDate && (
                  <div className={styles.expiryWarn}>
                    <AlertTriangle size={11} />
                    Expires {format(new Date(doc.expiryDate), 'MMM d')}
                  </div>
                )}
                {doc.tags?.length > 0 && (
                  <div className={styles.tags}>
                    {doc.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="tag tag-muted">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className={styles.listTable}>
          <div className={styles.listHead}>
            <div className={styles.th}>Name</div>
            <div className={styles.th}>Size</div>
            <div className={styles.th}>Category</div>
            <div className={styles.th}>Expiry</div>
          </div>
          {filtered.map(doc => {
            const expiring = isExpiringSoon(doc.expiryDate)
            return (
              <div key={doc.id} className={`${styles.listRow} ${expiring ? styles.expiring : ''}`}>
                <div>
                  <div className={styles.fileName}>{doc.originalName}</div>
                  {doc.tags?.length > 0 && (
                    <div className={styles.tags} style={{ marginTop: 4 }}>
                      {doc.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="tag tag-muted">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.fileSize}>{formatSize(doc.size)}</div>
                <div><span className="tag tag-muted">{doc.category}</span></div>
                <div className={`${styles.fileExpiry} ${expiring ? styles.warn : ''}`}>
                  {doc.expiryDate ? format(new Date(doc.expiryDate), 'MMM d, yyyy') : '—'}
                  {expiring && ' ⚠'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
