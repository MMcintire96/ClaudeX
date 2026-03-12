import type { AutomationSchedule } from '../../stores/automationStore'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getOrdinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th'
  switch (n % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

export function formatSchedule(schedule: AutomationSchedule): string {
  switch (schedule.type) {
    case 'manual':
      return 'Manual'
    case 'interval':
      return `Every ${schedule.intervalMinutes ?? 60}m`
    case 'hourly': {
      const m = schedule.hourlyMinute ?? 0
      return m === 0 ? 'Every hour' : `Hourly at :${String(m).padStart(2, '0')}`
    }
    case 'daily':
      return `Daily at ${schedule.dailyAt ?? '09:00'}`
    case 'weekdays':
      return `Weekdays at ${schedule.dailyAt ?? '09:00'}`
    case 'weekly':
      return `${DAYS[schedule.weeklyDay ?? 1]} at ${schedule.weeklyAt ?? '09:00'}`
    case 'monthly': {
      const day = schedule.monthlyDay ?? 1
      return `${day}${getOrdinalSuffix(day)} of month at ${schedule.monthlyAt ?? '09:00'}`
    }
    case 'cron':
      return schedule.cronExpression ?? 'Cron'
    default:
      return 'Unknown'
  }
}
