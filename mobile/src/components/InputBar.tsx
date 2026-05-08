import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, desktopSettings } from '../api'
import {
  addUserMessage, getSlim, setProcessing,
  setSelectedEffort, setSelectedModel, setSuggestion, useSnapshot
} from '../state/store'
import { sessionNeedsInput } from '@shared/sessionEvents'
import { SendIcon, StopIcon } from './Icons'

interface ModelOpt {
  id: string
  label: string
  provider: 'anthropic' | 'openai'
  effortLevels: ReadonlyArray<'low' | 'medium' | 'high' | 'max'> | null
}

const MODELS: ModelOpt[] = [
  { id: 'claude-opus-4-7', label: 'Opus 4.7', provider: 'anthropic', effortLevels: ['low', 'medium', 'high'] },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', provider: 'anthropic', effortLevels: ['low', 'medium', 'high'] },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', provider: 'anthropic', effortLevels: ['low', 'medium', 'high'] },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', provider: 'anthropic', effortLevels: null },
  { id: 'gpt-5-codex-mini', label: 'Codex Mini', provider: 'openai', effortLevels: null },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', provider: 'openai', effortLevels: null },
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai', effortLevels: null }
]

const DEFAULT_MODEL = 'claude-opus-4-7'
const DEFAULT_EFFORT: 'low' | 'medium' | 'high' | 'max' = 'high'

const PLAN_PREFIX =
  'Plan first before implementing. Use EnterPlanMode to explore the codebase and design an approach, then present your plan for my approval before writing any code.'

interface Props {
  sessionId: string
}

/** Lock icon — closed (Supervised) or open (YOLO). */
function PermIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      {open ? <path d="M7 11V7a5 5 0 0 1 9.9-1" /> : <path d="M7 11V7a5 5 0 0 1 10 0v4" />}
    </svg>
  )
}

/** Document/page icon — Plan vs Chat. */
function PlanIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  )
}

