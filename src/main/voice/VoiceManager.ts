import { app } from 'electron'
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { join } from 'path'

const MODEL_ID = 'onnx-community/whisper-tiny.en'

export class VoiceManager {
  private transcriber: AutomaticSpeechRecognitionPipeline | null = null
  private loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null

  private async getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
    if (this.transcriber) return this.transcriber

    if (this.loading) return this.loading

    this.loading = (async () => {
      const cacheDir = join(app.getPath('userData'), 'whisper-models')
      const t = await pipeline('automatic-speech-recognition', MODEL_ID, {
        cache_dir: cacheDir,
        dtype: 'fp32'
      })
      this.transcriber = t
      this.loading = null
      return t
    })()

    return this.loading
  }

  /**
   * Transcribe raw audio.
   * Accepts a Float32Array of 16kHz mono PCM samples.
   */
  async transcribe(audioData: Float32Array): Promise<string> {
    const transcriber = await this.getTranscriber()
    const result = await transcriber(audioData)
    // result can be { text: string } or array
    if (Array.isArray(result)) {
      return result.map((r: any) => r.text).join(' ')
    }
    return (result as any).text || ''
  }

  isLoaded(): boolean {
    return this.transcriber !== null
  }

  isLoading(): boolean {
    return this.loading !== null
  }

  destroy(): void {
    this.transcriber = null
    this.loading = null
  }
}
