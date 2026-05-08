import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Pull in the full desktop theme palette so mobile shares the same
// CSS-variable language as ClaudeX's renderer.
import '../../src/renderer/src/styles/themes.css'
import './styles.css'

// Register the service worker (push + offline shell). iOS only fires push for
// PWAs installed to the home screen, so registration here is best-effort.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed', err)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
