import { useSettingsStore } from '../stores/settingsStore'

/**
 * Play a notification sound. Tries the system sound via paplay first,
 * falls back to a Web Audio API two-tone chime.
 */
export function playNotificationSound(): void {
  if (!useSettingsStore.getState().notificationSounds) return

  // Try system sound via main process (paplay), fall back to Web Audio
  window.api.notification.playSound().then((ok) => {
    if (!ok) playWebAudioFallback()
  }).catch(() => {
    playWebAudioFallback()
  })
}

function playWebAudioFallback(): void {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime

    // First tone (C5 ~523 Hz)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.value = 523
    gain1.gain.setValueAtTime(0.15, now)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.15)

    // Second tone (E5 ~659 Hz)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.value = 659
    gain2.gain.setValueAtTime(0.15, now + 0.1)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.1)
    osc2.stop(now + 0.25)

    // Close the context after playback finishes to free resources
    osc2.onended = () => ctx.close().catch(() => {})
  } catch {
    // Audio not available — silently ignore
  }
}
