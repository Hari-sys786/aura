import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import styles from './Layout.module.css'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Overview',
  '/emails': 'Emails',
  '/finance': 'Finance',
  '/calendar': 'Calendar',
  '/documents': 'Documents',
  '/subscriptions': 'Subscriptions',
  '/chat': 'Chat with Aura',
  '/settings': 'Settings',
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  const title = PAGE_TITLES[location.pathname] ?? 'Aura'

  return (
    <div className={styles.layout}>
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggle={() => setCollapsed(c => !c)}
        onOverlayClick={() => setMobileOpen(false)}
      />
      <div className={`${styles.main} ${collapsed ? styles.collapsed : ''}`}>
        <header className={styles.header}>
          <button className={styles.menuBtn} onClick={() => setMobileOpen(o => !o)}>
            <Menu size={18} />
          </button>
          <span className={styles.pageTitle}>{title}</span>
          <div className={styles.headerRight}>
            <div className={styles.statusDot} />
            <span className={styles.statusText}>Online</span>
          </div>
        </header>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
