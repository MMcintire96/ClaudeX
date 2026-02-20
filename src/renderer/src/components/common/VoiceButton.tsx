import React, { useCallback, useRef, useState, useEffect } from 'react'

interface Props {
  onTranscript: (text: string) => void
  inline?: boolean
}

/**
 * Resample audio buffer to 16kHz mono Float32Array for Whisper.
 */
async function audioBufferToFloat32_16k(audioBuffer: AudioBuffer): Promise<Float32Array> {
  // Create offline context at 16kHz
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * 16000), 16000)
  const source = offlineCtx.createBufferSource()
  source.buffer = audioBuffer
  source.connect(offlineCtx.destination)
  source.start()
  const resampled = await offlineCtx.startRendering()
  return resampled.getChannelData(0)
}

export default function VoiceButton({ onTranscript, inline = false }: Props) {
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [modelStatus, setModelStatus] = useState<'unknown' | 'loading' | 'ready'>('unknown')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  // Check model status on mount
  useEffect(() => {
    window.api.voice.status().then(s => {
      setModelStatus(s.loaded ? 'ready' : s.loading ? 'loading' : 'unknown')
    })
  }, [])

  const stopRecording = useCallback(async () => {
    setListening(false)

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    // Stop returns data via ondataavailable, then we process
    return new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        chunksRef.current = []
        mediaRecorderRef.current = null

        // Stop mic
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop())
          streamRef.current = null
        }

        if (blob.size === 0) {
          resolve()
          return
        }

        setTranscribing(true)
        setModelStatus('loading')

        try {
          // Decode audio blob to AudioBuffer
          const arrayBuf = await blob.arrayBuffer()
          const audioCtx = new AudioContext()
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuf)
          await audioCtx.close()

          // Resample to 16kHz mono
          const pcm = await audioBufferToFloat32_16k(audioBuffer)

          // Send as plain array over IPC (Float32Array doesn't serialize well through contextBridge)
          const result = await window.api.voice.transcribe(Array.from(pcm))

          if (result.success && result.text) {
            setModelStatus('ready')
            const trimmed = result.text.trim()
            if (!/^\[.*\]$/.test(trimmed)) {
              onTranscript(result.text)
            }
          } else if (result.error) {
            console.error('Transcription error:', result.error)
            setModelStatus('ready')
          }
        } catch (err) {
          console.error('Voice processing error:', err)
        }

        setTranscribing(false)
        resolve()
      }

      recorder.stop()
    })
  }, [onTranscript])

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      recorder.start()
      setListening(true)
    } catch (err) {
      console.error('Microphone access denied:', err)
    }
  }, [])

  const toggle = useCallback(() => {
    if (listening) {
      stopRecording()
    } else {
      startRecording()
    }
  }, [listening, startRecording, stopRecording])

  // Listen for voice-toggle custom event (from hotkey)
  useEffect(() => {
    const handler = () => toggle()
    window.addEventListener('voice-toggle', handler)
    return () => window.removeEventListener('voice-toggle', handler)
  }, [toggle])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
    }
  }, [])

  const title = transcribing
    ? (modelStatus === 'loading' ? 'Loading model…' : 'Transcribing…')
    : listening
      ? 'Click to stop recording'
      : 'Voice input'

  const baseClass = inline ? 'voice-inline' : 'voice-fab'
  const className = `${baseClass} ${listening ? 'voice-active' : ''} ${transcribing ? 'voice-transcribing' : ''}`
  const iconSize = inline ? '16' : '20'

  return (
    <button
      className={className}
      onClick={toggle}
      disabled={transcribing}
      title={title}
    >
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    </button>
  )
}
