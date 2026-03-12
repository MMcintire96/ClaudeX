import type { AutomationSchedule } from './types'

/**
 * Determine whether an automation is due to run based on its schedule and last run time.
 */
export function isDue(schedule: AutomationSchedule, lastRunAt: number | null, now: number): boolean {
  if (schedule.type === 'manual') return false

  if (schedule.type === 'interval') {
    const intervalMs = (schedule.intervalMinutes ?? 60) * 60_000
    if (lastRunAt === null) return true
    return (now - lastRunAt) >= intervalMs
  }

  if (schedule.type === 'hourly') {
    const target = parseHourlyTarget(schedule.hourlyMinute ?? 0, now)
    if (lastRunAt !== null && lastRunAt >= target) return false
    return now >= target
  }

  if (schedule.type === 'daily') {
    const target = parseDailyTarget(schedule.dailyAt ?? '09:00', now)
    if (lastRunAt !== null && lastRunAt >= target) return false
    return now >= target
  }

  if (schedule.type === 'weekdays') {
    const day = new Date(now).getDay()
    if (day === 0 || day === 6) return false // skip weekends
    const target = parseDailyTarget(schedule.dailyAt ?? '09:00', now)
    if (lastRunAt !== null && lastRunAt >= target) return false
    return now >= target
  }

  if (schedule.type === 'weekly') {
    const target = parseWeeklyTarget(schedule.weeklyDay ?? 1, schedule.weeklyAt ?? '09:00', now)
    if (lastRunAt !== null && lastRunAt >= target) return false
    return now >= target
  }

  if (schedule.type === 'monthly') {
    const target = parseMonthlyTarget(schedule.monthlyDay ?? 1, schedule.monthlyAt ?? '09:00', now)
    if (lastRunAt !== null && lastRunAt >= target) return false
    return now >= target
  }

  if (schedule.type === 'cron') {
    const expr = schedule.cronExpression
    if (!expr) return false
    return cronIsDue(expr, lastRunAt, now)
  }

  return false
}

/**
 * Compute the next run time for display purposes. Returns null for manual schedules.
 */
export function nextRunTime(schedule: AutomationSchedule, lastRunAt: number | null, now: number): number | null {
  if (schedule.type === 'manual') return null

  if (schedule.type === 'interval') {
    const intervalMs = (schedule.intervalMinutes ?? 60) * 60_000
    if (lastRunAt === null) return now
    return lastRunAt + intervalMs
  }

  if (schedule.type === 'hourly') {
    const target = parseHourlyTarget(schedule.hourlyMinute ?? 0, now)
    if (now >= target) {
      return target + 60 * 60_000 // next hour
    }
    return target
  }

  if (schedule.type === 'daily') {
    const target = parseDailyTarget(schedule.dailyAt ?? '09:00', now)
    if (now >= target) {
      return target + 24 * 60 * 60_000
    }
    return target
  }

  if (schedule.type === 'weekdays') {
    const target = parseDailyTarget(schedule.dailyAt ?? '09:00', now)
    const d = new Date(now >= target ? target + 24 * 60 * 60_000 : target)
    // Skip to next weekday
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() + 1)
    }
    const [hours, minutes] = (schedule.dailyAt ?? '09:00').split(':').map(Number)
    d.setHours(hours, minutes, 0, 0)
    return d.getTime()
  }

  if (schedule.type === 'weekly') {
    const target = parseWeeklyTarget(schedule.weeklyDay ?? 1, schedule.weeklyAt ?? '09:00', now)
    if (now >= target) {
      return target + 7 * 24 * 60 * 60_000
    }
    return target
  }

  if (schedule.type === 'monthly') {
    const target = parseMonthlyTarget(schedule.monthlyDay ?? 1, schedule.monthlyAt ?? '09:00', now)
    if (now >= target) {
      // Next month
      const d = new Date(target)
      d.setMonth(d.getMonth() + 1)
      return d.getTime()
    }
    return target
  }

  if (schedule.type === 'cron') {
    const expr = schedule.cronExpression
    if (!expr) return null
    return cronNextRun(expr, now)
  }

  return null
}

/**
 * Format a schedule for display.
 */
