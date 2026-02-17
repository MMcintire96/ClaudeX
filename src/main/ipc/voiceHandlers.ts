import { ipcMain } from 'electron'
import { VoiceManager } from '../voice/VoiceManager'

export function registerVoiceHandlers(voiceManager: VoiceManager): void {
  ipcMain.handle('voice:transcribe', async (_event, pcmData: number[]) => {
    try {
      const float32 = new Float32Array(pcmData)
      const text = await voiceManager.transcribe(float32)
      return { success: true, text: text.trim() }
    } catch (err: any) {
      console.error('Transcription error:', err)
      return { success: false, error: err.message || 'Transcription failed' }
    }
  })

  ipcMain.handle('voice:status', () => {
    return {
      loaded: voiceManager.isLoaded(),
      loading: voiceManager.isLoading()
    }
  })
}
