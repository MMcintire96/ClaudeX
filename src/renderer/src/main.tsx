import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PopoutApp from './PopoutApp'
import './styles/globals.css'
import './styles/themes.css'
import '@xterm/xterm/css/xterm.css'

// Check if this is a popout window
const params = new URLSearchParams(window.location.search)
const isPopout = params.get('popout') === 'true'
const popoutTerminalId = params.get('terminalId')
const popoutProjectPath = params.get('projectPath')
const popoutTheme = params.get('theme')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPopout && popoutTerminalId && popoutProjectPath ? (
      <PopoutApp terminalId={popoutTerminalId} projectPath={popoutProjectPath} initialTheme={popoutTheme} />
    ) : (
      <App />
    )}
  </React.StrictMode>
)