export function formatSchedule(schedule: AutomationSchedule): string {
  switch (schedule.type) {
    case 'manual':
      return 'Manual only'
    case 'interval':
      return `Every ${schedule.intervalMinutes ?? 60} min`
    case 'hourly': {
      const m = schedule.hourlyMinute ?? 0
      return m === 0 ? 'Every hour' : `Hourly at :${String(m).padStart(2, '0')}`
    }
    case 'daily':
      return `Daily at ${schedule.dailyAt ?? '09:00'}`
    case 'weekdays':
      return `Weekdays at ${schedule.dailyAt ?? '09:00'}`
    case 'weekly': {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      return `${days[schedule.weeklyDay ?? 1]} at ${schedule.weeklyAt ?? '09:00'}`
    }
    case 'monthly': {
      const day = schedule.monthlyDay ?? 1
      const suffix = getOrdinalSuffix(day)
      return `${day}${suffix} of month at ${schedule.monthlyAt ?? '09:00'}`
    }
    case 'cron':
      return schedule.cronExpression ?? 'Cron'
    default:
      return 'Unknown'
  }
}

// --- Helpers ---

function parseHourlyTarget(minute: number, now: number): number {
  const d = new Date(now)
  d.setMinutes(minute, 0, 0)
  if (d.getTime() > now) return d.getTime()
  // Already passed this hour, target is this hour's occurrence
  return d.getTime()
}

function parseDailyTarget(timeStr: string, now: number): number {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const d = new Date(now)
  d.setHours(hours, minutes, 0, 0)
  return d.getTime()
}

function parseWeeklyTarget(day: number, timeStr: string, now: number): number {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const d = new Date(now)
  const currentDay = d.getDay()
  let daysUntil = day - currentDay
  if (daysUntil < 0) daysUntil += 7
  d.setDate(d.getDate() + daysUntil)
  d.setHours(hours, minutes, 0, 0)
  return d.getTime()
}

function parseMonthlyTarget(day: number, timeStr: string, now: number): number {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const d = new Date(now)
  // Clamp day to last day of current month
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  d.setHours(hours, minutes, 0, 0)
  return d.getTime()
}

function getOrdinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th'
  switch (n % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

// --- Minimal cron support (5-field: min hour dom month dow) ---

function parseCronField(field: string, min: number, max: number): number[] {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/)
    const step = stepMatch ? parseInt(stepMatch[2]) : 1
    const range = stepMatch ? stepMatch[1] : part

    if (range === '*') {
      for (let i = min; i <= max; i += step) values.add(i)
    } else if (range.includes('-')) {
      const [lo, hi] = range.split('-').map(Number)
      for (let i = lo; i <= hi; i += step) values.add(i)
    } else {
      values.add(parseInt(range))
    }
  }
  return [...values].filter(v => v >= min && v <= max).sort((a, b) => a - b)
}

function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [minF, hourF, domF, monF, dowF] = parts
  const minute = date.getMinutes()
  const hour = date.getHours()
  const dom = date.getDate()
  const mon = date.getMonth() + 1
  const dow = date.getDay()

  return (
    parseCronField(minF, 0, 59).includes(minute) &&
    parseCronField(hourF, 0, 23).includes(hour) &&
    parseCronField(domF, 1, 31).includes(dom) &&
    parseCronField(monF, 1, 12).includes(mon) &&
    parseCronField(dowF, 0, 6).includes(dow)
  )
}

function cronIsDue(expr: string, lastRunAt: number | null, now: number): boolean {
  // Check current minute
  const d = new Date(now)
  d.setSeconds(0, 0)
  if (!cronMatches(expr, d)) return false
  // Ensure we haven't already run this minute
  if (lastRunAt !== null && lastRunAt >= d.getTime()) return false
  return true
}

function cronNextRun(expr: string, now: number): number | null {
  // Walk forward minute by minute, up to 366 days
  const limit = now + 366 * 24 * 60 * 60_000
  const d = new Date(now)
  d.setSeconds(0, 0)
  d.setTime(d.getTime() + 60_000) // start from next minute
  while (d.getTime() < limit) {
    if (cronMatches(expr, d)) return d.getTime()
    d.setTime(d.getTime() + 60_000)
  }
  return null
}
