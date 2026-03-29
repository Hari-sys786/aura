import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Puzzle, Server } from 'lucide-react'
import { api } from '../api'
import { PageLoader } from '../components/LoadingSpinner'
import styles from './Settings.module.css'

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatUptime(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`
  return `${h}h ${m}m ${s}s`
}

export default function Settings() {
  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 30_000,
  })

  const { data: plugins } = useQuery({
    queryKey: ['plugins'],
    queryFn: api.plugins,
  })

  if (isLoading && !status) return <PageLoader />

  const heapPct = status ? Math.round((status.memory.heap / status.memory.total) * 100) : 0
  const cache = status?.cache as any
  const data = status?.data

  return (
    <div className={`${styles.page} fade-in`}>
      <div className={styles.grid}>
        {/* System Info */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>System Status</span>
            <button className={styles.refetchBtn} onClick={() => refetch()}>
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Version</span>
              <span className={styles.rowValue}>{status?.version ?? '—'}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Uptime</span>
              <span className={styles.rowValue}>{status ? formatUptime(status.uptime) : '—'}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Status</span>
              <span className="tag tag-green">Online</span>
            </div>
          </div>
          <div className={styles.memBar}>
            <div className={styles.memHead}>
              <span className={styles.memLabel}>Heap Memory</span>
              <span className={styles.memValue}>{formatBytes(status?.memory.heap ?? 0)} / {formatBytes(status?.memory.total ?? 0)} ({heapPct}%)</span>
            </div>
            <div className={styles.memTrack}>
              <div className={styles.memFill} style={{ width: `${heapPct}%` }} />
            </div>
          </div>
        </div>

        {/* Data Counts */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Data Overview</span>
            <Server size={14} color="var(--text-muted)" />
          </div>
          <div className={styles.sectionBody}>
            {[
              { label: 'Emails', key: 'emails' },
              { label: 'Events', key: 'events' },
              { label: 'Transactions', key: 'transactions' },
              { label: 'Documents', key: 'documents' },
              { label: 'Subscriptions', key: 'subscriptions' },
            ].map(({ label, key }) => (
              <div key={key} className={styles.row}>
                <span className={styles.rowLabel}>{label}</span>
                <span className={styles.rowValue}>{data?.[key as keyof typeof data] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Plugins */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Plugins</span>
            <Puzzle size={14} color="var(--text-muted)" />
          </div>
          <div className={styles.pluginList}>
            {!plugins?.length ? (
              <div style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
                No plugins loaded
              </div>
            ) : plugins.map(p => (
              <div key={p.name} className={styles.pluginItem}>
                <div className={styles.pluginIcon}>
                  <Puzzle size={14} color="var(--text-muted)" />
                </div>
                <div className={styles.pluginInfo}>
                  <div className={styles.pluginName}>{p.name}</div>
                  <div className={styles.pluginVersion}>v{p.version}</div>
                </div>
                <span className={`tag ${p.state === 'running' ? 'tag-green' : p.state === 'stopped' ? 'tag-red' : 'tag-muted'}`}>
                  {p.state}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Cache Stats */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Cache Stats</span>
          </div>
          {cache ? (
            <div className={styles.cacheGrid}>
              {Object.entries(cache).slice(0, 6).map(([key, val]) => (
                <div key={key} className={styles.cacheItem}>
                  <div className={styles.cacheLabel}>{key}</div>
                  <div className={styles.cacheValue}>{String(val)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              No cache data
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
