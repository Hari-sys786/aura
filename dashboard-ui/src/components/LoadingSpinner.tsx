import styles from './LoadingSpinner.module.css'

export default function LoadingSpinner({ size = 24 }: { size?: number }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.spinner} style={{ width: size, height: size }} />
    </div>
  )
}

export function PageLoader() {
  return (
    <div className={styles.page}>
      <div className={styles.spinner} style={{ width: 32, height: 32 }} />
      <span className={styles.text}>Loading…</span>
    </div>
  )
}