function Chevron(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function InputBar({ sessionId }: Props): JSX.Element {
  useSnapshot(() => Date.now())
  const slim = getSlim(sessionId)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [planMode, setPlanMode] = useState(false)
  const [skipPermissions, setSkipPermissions] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const needsInput = useMemo(() => sessionNeedsInput(slim), [slim])
  const model = slim.selectedModel || DEFAULT_MODEL
  const effort = (slim.selectedEffort as 'low' | 'medium' | 'high' | 'max' | null) || DEFAULT_EFFORT
  const modelMeta = MODELS.find(m => m.id === model) ?? MODELS[0]
  const effortLevels = modelMeta.effortLevels

  // Hydrate global YOLO from desktop settings on mount.
  useEffect(() => {
    let cancelled = false
    desktopSettings.get()
      .then(r => {
        if (cancelled) return
        setSkipPermissions(!!r.settings?.claude?.dangerouslySkipPermissions)
      })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [])

  // Close the model picker on outside click.
  useEffect(() => {
    if (!configOpen) return
    const close = (e: MouseEvent | TouchEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setConfigOpen(false)
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('touchstart', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('touchstart', close)
    }
  }, [configOpen])

  const send = useCallback(async () => {
    let content = draft.trim()
    if (!content || busy) return
    if (planMode) {
      content = `${PLAN_PREFIX}\n\n${content}`
      setPlanMode(false)
    }
    setBusy(true)
    setError(null)
    setDraft('')
    setSuggestion(sessionId, null)
    try {
      // Show the literal payload (incl. plan-mode prefix) so the user can see
      // exactly what the agent will receive.
      addUserMessage(sessionId, content)
      await api.send(sessionId, content)
      setProcessing(sessionId, true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [draft, busy, planMode, sessionId])

  const stop = useCallback(async () => {
    try { await api.stop(sessionId) } catch (err) { setError((err as Error).message) }
  }, [sessionId])

  const acceptSuggestion = useCallback(() => {
    const s = slim.suggestion
    if (!s) return
    setDraft(s)
    setSuggestion(sessionId, null)
    requestAnimationFrame(() => taRef.current?.focus())
  }, [slim.suggestion, sessionId])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Tab' && slim.suggestion && !draft) {
      e.preventDefault()
      acceptSuggestion()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }, [slim.suggestion, draft, acceptSuggestion, send])

  const handleModelChange = useCallback(async (newModel: string): Promise<void> => {
    setSelectedModel(sessionId, newModel)
    const newMeta = MODELS.find(m => m.id === newModel)
    // If the new model doesn't support effort, drop ours.
    if (!newMeta?.effortLevels && slim.selectedEffort) {
      setSelectedEffort(sessionId, null)
    }
    setConfigOpen(false)
    try {
      await api.setModel(sessionId, newModel)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [sessionId, slim.selectedEffort])

  const handleEffortChange = useCallback(async (newEffort: 'low' | 'medium' | 'high' | 'max'): Promise<void> => {
    setSelectedEffort(sessionId, newEffort)
    try {
      await api.setEffort(sessionId, newEffort)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [sessionId])

  const togglePermissions = useCallback(async (): Promise<void> => {
    const next = !skipPermissions
    setSkipPermissions(next)
    try {
      await desktopSettings.update({ claude: { dangerouslySkipPermissions: next } })
    } catch (err) {
      setError((err as Error).message)
      // Revert on failure.
      setSkipPermissions(!next)
    }
  }, [skipPermissions])

  const placeholder = slim.isProcessing
    ? 'Agent is running…'
    : (needsInput ? 'Answer the question' : 'Message the agent (Enter to send)')

  return (
    <div className="input-bar-wrap">
      {error && <div className="banner-error">{error}</div>}
      <div className="input-bar">
        <div className="input-textarea-wrapper">
          {/* Ghost overlay: show the suggestion as placeholder when input is empty. */}
          {!draft && slim.suggestion && (
            <div className="input-suggestion-ghost" aria-hidden="true">
              {slim.suggestion}
              <span className="input-suggestion-hint">Tab</span>
            </div>
          )}
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={!slim.suggestion ? placeholder : ''}
            rows={2}
            spellCheck
          />
        </div>

        <div className="input-bar-toolbar">
          <div className="input-bar-toolbar-left">
            <div className="config-picker-wrapper" ref={wrapperRef}>
              <button
                className="btn-config-picker"
                onClick={(e) => { e.stopPropagation(); setConfigOpen(o => !o) }}
                title="Model & reasoning settings"
              >
                <span className="config-picker-label">{modelMeta.label}</span>
                {effortLevels && (
                  <>
                    <span className="config-picker-dot">·</span>
                    <span className="config-picker-effort">{effort}</span>
                  </>
                )}
                <Chevron />
              </button>
              {configOpen && (
                <div className="config-picker-dropdown">
                  <div className="config-picker-section">
                    <div className="config-picker-section-label">Model</div>
                    <div className="model-picker-group-label">Anthropic</div>
                    {MODELS.filter(m => m.provider === 'anthropic').map(m => (
                      <button
                        key={m.id}
                        className={'model-picker-option' + (m.id === model ? ' active' : '')}
                        onClick={() => void handleModelChange(m.id)}
                      >
                        {m.label}
                      </button>
                    ))}
                    <div className="model-picker-group-label">OpenAI</div>
                    {MODELS.filter(m => m.provider === 'openai').map(m => (
                      <button
                        key={m.id}
                        className={'model-picker-option' + (m.id === model ? ' active' : '')}
                        onClick={() => void handleModelChange(m.id)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {effortLevels && (
                    <div className="config-picker-section">
                      <div className="config-picker-section-label">Reasoning Effort</div>
                      {effortLevels.map(level => (
                        <button
                          key={level}
                          className={'effort-picker-option' + (level === effort ? ' active' : '')}
                          onClick={() => void handleEffortChange(level)}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <span className="toolbar-separator">|</span>
            <button
              className={'btn-plan-mode' + (planMode ? ' active' : '')}
              onClick={() => setPlanMode(p => !p)}
              title={planMode ? 'Plan mode ON' : 'Plan mode OFF'}
            >
              <PlanIcon />
              {planMode ? 'Plan' : 'Chat'}
            </button>

            <span className="toolbar-separator">|</span>
            <button
              className={'btn-access-mode' + (skipPermissions ? ' yolo' : '')}
              onClick={() => void togglePermissions()}
              title={skipPermissions ? 'YOLO — Claude can run all tools without asking' : 'Supervised — Claude will ask before running tools'}
            >
              <PermIcon open={skipPermissions} />
              {skipPermissions ? 'YOLO' : 'Supervised'}
            </button>
          </div>

          <div className="input-actions">
            {slim.isProcessing && (
              <button className="btn-secondary" onClick={() => void stop()} aria-label="Stop">
                <StopIcon size={14} />
              </button>
            )}
            <button
              className="btn-primary input-send"
              onClick={() => void send()}
              disabled={busy || slim.isProcessing || !draft.trim()}
              aria-label="Send"
            >
              <SendIcon size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
