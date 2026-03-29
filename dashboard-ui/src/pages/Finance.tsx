import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { DollarSign } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import { api } from '../api'
import { PageLoader } from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import styles from './Finance.module.css'

const CAT_COLORS = ['#e8a03e', '#60a5fa', '#4ade80', '#f87171', '#c084fc', '#34d399', '#fb923c']

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface-3)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px',
    }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
        {payload[0].value.toFixed(2)}
      </div>
    </div>
  )
}

export default function Finance() {
  const { data: transactions, isLoading } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.transactions(50),
  })

  const { byCategory, chartData, totalSpend } = useMemo(() => {
    if (!transactions) return { byCategory: [], chartData: [], totalSpend: 0 }

    const catMap = new Map<string, number>()
    const monthMap = new Map<string, number>()

    for (const t of transactions) {
      if (t.type === 'debit' || t.amount < 0) {
        const amt = Math.abs(t.amount)
        catMap.set(t.category, (catMap.get(t.category) ?? 0) + amt)
        const month = format(new Date(t.date), 'MMM')
        monthMap.set(month, (monthMap.get(month) ?? 0) + amt)
      }
    }

    const total = [...catMap.values()].reduce((a, b) => a + b, 0)
    const byCategory = [...catMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount], i) => ({ name, amount, pct: total ? (amount / total * 100).toFixed(0) : 0, color: CAT_COLORS[i % CAT_COLORS.length] }))

    const chartData = [...monthMap.entries()].map(([month, amount]) => ({ month, amount }))

    return { byCategory, chartData, totalSpend: total }
  }, [transactions])

  if (isLoading) return <PageLoader />
  if (!transactions?.length) return <EmptyState icon={DollarSign} title="No transactions" description="Transactions will appear here when synced" />

  return (
    <div className={`${styles.page} fade-in`}>
      <div className={styles.top}>
        {/* Spending Chart */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Monthly Spending</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Total: {totalSpend.toFixed(2)}
            </span>
          </div>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={50} tickFormatter={v => v.toFixed(0)} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--surface-3)' }} />
                <Bar dataKey="amount" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>By Category</span>
          </div>
          <div className={styles.catList}>
            {byCategory.map(cat => (
              <div key={cat.name} className={styles.catItem}>
                <div className={styles.catDot} style={{ background: cat.color }} />
                <span className={styles.catName}>{cat.name}</span>
                <span className={styles.catPct}>{cat.pct}%</span>
                <span className={styles.catAmount}>{cat.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Recent Transactions</span>
        </div>
        <div className={styles.txTable}>
          <div className={styles.txHead}>
            <div className={styles.th}>Merchant</div>
            <div className={styles.th}>Category</div>
            <div className={styles.th} style={{ textAlign: 'right' }}>Amount</div>
            <div className={styles.th} style={{ textAlign: 'right' }}>Date</div>
          </div>
          {transactions.map(tx => (
            <div key={tx.id} className={styles.txRow}>
              <div className={styles.merchant}>{tx.merchant}</div>
              <div className={styles.category}>{tx.category}</div>
              <div className={`${styles.amount} ${tx.amount < 0 || tx.type === 'debit' ? styles.debit : styles.credit}`}>
                {tx.amount < 0 ? '-' : '+'}{Math.abs(tx.amount).toFixed(2)} {tx.currency}
              </div>
              <div className={styles.date}>{format(new Date(tx.date), 'MMM d')}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
