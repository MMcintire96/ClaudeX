/**
 * Send a Linux desktop notification via notify-send and play a sound.
 * Always fires regardless of window focus state.
 */
export function sendNotification(title: string, body: string): void {
  window.api.notification.send(title, body)
}

/**
 * Play just the notification sound (no desktop notification).
 */
export function playNotificationSound(): void {
  window.api.notification.playSound().catch(() => {})
}
