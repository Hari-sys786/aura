import { useMemo, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  DollarSign, TrendingDown, TrendingUp, ArrowDownCircle, ArrowUpCircle,
  Search, Bell, Calendar, ChevronLeft, ChevronRight, CalendarDays
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, PieChart, Pie, Legend
} from 'recharts'
import { api } from '../api'
import { PageLoader } from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import styles from './Finance.module.css'

const CAT_COLORS: Record<string, string> = {
  shopping:   '#e8a03e',
  transfer:   '#60a5fa',
  fuel:       '#4ade80',
  grocery:    '#f87171',
  transport:  '#c084fc',
  food:       '#34d399',
  investment: '#fb923c',
  insurance:  '#818cf8',
  emi:        '#f472b6',
  recharge:   '#38bdf8',
  bills:      '#a78bfa',
  other:      '#6b7280',
}
const colorFor = (cat: string, idx: number) =>
  CAT_COLORS[cat] ?? Object.values(CAT_COLORS)[idx % Object.values(CAT_COLORS).length]

const PAGE_SIZE = 20

// ─── Tooltip ──────────────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface-3)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', minWidth: 130,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 2 }}>
          <span style={{ fontSize: 12, color: p.color }}>{p.name}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: p.color, fontFamily: 'var(--font-mono)' }}>
            ₹{Number(p.value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
        </div>
      ))}
    </div>
  )
}

