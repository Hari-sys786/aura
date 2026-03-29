import { type LucideIcon } from 'lucide-react'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
}

export default function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.iconWrap}>
        <Icon size={28} strokeWidth={1.5} color="var(--text-muted)" />
      </div>
      <div className={styles.title}>{title}</div>
      {description && <div className={styles.desc}>{description}</div>}
    </div>
  )
}
