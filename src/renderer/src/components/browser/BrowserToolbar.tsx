import React, { useState, useCallback, KeyboardEvent } from 'react'

interface Props {
  url: string
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
}

export default function BrowserToolbar({ url, onNavigate, onBack, onForward, onReload }: Props) {
  const [inputUrl, setInputUrl] = useState(url)

  // Sync external URL changes
  React.useEffect(() => {
    setInputUrl(url)
  }, [url])

  const handleNavigate = useCallback(() => {
    if (inputUrl.trim()) {
      onNavigate(inputUrl.trim())
    }
  }, [inputUrl, onNavigate])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleNavigate()
    }
  }, [handleNavigate])

  return (
    <div className="browser-toolbar">
      <button className="btn btn-sm btn-icon" onClick={onBack} title="Back">&#8592;</button>
      <button className="btn btn-sm btn-icon" onClick={onForward} title="Forward">&#8594;</button>
      <button className="btn btn-sm btn-icon" onClick={onReload} title="Reload">&#8635;</button>
      <input
        className="browser-url-input"
        value={inputUrl}
        onChange={e => setInputUrl(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter URL..."
      />
      <button className="btn btn-sm" onClick={handleNavigate}>Go</button>
    </div>
  )
}
