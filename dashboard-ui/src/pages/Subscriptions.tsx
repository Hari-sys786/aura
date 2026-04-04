import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, differenceInDays } from 'date-fns'
import { CreditCard } from 'lucide-react'
import { api } from '../api'
import { PageLoader } from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import styles from './Subscriptions.module.css'

const COLORS = ['#e8a03e', '#60a5fa', '#4ade80', '#f87171', '#c084fc', '#34d399', '#fb923c', '#a78bfa']

function toMonthly(amount: number, frequency: string) {
  switch (frequency?.toLowerCase()) {
    case 'weekly': return amount * 4.33
    case 'quarterly': return amount / 3
    case 'yearly': case 'annual': return amount / 12
    default: return amount
  }
}

export default function Subscriptions() {
  const { data: subs, isLoading } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: async () => { try { const d = await api.subscriptions(); return Array.isArray(d) ? d : []; } catch { return []; } },
  })

  const { monthlyTotal, yearlyTotal, byCost } = useMemo(() => {
    if (!subs) return { monthlyTotal: 0, yearlyTotal: 0, byCost: [] }
    const active = subs.filter(s => s.status !== 'cancelled')
    const monthlyTotal = active.reduce((sum, s) => sum + toMonthly(s.amount, s.frequency), 0)
    const yearlyTotal = monthlyTotal * 12
    const byCost = active
      .map((s, i) => ({ ...s, monthly: toMonthly(s.amount, s.frequency), color: COLORS[i % COLORS.length] }))
      .sort((a, b) => b.monthly - a.monthly)
    return { monthlyTotal, yearlyTotal, byCost }
  }, [subs])

  const timeline = useMemo(() => {
    if (!subs) return []
    return [...subs]
      .filter(s => s.nextRenewal && s.status !== 'cancelled')
      .sort((a, b) => new Date(a.nextRenewal).getTime() - new Date(b.nextRenewal).getTime())
      .slice(0, 8)
  }, [subs])

  if (isLoading) return <PageLoader />
  if (!subs?.length) return <EmptyState icon={CreditCard} title="No subscriptions" description="Subscriptions will appear here when tracked" />

  return (
    <div className={`${styles.page} fade-in`}>
      <div className={styles.top}>
        {/* Subscription List */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Active Subscriptions</span>
            <span className={styles.totalBadge}>{(monthlyTotal ?? 0).toFixed(2)}/mo</span>
          </div>
          <div className={styles.subList}>
            {byCost.map(sub => (
              <div key={sub.id} className={styles.subItem}>
                <div className={styles.subAvatar} style={{ color: sub.color, background: `${sub.color}18` }}>
                  {sub.name.slice(0, 2)}
                </div>
                <div className={styles.subInfo}>
                  <div className={styles.subName}>{sub.name}</div>
                  <div className={styles.subFreq}>
                    {sub.frequency} · {sub.category}
                    {' '}<span className={`tag ${sub.status === 'active' ? 'tag-green' : 'tag-muted'}`}>{sub.status}</span>
                  </div>
                </div>
                <div className={styles.subRight}>
                  <div className={styles.subAmount}>{sub.currency} {(sub.amount ?? 0).toFixed(2)}</div>
                  <div className={styles.subRenewal}>
                    {sub.nextRenewal ? `Renews ${format(new Date(sub.nextRenewal), 'MMM d')}` : 'No renewal'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>Cost Summary</span>
            </div>
            <div className={styles.summaryInner}>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Monthly Total</span>
                <span className={styles.summaryVal}>{(monthlyTotal ?? 0).toFixed(2)}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Yearly Total</span>
                <span className={styles.summaryVal}>{(yearlyTotal ?? 0).toFixed(2)}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Active</span>
                <span className={styles.summaryVal}>{byCost.length}</span>
              </div>
              <div>
                <div className={styles.costBarLabel}>Top subscriptions</div>
                {byCost.slice(0, 5).map(sub => (
                  <div key={sub.id} className={styles.costBarItem}>
                    <span className={styles.costBarName}>{sub.name}</span>
                    <div className={styles.costBarTrack}>
                      <div
                        className={styles.costBarFill}
                        style={{
                          width: `${monthlyTotal ? (sub.monthly / monthlyTotal) * 100 : 0}%`,
                          background: sub.color,
                        }}
                      />
                    </div>
                    <span className={styles.costBarAmt}>{(sub.monthly ?? 0).toFixed(0)}/mo</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Renewal Timeline */}
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>Upcoming Renewals</span>
            </div>
            <div className={styles.timeline}>
              {timeline.map((sub, i) => {
                const days = differenceInDays(new Date(sub.nextRenewal), new Date())
                const urgent = days < 7
                return (
                  <div key={sub.id} className={styles.timelineItem}>
                    <div className={styles.timelineDot} style={{ background: COLORS[i % COLORS.length] }} />
                    <span className={styles.timelineName}>{sub.name}</span>
                    <span className={styles.timelineDate} style={urgent ? { color: 'var(--error)' } : {}}>
                      {days === 0 ? 'Today' : days < 0 ? 'Overdue' : `${days}d`}
                    </span>
                    <span className={styles.timelineAmt}>{(sub.amount ?? 0).toFixed(0)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
