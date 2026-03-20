import React, { useState, useCallback, useEffect, useRef, KeyboardEvent } from 'react'

interface ChromeProfile {
  name: string
  path: string
  displayName: string
}

interface HistorySuggestion {
  url: string
  title: string
  visitCount: number
  lastVisitTime: number
}

interface Props {
  url: string
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onInspect: () => void
}

export default function BrowserToolbar({ url, onNavigate, onBack, onForward, onReload, onInspect }: Props) {
  const [inputUrl, setInputUrl] = useState(url)
  const [importState, setImportState] = useState<'idle' | 'selecting' | 'importing' | 'done' | 'error'>('idle')
  const [profiles, setProfiles] = useState<ChromeProfile[]>([])
  const [importMessage, setImportMessage] = useState('')
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const [suggestions, setSuggestions] = useState<HistorySuggestion[]>([])
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync external URL changes
  useEffect(() => {
    setInputUrl(url)
    setShowSuggestions(false)
  }, [url])

  // Listen for import progress updates
  useEffect(() => {
    const cleanup = window.api.browser.onImportProgress((progress) => {
      setImportProgress({ current: progress.current, total: progress.total })
      setImportMessage(progress.message)
    })
    return cleanup
  }, [])

  // Close suggestions on outside click
  useEffect(() => {
    if (!showSuggestions) return
    const handleClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showSuggestions])

  // Close dropdown on outside click
  useEffect(() => {
    if (importState !== 'selecting') return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setImportState('idle')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [importState])

  // Auto-dismiss result toast
  useEffect(() => {
    if (importState === 'done' || importState === 'error') {
      const timer = setTimeout(() => {
        setImportState('idle')
        setImportMessage('')
        setImportProgress(null)
      }, 4000)
      return () => clearTimeout(timer)
    }
  }, [importState])

  // Fetch suggestions as user types
  const fetchSuggestions = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim() || query.startsWith('http://') && query.length < 10 || query.startsWith('https://') && query.length < 11) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await window.api.browser.getHistory(query)
        setSuggestions(results)
        setSelectedSuggestion(-1)
        setShowSuggestions(results.length > 0)
      } catch {
        setSuggestions([])
        setShowSuggestions(false)
      }
    }, 150)
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputUrl(val)
    fetchSuggestions(val)
  }, [fetchSuggestions])

  const selectSuggestion = useCallback((suggestion: HistorySuggestion) => {
    setInputUrl(suggestion.url)
    setShowSuggestions(false)
    setSuggestions([])
    onNavigate(suggestion.url)
  }, [onNavigate])

  const handleNavigate = useCallback(() => {
    if (inputUrl.trim()) {
      setShowSuggestions(false)
      onNavigate(inputUrl.trim())
    }
  }, [inputUrl, onNavigate])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedSuggestion(prev => Math.min(prev + 1, suggestions.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedSuggestion(prev => Math.max(prev - 1, -1))
        return
      }
      if (e.key === 'Enter' && selectedSuggestion >= 0) {
        e.preventDefault()
        selectSuggestion(suggestions[selectedSuggestion])
        return
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false)
        return
      }
    }
    if (e.key === 'Enter') {
      handleNavigate()
    }
  }, [handleNavigate, showSuggestions, suggestions, selectedSuggestion, selectSuggestion])

  const handleImportClick = useCallback(async () => {
    if (importState === 'importing') return

    const result = await window.api.browser.listChromeProfiles()
    if (!result.success || result.profiles.length === 0) {
      setImportState('error')
      setImportMessage(result.error ?? 'Chrome not found')
      return
    }

    if (result.profiles.length === 1) {
      // Single profile — import directly
      doImport(result.profiles[0].path)
    } else {
      // Multiple profiles — show picker
      setProfiles(result.profiles)
      setImportState('selecting')
    }
  }, [importState])

  const doImport = useCallback(async (profilePath: string) => {
    setImportState('importing')
    setImportMessage('Starting import...')
    setImportProgress(null)

    const result = await window.api.browser.importChrome(profilePath)
    if (result.success) {
      setImportState('done')
      const parts = [`${result.imported} cookies`, `${result.historyImported ?? 0} history`, `${result.passwordsImported ?? 0} passwords`]
      setImportMessage(`Imported ${parts.join(', ')}` +
        (result.failed > 0 ? ` (${result.failed} failed)` : ''))
    } else {
      setImportState('error')
      setImportMessage(result.errors?.[0] ?? 'Import failed')
    }
  }, [])

  return (
    <div className="browser-toolbar">
      <button className="btn btn-sm btn-icon" onClick={onBack} title="Back">&#8592;</button>
      <button className="btn btn-sm btn-icon" onClick={onForward} title="Forward">&#8594;</button>
      <button className="btn btn-sm btn-icon" onClick={onReload} title="Reload">&#8635;</button>
      <div style={{ position: 'relative', flex: 1 }}>
        <input
          ref={inputRef}
          className="browser-url-input"
          value={inputUrl}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (inputUrl.trim()) fetchSuggestions(inputUrl) }}
          placeholder="Enter URL..."
          style={{ width: '100%' }}
        />
        {showSuggestions && suggestions.length > 0 && (
          <div ref={suggestionsRef} style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            background: 'var(--bg-secondary, #1e1e2e)',
            border: '1px solid var(--border-color, #444)',
            borderRadius: '0 0 4px 4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            {suggestions.map((s, i) => (
              <button
                key={s.url}
                onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s) }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '5px 8px',
                  background: i === selectedSuggestion ? 'var(--bg-hover, #333)' : 'none',
                  border: 'none',
                  color: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '12px',
                  overflow: 'hidden'
                }}
                onMouseEnter={() => setSelectedSuggestion(i)}
              >
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.title || s.url}
                </div>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '10px', opacity: 0.5 }}>
                  {s.url}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="btn btn-sm" onClick={handleNavigate}>Go</button>
      <button className="btn btn-sm btn-icon" onClick={onInspect} title="Inspect element">{'{}'}</button>

      {/* Chrome Import */}
      <div style={{ position: 'relative' }} ref={dropdownRef}>
        <button
          className="btn btn-sm"
          onClick={handleImportClick}
          disabled={importState === 'importing'}
          title="Import cookies from Chrome"
          style={{ fontSize: '11px', whiteSpace: 'nowrap' }}
        >
          {importState === 'importing' ? 'Importing...' : 'Import'}
        </button>

        {/* Profile selector dropdown */}
        {importState === 'selecting' && profiles.length > 0 && (
          <div style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            zIndex: 1000,
            background: 'var(--bg-secondary, #1e1e2e)',
            border: '1px solid var(--border-color, #444)',
            borderRadius: '4px',
            padding: '4px 0',
            minWidth: '200px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}>
            <div style={{ padding: '4px 8px', fontSize: '11px', opacity: 0.6 }}>
              Select Chrome profile:
            </div>
            {profiles.map((p) => (
              <button
                key={p.path}
                onClick={() => {
                  setImportState('idle')
                  doImport(p.path)
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 12px',
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover, #333)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                {p.displayName}
              </button>
            ))}
          </div>
        )}

        {/* Progress / result toast */}
        {(importState === 'importing' || importState === 'done' || importState === 'error') && importMessage && (
          <div style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            zIndex: 1000,
            background: importState === 'error' ? '#4a1c1c' : 'var(--bg-secondary, #1e1e2e)',
            border: `1px solid ${importState === 'error' ? '#c44' : importState === 'done' ? '#4a4' : 'var(--border-color, #444)'}`,
            borderRadius: '4px',
            padding: '8px 12px',
            minWidth: '220px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            fontSize: '11px'
          }}>
            <div>{importMessage}</div>
            {importState === 'importing' && importProgress && importProgress.total > 0 && (
              <div style={{
                marginTop: '4px',
                background: '#333',
                borderRadius: '2px',
                height: '3px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${Math.round((importProgress.current / importProgress.total) * 100)}%`,
                  height: '100%',
                  background: '#6c8',
                  transition: 'width 0.2s'
                }} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
