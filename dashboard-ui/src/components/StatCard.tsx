import { type LucideIcon } from 'lucide-react'
import styles from './StatCard.module.css'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  color?: string
  loading?: boolean
}

export default function StatCard({ label, value, sub, icon: Icon, color = '#e8a03e', loading }: StatCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        <div className={styles.iconWrap} style={{ background: `${color}18` }}>
          <Icon size={16} color={color} strokeWidth={2} />
        </div>
      </div>
      {loading ? (
        <>
          <div className={styles.skeletonValue} />
          <div className={styles.skeletonSub} />
        </>
      ) : (
        <>
          <div className={styles.value}>{value}</div>
          {sub && <div className={styles.sub}>{sub}</div>}
        </>
      )}
    </div>
  )
}
