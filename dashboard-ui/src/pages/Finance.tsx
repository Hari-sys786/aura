import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfMonth, endOfMonth, subMonths, isWithinInterval } from 'date-fns'
import { DollarSign, TrendingDown, TrendingUp, ArrowDownCircle, ArrowUpCircle, Search } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, PieChart, Pie, Legend
} from 'recharts'
import { api } from '../api'
import { PageLoader } from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import styles from './Finance.module.css'

const CAT_COLORS: Record<string, string> = {
  shopping:    '#e8a03e',
  transfer:    '#60a5fa',
  fuel:        '#4ade80',
  grocery:     '#f87171',
  transport:   '#c084fc',
  food:        '#34d399',
  investment:  '#fb923c',
  insurance:   '#818cf8',
  emi:         '#f472b6',
  recharge:    '#38bdf8',
  bills:       '#a78bfa',
  other:       '#6b7280',
}
const CAT_COLOR_LIST = Object.values(CAT_COLORS)

// ─── Tooltip ──────────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface-3)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', minWidth: 140,
    }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ fontSize: 12, color: p.color }}>{p.name}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: p.color, fontFamily: 'var(--font-mono)' }}>
            ₹{Number(p.value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
        </div>
      ))}
    </div>
  )
}

const PieTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div style={{
      background: 'var(--surface-3)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px',
    }}>
      <div style={{ fontSize: 12, color: d.payload.fill, fontWeight: 600 }}>{d.name}</div>
      <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
        ₹{Number(d.value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({d.payload.pct}%)</span>
      </div>
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, icon: Icon, color }: any) => (
  <div className={styles.statCard}>
    <div className={styles.statIcon} style={{ background: color + '22', color }}>
      <Icon size={18} />
    </div>
    <div className={styles.statBody}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>
        ₹{Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  </div>
)

export default function Finance() {
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')
  const [chartMode, setChartMode] = useState<'bar' | 'area' | 'pie'>('bar')

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.transactions(200),
  })

  const { byCategory, chartData, stats, categories } = useMemo(() => {
    if (!transactions) return { byCategory: [], chartData: [], stats: null, categories: [] }

    const now = new Date()
    const thisMonth = { start: startOfMonth(now), end: endOfMonth(now) }
    const lastMonth = { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) }

    let totalDebit = 0, totalCredit = 0, thisMonthDebit = 0, lastMonthDebit = 0
    const catMap = new Map<string, number>()
    const dayMap = new Map<string, { debit: number; credit: number }>()

    for (const t of transactions) {
      const isDebit = t.type === 'debit'
      const amt = Math.abs(t.amount)
      const date = new Date(t.date)
      const day = format(date, 'MMM d')

      if (isDebit) totalDebit += amt
      else totalCredit += amt

      if (isDebit && isWithinInterval(date, thisMonth)) thisMonthDebit += amt
      if (isDebit && isWithinInterval(date, lastMonth)) lastMonthDebit += amt

      if (isDebit) catMap.set(t.category, (catMap.get(t.category) ?? 0) + amt)

      const entry = dayMap.get(day) ?? { debit: 0, credit: 0 }
      if (isDebit) entry.debit += amt
      else entry.credit += amt
      dayMap.set(day, entry)
    }

    const totalCatSpend = [...catMap.values()].reduce((a, b) => a + b, 0)
    const byCategory = [...catMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount], i) => ({
        name, amount,
        pct: totalCatSpend ? Math.round(amount / totalCatSpend * 100) : 0,
        color: CAT_COLORS[name] ?? CAT_COLOR_LIST[i % CAT_COLOR_LIST.length],
        fill: CAT_COLORS[name] ?? CAT_COLOR_LIST[i % CAT_COLOR_LIST.length],
      }))

    // Sort days chronologically
    const sortedDays = [...dayMap.entries()]
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    const chartData = sortedDays.map(([day, v]) => ({ day, ...v }))

    const trend = lastMonthDebit > 0
      ? ((thisMonthDebit - lastMonthDebit) / lastMonthDebit * 100).toFixed(1)
      : null

    const categories = ['all', ...new Set(transactions.map(t => t.category))]

    return {
      byCategory, chartData,
      stats: { totalDebit, totalCredit, thisMonthDebit, lastMonthDebit, trend },
      categories,
    }
  }, [transactions])

  const filtered = useMemo(() => {
    if (!transactions) return []
    return transactions.filter(t => {
      if (filterCat !== 'all' && t.category !== filterCat) return false
      if (filterType !== 'all' && t.type !== filterType) return false
      if (search) {
        const q = search.toLowerCase()
        if (!t.merchant?.toLowerCase().includes(q) &&
            !t.description?.toLowerCase().includes(q) &&
            !t.category?.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [transactions, filterCat, filterType, search])

  if (isLoading) return <PageLoader />
  if (!transactions?.length) return <EmptyState icon={DollarSign} title="No transactions" description="Financial transactions will appear here when synced from emails" />

  return (
    <div className={`${styles.page} fade-in`}>

      {/* ── Stat Cards ── */}
      <div className={styles.statRow}>
        <StatCard label="Total Spent (All)" value={stats?.totalDebit ?? 0} icon={TrendingDown} color="var(--error)" />
        <StatCard label="Total Received" value={stats?.totalCredit ?? 0} icon={TrendingUp} color="var(--success)" />
        <StatCard
          label="This Month" value={stats?.thisMonthDebit ?? 0}
          sub={stats?.trend ? `${Number(stats.trend) > 0 ? '+' : ''}${stats.trend}% vs last month` : undefined}
          icon={ArrowDownCircle} color="var(--accent)"
        />
        <StatCard label="Net Balance" value={Math.abs((stats?.totalCredit ?? 0) - (stats?.totalDebit ?? 0))}
          sub={(stats?.totalCredit ?? 0) >= (stats?.totalDebit ?? 0) ? '↑ Credit' : '↓ Debit'}
          icon={ArrowUpCircle} color="var(--text-secondary)"
        />
      </div>

      {/* ── Charts Row ── */}
      <div className={styles.top}>
        {/* Spending Chart */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Spending Timeline</span>
            <div className={styles.chartTabs}>
              {(['bar', 'area', 'pie'] as const).map(m => (
                <button key={m} className={`${styles.chartTab} ${chartMode === m ? styles.activeTab : ''}`}
                  onClick={() => setChartMode(m)}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={220}>
              {chartMode === 'pie' ? (
                <PieChart>
                  <Pie data={byCategory} dataKey="amount" nameKey="name" cx="50%" cy="50%"
                    outerRadius={85} innerRadius={40} paddingAngle={2}>
                    {byCategory.map((cat, i) => <Cell key={i} fill={cat.color} />)}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                  <Legend formatter={(v) => <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{v}</span>} />
                </PieChart>
              ) : chartMode === 'area' ? (
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="debitGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--error)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--error)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="creditGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--success)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={55}
                    tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="debit" name="Spent" stroke="var(--error)" fill="url(#debitGrad)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="credit" name="Received" stroke="var(--success)" fill="url(#creditGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              ) : (
                <BarChart data={chartData} barSize={12} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={55}
                    tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--surface-3)' }} />
                  <Bar dataKey="debit" name="Spent" fill="var(--error)" radius={[4, 4, 0, 0]} opacity={0.9} />
                  <Bar dataKey="credit" name="Received" fill="var(--success)" radius={[4, 4, 0, 0]} opacity={0.9} />
                </BarChart>
              )}
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
              <div key={cat.name} className={styles.catItem}
                onClick={() => setFilterCat(filterCat === cat.name ? 'all' : cat.name)}
                style={{ cursor: 'pointer', background: filterCat === cat.name ? 'var(--surface-2)' : undefined }}>
                <div className={styles.catDot} style={{ background: cat.color }} />
                <span className={styles.catName}>{cat.name}</span>
                <span className={styles.catPct}>{cat.pct}%</span>
                <div className={styles.catBarWrap}>
                  <div className={styles.catBar} style={{ width: `${cat.pct}%`, background: cat.color }} />
                </div>
                <span className={styles.catAmount}>
                  ₹{Number(cat.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Transactions Table ── */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Transactions <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({filtered.length})</span></span>
          <div className={styles.filters}>
            <div className={styles.searchWrap}>
              <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input className={styles.search} placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className={styles.select} value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="all">All</option>
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
            <select className={styles.select} value={filterCat} onChange={e => setFilterCat(e.target.value)}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className={styles.txTable}>
          <div className={styles.txHead}>
            <div className={styles.th}>Merchant</div>
            <div className={styles.th}>Description</div>
            <div className={styles.th}>Category</div>
            <div className={styles.th} style={{ textAlign: 'right' }}>Amount</div>
            <div className={styles.th} style={{ textAlign: 'right' }}>Date</div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No transactions match your filter
            </div>
          ) : filtered.map(tx => {
            const isDebit = tx.type === 'debit'
            const isUnknown = tx.tags?.includes('amount-unknown')
            return (
              <div key={tx.id} className={styles.txRow}>
                <div className={styles.merchant}>
                  <div className={styles.merchantIcon}
                    style={{ background: (CAT_COLORS[tx.category] ?? '#6b7280') + '22', color: CAT_COLORS[tx.category] ?? '#6b7280' }}>
                    {(tx.merchant ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className={styles.merchantName}>{tx.merchant ?? '—'}</div>
                    <div className={styles.merchantSub} style={{ color: CAT_COLORS[tx.category] ?? 'var(--text-muted)' }}>
                      {tx.category}
                    </div>
                  </div>
                </div>
                <div className={styles.txDesc}>{tx.description?.slice(0, 45) ?? '—'}</div>
                <div className={styles.categoryBadge} style={{
                  background: (CAT_COLORS[tx.category] ?? '#6b7280') + '22',
                  color: CAT_COLORS[tx.category] ?? 'var(--text-muted)'
                }}>
                  {tx.category}
                </div>
                <div className={`${styles.amount} ${isDebit ? styles.debit : styles.credit}`}>
                  {isUnknown ? (
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Unknown</span>
                  ) : (
                    <>
                      <span className={styles.amountSign}>{isDebit ? '−' : '+'}</span>
                      ₹{Number(Math.abs(tx.amount)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </>
                  )}
                </div>
                <div className={styles.date}>{format(new Date(tx.date), 'MMM d')}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
