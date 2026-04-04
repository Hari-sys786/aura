/**
 * IST Timezone Utility — all date operations use IST (UTC+5:30)
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +5:30

/** Get current time in IST */
export function nowIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/** Today's date in IST as YYYY-MM-DD */
export function todayIST(): string {
  return nowIST().toISOString().slice(0, 10);
}

/** Current month in IST as YYYY-MM */
export function monthIST(): string {
  return todayIST().slice(0, 7);
}

/** Convert any UTC date string to IST date string YYYY-MM-DD */
export function toISTDate(utcDateStr: string): string {
  if (!utcDateStr) return '';
  const utc = new Date(utcDateStr);
  if (isNaN(utc.getTime())) return '';
  const ist = new Date(utc.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 10);
}

/** Convert any UTC date string to IST datetime string YYYY-MM-DD HH:MM IST */
export function toISTDateTime(utcDateStr: string): string {
  if (!utcDateStr) return '';
  const utc = new Date(utcDateStr);
  if (isNaN(utc.getTime())) return '';
  const ist = new Date(utc.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 16).replace('T', ' ') + ' IST';
}

/** Format for display: "Apr 4, 2026 4:30 PM IST" */
export function toISTDisplay(utcDateStr: string): string {
  if (!utcDateStr) return '';
  const utc = new Date(utcDateStr);
  if (isNaN(utc.getTime())) return '';
  const ist = new Date(utc.getTime() + IST_OFFSET_MS);
  return ist.toLocaleString('en-IN', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' IST';
}

/** IANA timezone string for IST */
export const IST_TIMEZONE = 'Asia/Kolkata';
