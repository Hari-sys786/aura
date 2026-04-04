import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Mail, DollarSign, FileText, CreditCard, Calendar, Activity } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { api } from '../api'
import StatCard from '../components/StatCard'
import { PageLoader } from '../components/LoadingSpinner'
import styles from './Overview.module.css'

function formatUptime(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h ${m}m`
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function Overview() {
  const { data: status, isLoading: loadingStatus } = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 15_000,
  })

  const { data: emails } = useQuery({ queryKey: ['emails'], queryFn: () => api.emails(10) })
  const { data: transactions } = useQuery({ queryKey: ['transactions'], queryFn: () => api.transactions(5) })
  const { data: events } = useQuery({ queryKey: ['calendar'], queryFn: api.calendar })

  const recentActivity = [
    ...(emails?.slice(0, 3).map(e => ({
      id: e.id,
      type: 'email',
      title: e.subject,
      sub: `From ${e.fromName || e.from}`,
      time: e.date,
      color: '#60a5fa',
    })) ?? []),
    ...(transactions?.slice(0, 3).map(t => ({
      id: t.id,
      type: 'transaction',
      title: `${t.merchant}`,
      sub: `${t.currency} ${Math.abs(t.amount ?? 0).toFixed(2)} — ${t.category}`,
      time: t.date,
      color: '#4ade80',
    })) ?? []),
    ...(events?.slice(0, 2).map(ev => ({
      id: ev.id,
      type: 'event',
      title: ev.summary,
      sub: ev.location ?? 'Event',
      time: ev.start,
      color: '#e8a03e',
    })) ?? []),
  ]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 8)

  if (loadingStatus && !status) return <PageLoader />

  const d = status?.data
  const heapPct = status ? Math.round((status.memory.heap / status.memory.total) * 100) : 0

  return (
    <div className={`${styles.page} fade-in`}>
      <div className={styles.statsGrid}>
        <StatCard label="Emails" value={d?.emails ?? 0} icon={Mail} color="#60a5fa" sub="Processed" loading={loadingStatus} />
        <StatCard label="Transactions" value={d?.transactions ?? 0} icon={DollarSign} color="#4ade80" sub="Recorded" loading={loadingStatus} />
        <StatCard label="Documents" value={d?.documents ?? 0} icon={FileText} color="#e8a03e" sub="Stored" loading={loadingStatus} />
        <StatCard label="Subscriptions" value={d?.subscriptions ?? 0} icon={CreditCard} color="#f87171" sub="Tracked" loading={loadingStatus} />
        <StatCard label="Events" value={d?.events ?? 0} icon={Calendar} color="#c084fc" sub="Upcoming" loading={loadingStatus} />
        <StatCard label="Plugins" value={status?.plugins?.length ?? 0} icon={Activity} color="#34d399" sub="Active" loading={loadingStatus} />
      </div>

      <div className={styles.row}>
        {/* Recent Activity */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Recent Activity</span>
          </div>
          <div className={styles.activityList}>
            {recentActivity.length === 0 ? (
              <div style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
                No recent activity
              </div>
            ) : recentActivity.map(item => (
              <div key={item.id} className={styles.activityItem}>
                <div className={styles.actDot} style={{ background: item.color }} />
                <div className={styles.actContent}>
                  <div className={styles.actTitle}>{item.title}</div>
                  <div className={styles.actSub}>{item.sub}</div>
                </div>
                <span className={styles.actTime}>
                  {formatDistanceToNow(new Date(item.time), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* System Health */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>System Health</span>
            <Link to="/settings" className={styles.sectionLink}>Details →</Link>
          </div>
          <div className={styles.healthGrid}>
            <div className={styles.healthItem}>
              <div className={styles.healthLabel}>Version</div>
              <div className={styles.healthValue}>{status?.version ?? '—'}</div>
            </div>
            <div className={styles.healthItem}>
              <div className={styles.healthLabel}>Uptime</div>
              <div className={styles.healthValue}>{status ? formatUptime(status.uptime) : '—'}</div>
            </div>
            <div className={styles.healthItem}>
              <div className={styles.healthLabel}>Heap Used</div>
              <div className={styles.healthValue}>{status ? formatBytes(status.memory.heap) : '—'}</div>
              <div className={styles.healthBar}>
                <div className={styles.healthBarFill} style={{ width: `${heapPct}%` }} />
              </div>
            </div>
            <div className={styles.healthItem}>
              <div className={styles.healthLabel}>Total Memory</div>
              <div className={styles.healthValue}>{status ? formatBytes(status.memory.total) : '—'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
