import { useCallback, useRef, useState } from 'react'

export type VimMode = 'normal' | 'insert' | 'visual'

interface VimState {
  mode: VimMode
  pending: string // for multi-key commands like dd, gg, ci, etc.
  register: string // yank register
}

interface UseVimModeResult {
  mode: VimMode
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean // returns true if consumed
  resetToInsert: () => void
}

// Word boundary helpers operating on text + cursor position
function findWordEnd(text: string, pos: number): number {
  if (pos >= text.length) return pos
  let i = pos + 1
  // Skip current word chars
  if (/\w/.test(text[pos])) {
    while (i < text.length && /\w/.test(text[i])) i++
  } else if (/\S/.test(text[pos])) {
    while (i < text.length && /\S/.test(text[i]) && !/\w/.test(text[i])) i++
  }
  // Skip whitespace
  while (i < text.length && /\s/.test(text[i]) && text[i] !== '\n') i++
  return i
}

function findWordStart(text: string, pos: number): number {
  if (pos <= 0) return 0
  let i = pos - 1
  // Skip whitespace backwards
  while (i > 0 && /\s/.test(text[i]) && text[i] !== '\n') i--
  // Skip word chars backwards
  if (i >= 0 && /\w/.test(text[i])) {
    while (i > 0 && /\w/.test(text[i - 1])) i--
  } else if (i >= 0 && /\S/.test(text[i])) {
    while (i > 0 && /\S/.test(text[i - 1]) && !/\w/.test(text[i - 1])) i--
  }
  return i
}

function findWordEndForward(text: string, pos: number): number {
  if (pos >= text.length - 1) return text.length - 1
  let i = pos + 1
  // Skip whitespace
  while (i < text.length && /\s/.test(text[i])) i++
  // Skip word chars
  if (i < text.length && /\w/.test(text[i])) {
    while (i < text.length - 1 && /\w/.test(text[i + 1])) i++
  } else if (i < text.length && /\S/.test(text[i])) {
    while (i < text.length - 1 && /\S/.test(text[i + 1]) && !/\w/.test(text[i + 1])) i++
  }
  return i
}

function getLineStart(text: string, pos: number): number {
  const idx = text.lastIndexOf('\n', pos - 1)
  return idx === -1 ? 0 : idx + 1
}

function getLineEnd(text: string, pos: number): number {
  const idx = text.indexOf('\n', pos)
  return idx === -1 ? text.length : idx
}

function getWordUnderCursor(text: string, pos: number): [number, number] {
  let start = pos
  let end = pos
  if (pos < text.length && /\w/.test(text[pos])) {
    while (start > 0 && /\w/.test(text[start - 1])) start--
    while (end < text.length && /\w/.test(text[end])) end++
  } else if (pos < text.length && /\S/.test(text[pos])) {
    while (start > 0 && /\S/.test(text[start - 1]) && !/\w/.test(text[start - 1])) start--
    while (end < text.length && /\S/.test(text[end]) && !/\w/.test(text[end])) end++
  }
  return [start, end]
}

