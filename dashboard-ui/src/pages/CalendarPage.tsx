import { useQuery } from '@tanstack/react-query'
import { format, startOfWeek, addDays, isSameDay, parseISO } from 'date-fns'
import { Calendar } from 'lucide-react'
import { api } from '../api'
import { PageLoader } from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import styles from './CalendarPage.module.css'

export default function CalendarPage() {
  const { data: events, isLoading } = useQuery({
    queryKey: ['calendar'],
    queryFn: api.calendar,
  })

  if (isLoading) return <PageLoader />
  if (!events) return <EmptyState icon={Calendar} title="No events" />

  const today = new Date()
  const weekStart = startOfWeek(today, { weekStartsOn: 1 })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const upcoming = [...events]
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .filter(e => new Date(e.start) >= new Date(today.setHours(0, 0, 0, 0)))

  return (
    <div className={`${styles.page} fade-in`}>
      <div className={styles.layout}>
        {/* Week View */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>
              Week of {format(weekStart, 'MMM d')}
            </span>
          </div>
          <div className={styles.weekGrid}>
            {weekDays.map(day => {
              const dayEvents = events.filter(e => {
                try { return isSameDay(parseISO(e.start), day) } catch { return false }
              })
              const isToday = isSameDay(day, new Date())
              return (
                <div key={day.toISOString()} className={`${styles.dayCol} ${isToday ? styles.today : ''}`}>
                  <div className={styles.dayHead}>
                    <div className={styles.dayName}>{format(day, 'EEE')}</div>
                    <div className={styles.dayNum}>{format(day, 'd')}</div>
                  </div>
                  <div className={styles.dayEvents}>
                    {dayEvents.map(ev => (
                      <div key={ev.id} className={styles.miniEvent} title={ev.summary}>
                        {ev.summary}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Upcoming Events */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Upcoming</span>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState icon={Calendar} title="No upcoming events" />
          ) : (
            <div className={styles.eventList}>
              {upcoming.slice(0, 15).map(ev => {
                const start = new Date(ev.start)
                return (
                  <div key={ev.id} className={styles.eventItem}>
                    <div className={styles.eventDate}>
                      <div className={styles.eventDateDay}>{format(start, 'd')}</div>
                      <div className={styles.eventDateMonth}>{format(start, 'MMM')}</div>
                    </div>
                    <div className={styles.eventInfo}>
                      <div className={styles.eventTitle}>
                        {ev.summary}
                        {ev.allDay && <span className={styles.allDayBadge}>All day</span>}
                      </div>
                      {!ev.allDay && (
                        <div className={styles.eventTime}>
                          {format(start, 'h:mm a')}
                          {ev.end && ` → ${format(new Date(ev.end), 'h:mm a')}`}
                        </div>
                      )}
                      {ev.location && <div className={styles.eventLoc}>📍 {ev.location}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
