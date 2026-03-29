import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Mail, DollarSign, Calendar, FileText,
  CreditCard, MessageSquare, Settings, ChevronLeft, ChevronRight,
  Zap
} from 'lucide-react'
import styles from './Sidebar.module.css'

interface SidebarProps {
  collapsed: boolean
  mobileOpen: boolean
  onToggle: () => void
  onOverlayClick: () => void
}

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Overview', section: 'main' },
  { to: '/emails', icon: Mail, label: 'Emails', section: 'main' },
  { to: '/finance', icon: DollarSign, label: 'Finance', section: 'main' },
  { to: '/calendar', icon: Calendar, label: 'Calendar', section: 'main' },
  { to: '/documents', icon: FileText, label: 'Documents', section: 'main' },
  { to: '/subscriptions', icon: CreditCard, label: 'Subscriptions', section: 'main' },
  { to: '/chat', icon: MessageSquare, label: 'Chat with Aura', section: 'tools' },
  { to: '/settings', icon: Settings, label: 'Settings', section: 'tools' },
]

export default function Sidebar({ collapsed, mobileOpen, onToggle, onOverlayClick }: SidebarProps) {
  const sidebarClass = [
    styles.sidebar,
    collapsed ? styles.collapsed : '',
    mobileOpen ? styles.mobileOpen : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      {mobileOpen && <div className={styles.overlay} onClick={onOverlayClick} />}
      <nav className={sidebarClass}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>
            <Zap size={14} strokeWidth={2.5} />
          </div>
          <span className={styles.logoText}>Aura</span>
        </div>

        <div className={styles.nav}>
          <div className={styles.navSection}>
            <div className={styles.navLabel}>Main</div>
            {navItems.filter(i => i.section === 'main').map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `${styles.navItem} ${isActive ? styles.active : ''}`
                }
              >
                <item.icon className={styles.navIcon} size={18} strokeWidth={1.8} />
                <span className={styles.navItemText}>{item.label}</span>
              </NavLink>
            ))}
          </div>

          <div className={styles.navSection}>
            <div className={styles.navLabel}>Tools</div>
            {navItems.filter(i => i.section === 'tools').map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `${styles.navItem} ${isActive ? styles.active : ''}`
                }
              >
                <item.icon className={styles.navIcon} size={18} strokeWidth={1.8} />
                <span className={styles.navItemText}>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.collapseBtn} onClick={onToggle}>
            {collapsed
              ? <ChevronRight size={18} strokeWidth={1.8} />
              : <ChevronLeft size={18} strokeWidth={1.8} />
            }
            <span className={styles.collapseBtnText}>Collapse</span>
          </button>
        </div>
      </nav>
    </>
  )
}