const PieTip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div style={{ background:'var(--surface-3)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 12px' }}>
      <div style={{ fontSize:12, color:d.payload.fill, fontWeight:600 }}>{d.name}</div>
      <div style={{ fontSize:13, fontFamily:'var(--font-mono)', color:'var(--text-primary)' }}>
        ₹{Number(d.value).toLocaleString('en-IN',{maximumFractionDigits:0})}
        <span style={{ color:'var(--text-muted)', marginLeft:6 }}>({d.payload.pct}%)</span>
      </div>
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, icon: Icon, color, isCount }: any) => (
  <div className={styles.statCard}>
    <div className={styles.statIcon} style={{ background: color + '22', color }}>
      <Icon size={18} />
    </div>
    <div className={styles.statBody}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>
        {isCount
          ? Number(value).toLocaleString('en-IN')
          : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
      </div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  </div>
)

export default function Finance() {
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [chartMode, setChartMode] = useState<'bar' | 'area' | 'pie'>('bar')
  const [page, setPage] = useState(1)
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'))
  const [monthInitialized, setMonthInitialized] = useState(false)

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.transactions(2000),
  })

  // ── Derive available months from all transactions ─────────────────────────
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>()
    for (const t of transactions) {
      if (t.date) monthSet.add(format(new Date(t.date), 'yyyy-MM'))
    }
    return [...monthSet].sort((a, b) => b.localeCompare(a)) // newest first
  }, [transactions])

  // ── Auto-select the month with most transactions on first load ────────────
  useEffect(() => {
    if (monthInitialized || !transactions.length || !availableMonths.length) return
    // Count per month
    const countMap = new Map<string, number>()
    for (const t of transactions) {
      if (!t.date) continue
      const m = format(new Date(t.date), 'yyyy-MM')
      countMap.set(m, (countMap.get(m) ?? 0) + 1)
    }
    // Pick month with most transactions
    const best = [...countMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (best) setSelectedMonth(best)
    setMonthInitialized(true)
  }, [transactions, availableMonths, monthInitialized])

  // ── Transactions filtered to selected month ────────────────────────────────
  const monthTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (!t.date) return false
      return format(new Date(t.date), 'yyyy-MM') === selectedMonth
    })
  }, [transactions, selectedMonth])

  const { data: bills = [] } = useQuery({
    queryKey: ['bills'],
    queryFn: async () => {
      const token = localStorage.getItem('aura_token') || ''
      const r = await fetch('/api/bills', { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) return []
      const data = await r.json()
      return Array.isArray(data) ? data : []
    },
  })

  // ── Derived analytics (scoped to selected month) ──────────────────────────
  const { byCategory, chartData, stats, categories } = useMemo(() => {
    if (!monthTransactions.length) return { byCategory: [], chartData: [], stats: null, categories: ['all'] }

    let totalDebit = 0, totalCredit = 0
    const catMap = new Map<string, number>()
    const dayMap = new Map<string, { debit: number; credit: number }>()

    for (const t of monthTransactions) {
      const isDebit = t.type === 'debit'
      const amt = Math.abs(t.amount ?? 0)
      const date = new Date(t.date)
      const dayKey = format(date, 'd')  // just day number within month

      if (isDebit) {
        totalDebit += amt
        catMap.set(t.category, (catMap.get(t.category) ?? 0) + amt)
      } else {
        totalCredit += amt
      }

      const entry = dayMap.get(dayKey) ?? { debit: 0, credit: 0 }
      if (isDebit) entry.debit += amt
      else entry.credit += amt
      dayMap.set(dayKey, entry)
    }

    const totalCat = [...catMap.values()].reduce((a, b) => a + b, 0)
    const byCategory = [...catMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount], i) => ({
        name, amount, pct: totalCat ? Math.round(amount / totalCat * 100) : 0,
        color: colorFor(name, i), fill: colorFor(name, i),
      }))

    // Sort by day number
    const chartData = [...dayMap.entries()]
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([day, v]) => ({ day, ...v }))

    const categories = ['all', ...new Set(monthTransactions.map(t => t.category).filter(Boolean))]

    return {
      byCategory, chartData, categories,
      stats: { totalDebit, totalCredit },
    }
  }, [monthTransactions])

  // ── Category filter also changes chart ────────────────────────────────────
  const filteredChartData = useMemo(() => {
    if (filterCat === 'all' || chartMode === 'pie') return chartData

    // Re-compute dayMap for selected category only within selected month
    const dayMap = new Map<string, { debit: number; credit: number }>()
    for (const t of monthTransactions) {
      if (t.category !== filterCat) continue
      const isDebit = t.type === 'debit'
      const amt = Math.abs(t.amount ?? 0)
      const dayKey = format(new Date(t.date), 'd')
      const entry = dayMap.get(dayKey) ?? { debit: 0, credit: 0 }
      if (isDebit) entry.debit += amt
      else entry.credit += amt
      dayMap.set(dayKey, entry)
    }
    return [...dayMap.entries()]
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([day, v]) => ({ day, ...v }))
  }, [chartData, filterCat, monthTransactions, chartMode])

  // ── Filtered transactions ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return monthTransactions.filter(t => {
      if (filterCat !== 'all' && t.category !== filterCat) return false
      if (filterType !== 'all' && t.type !== filterType) return false
      if (search) {
        const q = search.toLowerCase()
        if (!t.merchant?.toLowerCase().includes(q) &&
            !(t as any).description?.toLowerCase().includes(q) &&
            !t.category?.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [monthTransactions, filterCat, filterType, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset page on filter change
  const setFilter = (fn: () => void) => { fn(); setPage(1) }

  // ── Upcoming bills reminder ───────────────────────────────────────────────
  const upcomingBills = useMemo(() => {
    const now = new Date()
    return (bills as any[])
      .filter((b: any) => b.dueDate && b.amount > 0)
      .map((b: any) => {
        // Parse "April 15, 2026" format
        const due = new Date(b.dueDate)
        const daysLeft = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        return { ...b, due, daysLeft }
      })
      .filter((b: any) => !isNaN(b.due.getTime()) && b.daysLeft >= 0 && b.daysLeft <= 30)
      .sort((a: any, b: any) => a.daysLeft - b.daysLeft)
  }, [bills])

  if (isLoading) return <PageLoader />
  if (!transactions.length) return <EmptyState icon={DollarSign} title="No transactions" description="Transactions will appear here once emails are synced" />

  const selectedMonthLabel = availableMonths.length
    ? format(new Date(selectedMonth + '-01'), 'MMMM yyyy')
    : ''

  return (
    <div className={`${styles.page} fade-in`}>

      {/* ── Month Selector ── */}
      <div className={styles.monthSelector}>
        <div className={styles.monthLabel}>
          <CalendarDays size={15} style={{ color: 'var(--accent)' }} />
          <span>Month</span>
        </div>
        <div className={styles.monthTabs}>
          {availableMonths.map(m => (
            <button
              key={m}
              className={`${styles.monthTab} ${selectedMonth === m ? styles.activeMonthTab : ''}`}
              onClick={() => { setSelectedMonth(m); setPage(1); setFilterCat('all'); setFilterType('all'); setSearch('') }}
            >
              {format(new Date(m + '-01'), 'MMM yy')}
            </button>
          ))}
        </div>
      </div>

      {/* ── Upcoming Bill Reminders ── */}
      {upcomingBills.length > 0 && (
        <div className={styles.reminders}>
          <div className={styles.reminderHead}>
            <Bell size={14} style={{ color: 'var(--warning)' }} />
            <span>Upcoming Bills</span>
          </div>
          <div className={styles.reminderList}>
            {upcomingBills.map((b: any, i: number) => (
              <div key={i} className={styles.reminderItem}
                style={{ borderLeft: `3px solid ${b.daysLeft <= 3 ? 'var(--error)' : b.daysLeft <= 7 ? 'var(--warning)' : 'var(--accent)'}` }}>
                <div className={styles.reminderIcon}>
                  <Calendar size={14} />
                </div>
                <div className={styles.reminderBody}>
                  <div className={styles.reminderVendor}>{b.vendor}{b.cardLast4 ? ` (xxxx-${b.cardLast4})` : ''}</div>
                  <div className={styles.reminderSub}>{b.dueDate}</div>
                </div>
                <div className={styles.reminderRight}>
                  <div className={styles.reminderAmount}>₹{Number(b.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                  <div className={styles.reminderDays}
                    style={{ color: b.daysLeft <= 3 ? 'var(--error)' : b.daysLeft <= 7 ? 'var(--warning)' : 'var(--text-muted)' }}>
                    {b.daysLeft === 0 ? 'Due today' : b.daysLeft === 1 ? 'Due tomorrow' : `${b.daysLeft}d left`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Stat Cards ── */}
      <div className={styles.statRow}>
        <StatCard label="Total Spent" value={stats?.totalDebit ?? 0} sub={selectedMonthLabel} icon={TrendingDown} color="var(--error)" />
        <StatCard label="Total Received" value={stats?.totalCredit ?? 0} sub={selectedMonthLabel} icon={TrendingUp} color="var(--success)" />
        <StatCard label="Transactions" value={monthTransactions.length} sub={`in ${selectedMonthLabel}`} icon={ArrowDownCircle} color="var(--accent)" isCount />
        <StatCard
          label="Net"
          value={Math.abs((stats?.totalCredit ?? 0) - (stats?.totalDebit ?? 0))}
          sub={(stats?.totalCredit ?? 0) >= (stats?.totalDebit ?? 0) ? '↑ Surplus' : '↓ Deficit'}
          icon={ArrowUpCircle} color="var(--text-secondary)"
        />
      </div>

      {/* ── Charts Row ── */}
      <div className={styles.top}>
        {/* Spending Chart */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>
              Spending{filterCat !== 'all' ? ` — ${filterCat}` : ''}
            </span>
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
            {filteredChartData.length === 0 ? (
              <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No data for selected filter
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                {chartMode === 'pie' ? (
                  <PieChart>
                    <Pie data={byCategory} dataKey="amount" nameKey="name"
                      cx="50%" cy="50%" outerRadius={85} innerRadius={45} paddingAngle={2}>
                      {byCategory.map((cat, i) => <Cell key={i} fill={cat.color} />)}
                    </Pie>
                    <Tooltip content={<PieTip />} />
                    <Legend formatter={v => <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{v}</span>} />
                  </PieChart>
                ) : chartMode === 'area' ? (
                  <AreaChart data={filteredChartData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="gDebit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--error)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="var(--error)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gCredit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--success)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false}
                      width={55} tickFormatter={v => v == null ? '' : v >= 1000 ? `₹${(v/1000).toFixed(0)}k` : `₹${v}`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="debit" name="Spent" stroke="var(--error)" fill="url(#gDebit)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="credit" name="Received" stroke="var(--success)" fill="url(#gCredit)" strokeWidth={2} dot={false} />
                  </AreaChart>
                ) : (
                  <BarChart data={filteredChartData} barSize={14} barGap={2} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false}
                      width={55} tickFormatter={v => v == null ? '' : v >= 1000 ? `₹${(v/1000).toFixed(0)}k` : `₹${v}`} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-3)' }} />
                    <Bar dataKey="debit" name="Spent" fill="var(--error)" radius={[4,4,0,0]} />
                    <Bar dataKey="credit" name="Received" fill="var(--success)" radius={[4,4,0,0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Category Breakdown — click to filter */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>By Category</span>
            {filterCat !== 'all' && (
              <button className={styles.clearFilter} onClick={() => setFilter(() => setFilterCat('all'))}>
                Clear filter ×
              </button>
            )}
          </div>
          <div className={styles.catList}>
            {byCategory.map(cat => (
              <div key={cat.name} className={styles.catItem}
                style={{ background: filterCat === cat.name ? 'var(--surface-2)' : undefined, cursor: 'pointer' }}
                onClick={() => setFilter(() => setFilterCat(filterCat === cat.name ? 'all' : cat.name))}>
                <div className={styles.catDot} style={{ background: cat.color }} />
                <span className={styles.catName}>{cat.name}</span>
                <div className={styles.catBarWrap}>
                  <div className={styles.catBar} style={{ width: `${cat.pct}%`, background: cat.color }} />
                </div>
                <span className={styles.catPct}>{cat.pct}%</span>
                <span className={styles.catAmount}>
                  ₹{Number(cat.amount).toLocaleString('en-IN',{maximumFractionDigits:0})}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Transactions Table ── */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>
            Transactions
            <span style={{ color:'var(--text-muted)', fontWeight:400, marginLeft:6 }}>
              ({filtered.length}{filtered.length !== transactions.length ? ` of ${transactions.length}` : ''})
            </span>
          </span>
          <div className={styles.filters}>
            <div className={styles.searchWrap}>
              <Search size={13} style={{ color:'var(--text-muted)', flexShrink:0 }} />
              <input className={styles.search} placeholder="Search merchant, category..."
                value={search} onChange={e => setFilter(() => setSearch(e.target.value))} />
            </div>
            <select className={styles.select} value={filterType}
              onChange={e => setFilter(() => setFilterType(e.target.value))}>
              <option value="all">All types</option>
              <option value="debit">Debit only</option>
              <option value="credit">Credit only</option>
            </select>
            <select className={styles.select} value={filterCat}
              onChange={e => setFilter(() => setFilterCat(e.target.value))}>
              {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
            </select>
          </div>
        </div>

        <div className={styles.txTable}>
          <div className={styles.txHead}>
            <div className={styles.th}>Merchant</div>
            <div className={styles.th}>Description</div>
            <div className={styles.th}>Category</div>
            <div className={styles.th} style={{ textAlign:'right' }}>Amount</div>
            <div className={styles.th} style={{ textAlign:'right' }}>Date</div>
          </div>

          {paginated.length === 0 ? (
            <div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
              No transactions match your filters
            </div>
          ) : paginated.map(tx => {
            const isDebit = tx.type === 'debit'
            const isUnknown = (tx as any).tags?.includes('amount-unknown') || tx.amount === 0
            const color = colorFor(tx.category, 0)
            return (
              <div key={tx.id} className={styles.txRow}>
                <div className={styles.merchant}>
                  <div className={styles.merchantIcon} style={{ background: color + '22', color }}>
                    {(tx.merchant ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className={styles.merchantName}>{tx.merchant ?? '—'}</div>
                </div>
                <div className={styles.txDesc}>{(tx as any).description?.slice(0, 50) ?? '—'}</div>
                <div className={styles.categoryBadge} style={{ background: color + '22', color }}>
                  {tx.category}
                </div>
                <div className={`${styles.amount} ${isDebit ? styles.debit : styles.credit}`}>
                  {isUnknown
                    ? <span style={{ color:'var(--text-muted)', fontSize:11 }}>unknown</span>
                    : <>{isDebit ? '−' : '+'}₹{Number(Math.abs(tx.amount ?? 0)).toLocaleString('en-IN',{maximumFractionDigits:0})}</>
                  }
                </div>
                <div className={styles.date}>
                  {tx.date ? format(new Date(tx.date), 'MMM d') : '—'}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className={styles.pagination}>
            <span className={styles.pageInfo}>
              Page {page} of {totalPages} · {filtered.length} records
            </span>
            <div className={styles.pageControls}>
              <button className={styles.pageBtn} disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}>
                <ChevronLeft size={15} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = totalPages <= 5 ? i + 1
                  : page <= 3 ? i + 1
                  : page >= totalPages - 2 ? totalPages - 4 + i
                  : page - 2 + i
                return (
                  <button key={p} className={`${styles.pageBtn} ${page === p ? styles.activeBtn : ''}`}
                    onClick={() => setPage(p)}>{p}</button>
                )
              })}
              <button className={styles.pageBtn} disabled={page === totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