export function useVimMode(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  getText: () => string,
  setText: (val: string) => void,
  enabled: boolean
): UseVimModeResult {
  const [mode, setMode] = useState<VimMode>('insert')
  const stateRef = useRef<VimState>({ mode: 'insert', pending: '', register: '' })
  const visualAnchorRef = useRef(0)

  const setCursor = useCallback((pos: number, end?: number) => {
    const ta = textareaRef.current
    if (!ta) return
    requestAnimationFrame(() => {
      ta.setSelectionRange(pos, end ?? pos)
    })
  }, [textareaRef])

  const enterMode = useCallback((m: VimMode) => {
    stateRef.current.mode = m
    stateRef.current.pending = ''
    setMode(m)
  }, [])

  const resetToInsert = useCallback(() => {
    enterMode('insert')
  }, [enterMode])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!enabled) return false
    const ta = textareaRef.current
    if (!ta) return false

    const text = getText()
    const pos = ta.selectionStart
    const state = stateRef.current

    // ESC always goes to normal mode
    if (e.key === 'Escape') {
      if (state.mode === 'insert') {
        e.preventDefault()
        // Move cursor back one (vim behavior)
        if (pos > 0) setCursor(pos - 1)
        enterMode('normal')
        return true
      }
      if (state.mode === 'visual') {
        e.preventDefault()
        setCursor(pos)
        enterMode('normal')
        return true
      }
      return false
    }

    // In insert mode, only ESC is handled (above)
    if (state.mode === 'insert') return false

    // Normal mode and Visual mode key handling
    const key = e.key
    const pending = state.pending

    // Don't intercept modifier combos (Ctrl+C, etc) except Ctrl+R (redo)
    if (e.metaKey || (e.ctrlKey && key !== 'r')) return false

    e.preventDefault()

    // --- Motion commands (shared between normal and visual) ---
    const applyMotion = (newPos: number) => {
      if (state.mode === 'visual') {
        const anchor = visualAnchorRef.current
        if (newPos >= anchor) {
          setCursor(anchor, newPos + 1)
        } else {
          setCursor(newPos, anchor + 1)
        }
      } else {
        setCursor(newPos)
      }
    }

    // Multi-key commands
    if (pending) {
      // gg - go to start
      if (pending === 'g' && key === 'g') {
        state.pending = ''
        applyMotion(0)
        return true
      }

      // dd - delete line
      if (pending === 'd' && key === 'd' && state.mode === 'normal') {
        state.pending = ''
        const lineStart = getLineStart(text, pos)
        const lineEnd = getLineEnd(text, pos)
        const deleteEnd = lineEnd < text.length ? lineEnd + 1 : lineEnd
        const deleteStart = lineStart > 0 && deleteEnd === text.length ? lineStart - 1 : lineStart
        state.register = text.slice(lineStart, lineEnd + 1)
        const newText = text.slice(0, deleteStart) + text.slice(deleteEnd)
        setText(newText)
        setCursor(Math.min(deleteStart, newText.length))
        return true
      }

      // yy - yank line
      if (pending === 'y' && key === 'y' && state.mode === 'normal') {
        state.pending = ''
        const lineStart = getLineStart(text, pos)
        const lineEnd = getLineEnd(text, pos)
        state.register = text.slice(lineStart, lineEnd + 1)
        return true
      }

      // cc - change line
      if (pending === 'c' && key === 'c' && state.mode === 'normal') {
        state.pending = ''
        const lineStart = getLineStart(text, pos)
        const lineEnd = getLineEnd(text, pos)
        state.register = text.slice(lineStart, lineEnd)
        const newText = text.slice(0, lineStart) + text.slice(lineEnd)
        setText(newText)
        setCursor(lineStart)
        enterMode('insert')
        return true
      }

      // ci + text object
      if (pending === 'ci' || pending === 'di' || pending === 'yi') {
        const action = pending[0] // c, d, or y
        state.pending = ''
        if (key === 'w') {
          const [ws, we] = getWordUnderCursor(text, pos)
          state.register = text.slice(ws, we)
          if (action === 'y') return true
          const newText = text.slice(0, ws) + text.slice(we)
          setText(newText)
          setCursor(ws)
          if (action === 'c') enterMode('insert')
          return true
        }
        // ci" ci' ci` ci( ci) ci{ ci} ci[ ci]
        const pairs: Record<string, [string, string]> = {
          '"': ['"', '"'], "'": ["'", "'"], '`': ['`', '`'],
          '(': ['(', ')'], ')': ['(', ')'],
          '{': ['{', '}'], '}': ['{', '}'],
          '[': ['[', ']'], ']': ['[', ']'],
        }
        if (pairs[key]) {
          const [open, close] = pairs[key]
          const start = text.lastIndexOf(open, pos)
          const end = text.indexOf(close, pos)
          if (start !== -1 && end !== -1 && end > start) {
            state.register = text.slice(start + 1, end)
            if (action === 'y') return true
            const newText = text.slice(0, start + 1) + text.slice(end)
            setText(newText)
            setCursor(start + 1)
            if (action === 'c') enterMode('insert')
            return true
          }
        }
        return true
      }

      // d + motion, c + motion
      if ((pending === 'd' || pending === 'c') && state.mode === 'normal') {
        state.pending = ''
        let motionEnd = pos
        if (key === 'w' || key === 'W') motionEnd = findWordEnd(text, pos)
        else if (key === 'e') motionEnd = findWordEndForward(text, pos) + 1
        else if (key === 'b') motionEnd = findWordStart(text, pos)
        else if (key === '$') motionEnd = getLineEnd(text, pos)
        else if (key === '0') motionEnd = getLineStart(text, pos)
        else if (key === 'i') { state.pending = pending + 'i'; return true }
        else return true

        const from = Math.min(pos, motionEnd)
        const to = Math.max(pos, motionEnd)
        state.register = text.slice(from, to)
        const newText = text.slice(0, from) + text.slice(to)
        setText(newText)
        setCursor(Math.min(from, newText.length))
        if (pending === 'c') enterMode('insert')
        return true
      }

      // y + motion
      if (pending === 'y' && state.mode === 'normal') {
        state.pending = ''
        let motionEnd = pos
        if (key === 'w' || key === 'W') motionEnd = findWordEnd(text, pos)
        else if (key === 'e') motionEnd = findWordEndForward(text, pos) + 1
        else if (key === 'b') motionEnd = findWordStart(text, pos)
        else if (key === '$') motionEnd = getLineEnd(text, pos)
        else if (key === '0') motionEnd = getLineStart(text, pos)
        else if (key === 'i') { state.pending = 'yi'; return true }
        else return true

        const from = Math.min(pos, motionEnd)
        const to = Math.max(pos, motionEnd)
        state.register = text.slice(from, to)
        return true
      }

      state.pending = ''
      return true
    }

    // --- Single-key commands ---

    // Motions
    if (key === 'h' || key === 'ArrowLeft') { applyMotion(Math.max(0, pos - 1)); return true }
    if (key === 'l' || key === 'ArrowRight') { applyMotion(Math.min(text.length, pos + 1)); return true }
    if (key === 'j' || key === 'ArrowDown') {
      const lineStart = getLineStart(text, pos)
      const col = pos - lineStart
      const lineEnd = getLineEnd(text, pos)
      if (lineEnd >= text.length) return true
      const nextLineStart = lineEnd + 1
      const nextLineEnd = getLineEnd(text, nextLineStart)
      applyMotion(Math.min(nextLineStart + col, nextLineEnd))
      return true
    }
    if (key === 'k' || key === 'ArrowUp') {
      const lineStart = getLineStart(text, pos)
      const col = pos - lineStart
      if (lineStart === 0) return true
      const prevLineEnd = lineStart - 1
      const prevLineStart = getLineStart(text, prevLineEnd)
      applyMotion(Math.min(prevLineStart + col, prevLineEnd))
      return true
    }
    if (key === 'w' || key === 'W') { applyMotion(findWordEnd(text, pos)); return true }
    if (key === 'b' || key === 'B') { applyMotion(findWordStart(text, pos)); return true }
    if (key === 'e') { applyMotion(findWordEndForward(text, pos)); return true }
    if (key === '0' || key === 'Home') { applyMotion(getLineStart(text, pos)); return true }
    if (key === '$' || key === 'End') { applyMotion(Math.max(getLineEnd(text, pos) - 1, getLineStart(text, pos))); return true }
    if (key === 'g') { state.pending = 'g'; return true }
    if (key === 'G') { applyMotion(text.length); return true }

    // --- Normal mode only commands ---
    if (state.mode === 'normal') {
      // Enter insert mode
      if (key === 'i') { enterMode('insert'); return true }
      if (key === 'a') { setCursor(Math.min(pos + 1, text.length)); enterMode('insert'); return true }
      if (key === 'I') { setCursor(getLineStart(text, pos)); enterMode('insert'); return true }
      if (key === 'A') { setCursor(getLineEnd(text, pos)); enterMode('insert'); return true }
      if (key === 'o') {
        const lineEnd = getLineEnd(text, pos)
        const newText = text.slice(0, lineEnd) + '\n' + text.slice(lineEnd)
        setText(newText)
        setCursor(lineEnd + 1)
        enterMode('insert')
        return true
      }
      if (key === 'O') {
        const lineStart = getLineStart(text, pos)
        const newText = text.slice(0, lineStart) + '\n' + text.slice(lineStart)
        setText(newText)
        setCursor(lineStart)
        enterMode('insert')
        return true
      }

      // Delete / change / yank operators (wait for motion)
      if (key === 'd') { state.pending = 'd'; return true }
      if (key === 'c') { state.pending = 'c'; return true }
      if (key === 'y') { state.pending = 'y'; return true }

      // x - delete char under cursor
      if (key === 'x') {
        if (pos < text.length) {
          state.register = text[pos]
          const newText = text.slice(0, pos) + text.slice(pos + 1)
          setText(newText)
          setCursor(Math.min(pos, newText.length - 1))
        }
        return true
      }

      // X - delete char before cursor
      if (key === 'X') {
        if (pos > 0) {
          state.register = text[pos - 1]
          const newText = text.slice(0, pos - 1) + text.slice(pos)
          setText(newText)
          setCursor(pos - 1)
        }
        return true
      }

      // D - delete to end of line
      if (key === 'D') {
        const lineEnd = getLineEnd(text, pos)
        state.register = text.slice(pos, lineEnd)
        const newText = text.slice(0, pos) + text.slice(lineEnd)
        setText(newText)
        setCursor(Math.max(pos - 1, getLineStart(text, pos)))
        return true
      }

      // C - change to end of line
      if (key === 'C') {
        const lineEnd = getLineEnd(text, pos)
        state.register = text.slice(pos, lineEnd)
        const newText = text.slice(0, pos) + text.slice(lineEnd)
        setText(newText)
        setCursor(pos)
        enterMode('insert')
        return true
      }

      // s - substitute char (delete + insert)
      if (key === 's') {
        if (pos < text.length) {
          state.register = text[pos]
          const newText = text.slice(0, pos) + text.slice(pos + 1)
          setText(newText)
          setCursor(pos)
        }
        enterMode('insert')
        return true
      }

      // S - substitute line
      if (key === 'S') {
        const lineStart = getLineStart(text, pos)
        const lineEnd = getLineEnd(text, pos)
        state.register = text.slice(lineStart, lineEnd)
        const newText = text.slice(0, lineStart) + text.slice(lineEnd)
        setText(newText)
        setCursor(lineStart)
        enterMode('insert')
        return true
      }

      // p - paste after cursor
      if (key === 'p') {
        if (state.register) {
          const insertPos = state.register.includes('\n') ? getLineEnd(text, pos) : pos + 1
          const newText = text.slice(0, insertPos) + state.register + text.slice(insertPos)
          setText(newText)
          setCursor(insertPos + state.register.length - 1)
        }
        return true
      }

      // P - paste before cursor
      if (key === 'P') {
        if (state.register) {
          const insertPos = state.register.includes('\n') ? getLineStart(text, pos) : pos
          const newText = text.slice(0, insertPos) + state.register + text.slice(insertPos)
          setText(newText)
          setCursor(insertPos + state.register.length - 1)
        }
        return true
      }

      // u - undo (pass through to browser)
      if (key === 'u') {
        document.execCommand('undo')
        return true
      }

      // Ctrl+r - redo
      if (key === 'r' && e.ctrlKey) {
        document.execCommand('redo')
        return true
      }

      // r - replace single char
      if (key === 'r') {
        // Wait for next char - use pending
        state.pending = 'r'
        return true
      }

      // v - enter visual mode
      if (key === 'v') {
        visualAnchorRef.current = pos
        setCursor(pos, pos + 1)
        enterMode('visual')
        return true
      }

      // ~ - toggle case
      if (key === '~') {
        if (pos < text.length) {
          const ch = text[pos]
          const toggled = ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()
          const newText = text.slice(0, pos) + toggled + text.slice(pos + 1)
          setText(newText)
          setCursor(pos + 1)
        }
        return true
      }
    }

    // Handle 'r' pending (replace char)
    if (pending === 'r' && key.length === 1 && state.mode === 'normal') {
      state.pending = ''
      if (pos < text.length) {
        const newText = text.slice(0, pos) + key + text.slice(pos + 1)
        setText(newText)
        setCursor(pos)
      }
      return true
    }

    // --- Visual mode commands ---
    if (state.mode === 'visual') {
      const selStart = ta.selectionStart
      const selEnd = ta.selectionEnd

      // d - delete selection
      if (key === 'd' || key === 'x') {
        state.register = text.slice(selStart, selEnd)
        const newText = text.slice(0, selStart) + text.slice(selEnd)
        setText(newText)
        setCursor(Math.min(selStart, newText.length))
        enterMode('normal')
        return true
      }

      // y - yank selection
      if (key === 'y') {
        state.register = text.slice(selStart, selEnd)
        setCursor(selStart)
        enterMode('normal')
        return true
      }

      // c - change selection
      if (key === 'c') {
        state.register = text.slice(selStart, selEnd)
        const newText = text.slice(0, selStart) + text.slice(selEnd)
        setText(newText)
        setCursor(selStart)
        enterMode('insert')
        return true
      }

      // ~ - toggle case of selection
      if (key === '~') {
        const selected = text.slice(selStart, selEnd)
        const toggled = selected.split('').map(ch =>
          ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()
        ).join('')
        const newText = text.slice(0, selStart) + toggled + text.slice(selEnd)
        setText(newText)
        setCursor(selStart)
        enterMode('normal')
        return true
      }
    }

    return true
  }, [enabled, textareaRef, getText, setText, setCursor, enterMode])

  return { mode, handleKeyDown, resetToInsert }
}
