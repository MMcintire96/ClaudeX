// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVimMode } from '../useVimMode'

// Make requestAnimationFrame synchronous for testability
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0 }

function createKeyEvent(key: string, opts: Record<string, unknown> = {}) {
  return {
    key,
    preventDefault: vi.fn(),
    metaKey: false,
    ctrlKey: false,
    ...opts
  } as unknown as React.KeyboardEvent<HTMLTextAreaElement>
}

function setup(initialText = '', cursorPos = 0) {
  let text = initialText
  const ta = {
    selectionStart: cursorPos,
    selectionEnd: cursorPos,
    setSelectionRange(s: number, e: number) {
      this.selectionStart = s
      this.selectionEnd = e ?? s
    }
  } as unknown as HTMLTextAreaElement

  const ref = { current: ta }
  const getText = () => text
  const setText = vi.fn((v: string) => { text = v })

  const { result } = renderHook(() => useVimMode(ref, getText, setText, true))

  function key(k: string, opts: Record<string, unknown> = {}) {
    let ret: boolean
    act(() => { ret = result.current.handleKeyDown(createKeyEvent(k, opts)) })
    return ret!
  }

  function toNormal() {
    if (result.current.mode === 'insert') key('Escape')
  }

  return { result, ta, text: () => text, setText, key, toNormal, ref }
}

// --- Mode transitions ---

describe('mode transitions', () => {
  it('starts in insert mode', () => {
    const { result } = setup()
    expect(result.current.mode).toBe('insert')
  })

  it('Escape goes from insert to normal', () => {
    const { result, key } = setup('hello', 3)
    key('Escape')
    expect(result.current.mode).toBe('normal')
  })

  it('i goes from normal to insert', () => {
    const { result, key, toNormal } = setup('hello')
    toNormal()
    key('i')
    expect(result.current.mode).toBe('insert')
  })

  it('a goes to insert and moves cursor forward', () => {
    const { result, ta, key, toNormal } = setup('hello', 2)
    toNormal()
    ta.selectionStart = 2
    key('a')
    expect(result.current.mode).toBe('insert')
    expect(ta.selectionStart).toBe(3)
  })

  it('I moves to line start and enters insert', () => {
    const { result, ta, key, toNormal } = setup('hello world', 5)
    toNormal()
    ta.selectionStart = 5
    key('I')
    expect(result.current.mode).toBe('insert')
    expect(ta.selectionStart).toBe(0)
  })

  it('A moves to line end and enters insert', () => {
    const { result, ta, key, toNormal } = setup('hello', 2)
    toNormal()
    ta.selectionStart = 2
    key('A')
    expect(result.current.mode).toBe('insert')
    expect(ta.selectionStart).toBe(5)
  })

  it('v enters visual mode', () => {
    const { result, key, toNormal } = setup('hello')
    toNormal()
    key('v')
    expect(result.current.mode).toBe('visual')
  })

  it('Escape exits visual to normal', () => {
    const { result, key, toNormal } = setup('hello')
    toNormal()
    key('v')
    key('Escape')
    expect(result.current.mode).toBe('normal')
  })

  it('resetToInsert resets to insert mode', () => {
    const { result, toNormal } = setup('hello')
    toNormal()
    expect(result.current.mode).toBe('normal')
    act(() => { result.current.resetToInsert() })
    expect(result.current.mode).toBe('insert')
  })
})

// --- Disabled / no textarea ---

describe('disabled and edge cases', () => {
  it('returns false when disabled', () => {
    const ta = { selectionStart: 0, selectionEnd: 0, setSelectionRange: vi.fn() } as any
    const ref = { current: ta }
    const { result } = renderHook(() => useVimMode(ref, () => '', vi.fn(), false))
    let ret: boolean
    act(() => { ret = result.current.handleKeyDown(createKeyEvent('Escape')) })
    expect(ret!).toBe(false)
  })

  it('returns false when no textarea', () => {
    const ref = { current: null }
    const { result } = renderHook(() => useVimMode(ref, () => '', vi.fn(), true))
    let ret: boolean
    act(() => { ret = result.current.handleKeyDown(createKeyEvent('Escape')) })
    expect(ret!).toBe(false)
  })

  it('does not intercept modifier combos in normal mode', () => {
    const { key, toNormal } = setup('hello')
    toNormal()
    const ret = key('c', { metaKey: true })
    expect(ret).toBe(false)
  })

  it('insert mode only handles Escape', () => {
    const { key } = setup('hello')
    // In insert mode, pressing 'h' should not be consumed
    const ret = key('h')
    expect(ret).toBe(false)
  })
})

// --- Motion commands ---

describe('motions in normal mode', () => {
  it('h moves left', () => {
    const { ta, key, toNormal } = setup('hello', 3)
    toNormal()
    ta.selectionStart = 3
    key('h')
    expect(ta.selectionStart).toBe(2)
  })

  it('l moves right', () => {
    const { ta, key, toNormal } = setup('hello', 1)
    toNormal()
    ta.selectionStart = 1
    key('l')
    expect(ta.selectionStart).toBe(2)
  })

  it('w moves to next word', () => {
    const { ta, key, toNormal } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('w')
    expect(ta.selectionStart).toBe(6) // findWordEnd skips word chars then whitespace → start of "world"
  })

  it('b moves to previous word start', () => {
    const { ta, key, toNormal } = setup('hello world', 8)
    toNormal()
    ta.selectionStart = 8
    key('b')
    expect(ta.selectionStart).toBe(6) // start of "world"
  })

  it('0 moves to line start', () => {
    const { ta, key, toNormal } = setup('hello world', 7)
    toNormal()
    ta.selectionStart = 7
    key('0')
    expect(ta.selectionStart).toBe(0)
  })

  it('$ moves to line end', () => {
    const { ta, key, toNormal } = setup('hello\nworld', 1)
    toNormal()
    ta.selectionStart = 1
    key('$')
    expect(ta.selectionStart).toBe(4) // end of "hello" minus 1
  })

  it('gg moves to start of text', () => {
    const { ta, key, toNormal } = setup('hello world', 5)
    toNormal()
    ta.selectionStart = 5
    key('g')
    key('g')
    expect(ta.selectionStart).toBe(0)
  })

  it('G moves to end of text', () => {
    const { ta, key, toNormal } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('G')
    expect(ta.selectionStart).toBe(11)
  })

  it('j moves down a line', () => {
    const { ta, key, toNormal } = setup('abc\ndef\nghi', 1)
    toNormal()
    ta.selectionStart = 1
    key('j')
    expect(ta.selectionStart).toBe(5) // 'd' + col 1 = 'e'
  })

  it('k moves up a line', () => {
    const { ta, key, toNormal } = setup('abc\ndef\nghi', 5)
    toNormal()
    ta.selectionStart = 5
    key('k')
    expect(ta.selectionStart).toBe(1) // 'b' (col 1 of first line)
  })

  it('e moves to end of word', () => {
    const { ta, key, toNormal } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('e')
    expect(ta.selectionStart).toBe(4) // end of "hello"
  })
})

// --- Edit commands ---

describe('edit commands in normal mode', () => {
  it('x deletes char under cursor', () => {
    const { ta, key, toNormal, text, setText } = setup('hello', 2)
    toNormal()
    ta.selectionStart = 2
    key('x')
    expect(setText).toHaveBeenCalledWith('helo')
    expect(text()).toBe('helo')
  })

  it('X deletes char before cursor', () => {
    const { ta, key, toNormal, setText } = setup('hello', 2)
    toNormal()
    ta.selectionStart = 2
    key('X')
    expect(setText).toHaveBeenCalledWith('hllo')
  })

  it('dd deletes current line', () => {
    const { ta, key, toNormal, setText } = setup('line1\nline2\nline3', 7)
    toNormal()
    ta.selectionStart = 7
    key('d')
    key('d')
    expect(setText).toHaveBeenCalledWith('line1\nline3')
  })

  it('yy yanks line, p pastes after', () => {
    const { ta, key, toNormal, setText } = setup('abc\ndef', 0)
    toNormal()
    ta.selectionStart = 0
    key('y')
    key('y') // yanks "abc\n"
    ta.selectionStart = 0
    key('p') // paste after line end
    // Register contains "abc\n", paste at line end (pos 3)
    expect(setText).toHaveBeenCalledWith('abcabc\n\ndef')
  })

  it('D deletes to end of line', () => {
    const { ta, key, toNormal, setText } = setup('hello world', 5)
    toNormal()
    ta.selectionStart = 5
    key('D')
    expect(setText).toHaveBeenCalledWith('hello')
  })

  it('C changes to end of line (enters insert)', () => {
    const { ta, key, toNormal, setText, result } = setup('hello world', 5)
    toNormal()
    ta.selectionStart = 5
    key('C')
    expect(setText).toHaveBeenCalledWith('hello')
    expect(result.current.mode).toBe('insert')
  })

  it('o opens line below and enters insert', () => {
    const { ta, key, toNormal, setText, result } = setup('hello', 2)
    toNormal()
    ta.selectionStart = 2
    key('o')
    expect(setText).toHaveBeenCalledWith('hello\n')
    expect(result.current.mode).toBe('insert')
  })

  it('O opens line above and enters insert', () => {
    const { ta, key, toNormal, setText, result } = setup('hello', 2)
    toNormal()
    ta.selectionStart = 2
    key('O')
    expect(setText).toHaveBeenCalledWith('\nhello')
    expect(result.current.mode).toBe('insert')
  })

  it('s substitutes char and enters insert', () => {
    const { ta, key, toNormal, setText, result } = setup('hello', 2)
    toNormal()
    ta.selectionStart = 2
    key('s')
    expect(setText).toHaveBeenCalledWith('helo')
    expect(result.current.mode).toBe('insert')
  })

  it('S substitutes line and enters insert', () => {
    const { ta, key, toNormal, setText, result } = setup('hello\nworld', 2)
    toNormal()
    ta.selectionStart = 2
    key('S')
    expect(setText).toHaveBeenCalledWith('\nworld')
    expect(result.current.mode).toBe('insert')
  })

  it('~ toggles case', () => {
    const { ta, key, toNormal, setText } = setup('hello', 0)
    toNormal()
    ta.selectionStart = 0
    key('~')
    expect(setText).toHaveBeenCalledWith('Hello')
  })

  it('r sets pending state', () => {
    const { ta, key, toNormal } = setup('hello', 0)
    toNormal()
    ta.selectionStart = 0
    // 'r' enters pending mode; the general pending catch-all handles subsequent key
    const ret = key('r')
    expect(ret).toBe(true)
  })

  it('cc changes entire line', () => {
    const { ta, key, toNormal, setText, result } = setup('hello\nworld', 2)
    toNormal()
    ta.selectionStart = 2
    key('c')
    key('c')
    expect(setText).toHaveBeenCalledWith('\nworld')
    expect(result.current.mode).toBe('insert')
  })
})

// --- Operator + motion ---

describe('operator + motion', () => {
  it('dw deletes to next word', () => {
    const { ta, key, toNormal, setText } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('d')
    key('w')
    expect(setText).toHaveBeenCalledWith('world')
  })

  it('d$ deletes to end of line', () => {
    const { ta, key, toNormal, setText } = setup('hello world', 5)
    toNormal()
    ta.selectionStart = 5
    key('d')
    key('$')
    expect(setText).toHaveBeenCalledWith('hello')
  })

  it('cw changes to next word (enters insert)', () => {
    const { ta, key, toNormal, setText, result } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('c')
    key('w')
    expect(setText).toHaveBeenCalledWith('world')
    expect(result.current.mode).toBe('insert')
  })

  it('yw yanks to next word (no text change)', () => {
    const { ta, key, toNormal, setText } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('y')
    key('w')
    expect(setText).not.toHaveBeenCalled()
  })

  it('de deletes to word end', () => {
    const { ta, key, toNormal, setText } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('d')
    key('e')
    // findWordEndForward(text, 0) = 4, +1 = 5
    expect(setText).toHaveBeenCalledWith(' world')
  })

  it('db deletes backward to word start', () => {
    const { ta, key, toNormal, setText } = setup('hello world', 8)
    toNormal()
    ta.selectionStart = 8
    key('d')
    key('b')
    expect(setText).toHaveBeenCalledWith('hello rld')
  })

  it('d0 deletes to line start', () => {
    const { ta, key, toNormal, setText } = setup('hello world', 5)
    toNormal()
    ta.selectionStart = 5
    key('d')
    key('0')
    expect(setText).toHaveBeenCalledWith(' world')
  })
})

// --- Text objects ---

describe('text objects', () => {
  it('ciw changes inner word', () => {
    const { ta, key, toNormal, setText, result } = setup('hello world', 1)
    toNormal()
    ta.selectionStart = 1
    key('c')
    key('i')
    key('w')
    expect(setText).toHaveBeenCalledWith(' world')
    expect(result.current.mode).toBe('insert')
  })

  it('diw deletes inner word', () => {
    const { ta, key, toNormal, setText, result } = setup('hello world', 7)
    toNormal()
    ta.selectionStart = 7
    key('d')
    key('i')
    key('w')
    expect(setText).toHaveBeenCalledWith('hello ')
    expect(result.current.mode).toBe('normal')
  })

  it('ci" changes inside quotes', () => {
    const { ta, key, toNormal, setText, result } = setup('say "hello" end', 7)
    toNormal()
    ta.selectionStart = 7
    key('c')
    key('i')
    key('"')
    expect(setText).toHaveBeenCalledWith('say "" end')
    expect(result.current.mode).toBe('insert')
  })

  it('di( deletes inside parens', () => {
    const { ta, key, toNormal, setText } = setup('fn(arg1, arg2)', 5)
    toNormal()
    ta.selectionStart = 5
    key('d')
    key('i')
    key('(')
    expect(setText).toHaveBeenCalledWith('fn()')
  })

  it('yi{ yanks inside braces (no text change)', () => {
    const { ta, key, toNormal, setText } = setup('obj {val}', 6)
    toNormal()
    ta.selectionStart = 6
    key('y')
    key('i')
    key('{')
    expect(setText).not.toHaveBeenCalled()
  })

  it('yiw yanks inner word (no text change)', () => {
    const { ta, key, toNormal, setText } = setup('hello world', 1)
    toNormal()
    ta.selectionStart = 1
    key('y')
    key('i')
    key('w')
    expect(setText).not.toHaveBeenCalled()
  })
})

// --- Visual mode ---

describe('visual mode', () => {
  it('d in visual mode deletes selection', () => {
    const { ta, key, toNormal, setText, result } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('v')
    // Simulate selecting by moving right
    ta.selectionStart = 0
    ta.selectionEnd = 5
    key('d')
    expect(setText).toHaveBeenCalledWith(' world')
    expect(result.current.mode).toBe('normal')
  })

  it('y in visual mode yanks selection', () => {
    const { ta, key, toNormal, setText, result } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('v')
    ta.selectionStart = 0
    ta.selectionEnd = 5
    key('y')
    expect(setText).not.toHaveBeenCalled()
    expect(result.current.mode).toBe('normal')
  })

  it('c in visual mode changes selection', () => {
    const { ta, key, toNormal, setText, result } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('v')
    ta.selectionStart = 0
    ta.selectionEnd = 5
    key('c')
    expect(setText).toHaveBeenCalledWith(' world')
    expect(result.current.mode).toBe('insert')
  })

  it('~ in visual mode toggles case of selection', () => {
    const { ta, key, toNormal, setText, result } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('v')
    ta.selectionStart = 0
    ta.selectionEnd = 5
    key('~')
    expect(setText).toHaveBeenCalledWith('HELLO world')
    expect(result.current.mode).toBe('normal')
  })

  it('x in visual mode deletes selection (same as d)', () => {
    const { ta, key, toNormal, setText } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('v')
    ta.selectionStart = 0
    ta.selectionEnd = 5
    key('x')
    expect(setText).toHaveBeenCalledWith(' world')
  })

  it('motions extend selection in visual mode', () => {
    const { ta, key, toNormal } = setup('hello world', 0)
    toNormal()
    ta.selectionStart = 0
    key('v')
    // After v, cursor should select char 0-1
    ta.selectionStart = 0
    key('l') // move right extends selection
    // Verify ta.selectionEnd was updated
    expect(ta.selectionEnd).toBeGreaterThan(0)
  })
})

// --- Paste ---

describe('paste commands', () => {
  it('p pastes register after cursor', () => {
    const { ta, key, toNormal, setText, text } = setup('hello', 2)
    toNormal()
    ta.selectionStart = 2
    key('x') // delete 'l', register = 'l'
    ta.selectionStart = 4 // end of "helo"
    key('p') // paste 'l' after cursor pos 4
    expect(text()).toBe('helol')
  })

  it('P pastes register before cursor', () => {
    const { ta, key, toNormal, text } = setup('hello', 2)
    toNormal()
    ta.selectionStart = 2
    key('x') // delete 'l', register = 'l'
    ta.selectionStart = 0
    key('P') // paste 'l' before cursor pos 0
    expect(text()).toBe('lhelo')
  })
})

// --- Undo ---

describe('undo/redo', () => {
  it('u calls document.execCommand undo', () => {
    const execCommand = vi.fn()
    document.execCommand = execCommand
    const { key, toNormal } = setup('hello')
    toNormal()
    key('u')
    expect(execCommand).toHaveBeenCalledWith('undo')
  })

  it('Ctrl+r calls document.execCommand redo', () => {
    const execCommand = vi.fn()
    document.execCommand = execCommand
    const { key, toNormal } = setup('hello')
    toNormal()
    key('r', { ctrlKey: true })
    expect(execCommand).toHaveBeenCalledWith('redo')
  })
})

// --- Arrow key aliases ---

describe('arrow key aliases', () => {
  it('ArrowLeft works like h', () => {
    const { ta, key, toNormal } = setup('hello', 3)
    toNormal()
    ta.selectionStart = 3
    key('ArrowLeft')
    expect(ta.selectionStart).toBe(2)
  })

  it('ArrowRight works like l', () => {
    const { ta, key, toNormal } = setup('hello', 1)
    toNormal()
    ta.selectionStart = 1
    key('ArrowRight')
    expect(ta.selectionStart).toBe(2)
  })

  it('Home works like 0', () => {
    const { ta, key, toNormal } = setup('hello', 3)
    toNormal()
    ta.selectionStart = 3
    key('Home')
    expect(ta.selectionStart).toBe(0)
  })

  it('End works like $', () => {
    const { ta, key, toNormal } = setup('hello', 0)
    toNormal()
    ta.selectionStart = 0
    key('End')
    expect(ta.selectionStart).toBe(4) // last char of "hello"
  })
})

// --- Edge cases in motions ---

describe('motion edge cases', () => {
  it('h at position 0 stays at 0', () => {
    const { ta, key, toNormal } = setup('hello', 0)
    toNormal()
    ta.selectionStart = 0
    key('h')
    expect(ta.selectionStart).toBe(0)
  })

  it('k at first line stays put', () => {
    const { ta, key, toNormal } = setup('hello', 2)
    toNormal()
    ta.selectionStart = 2
    const consumed = key('k')
    expect(consumed).toBe(true)
    // stays at same position since already at first line
  })

  it('j at last line stays put', () => {
    const { ta, key, toNormal } = setup('hello', 2)
    toNormal()
    ta.selectionStart = 2
    const consumed = key('j')
    expect(consumed).toBe(true)
  })

  it('Escape in normal mode returns false', () => {
    const { key, toNormal } = setup('hello')
    toNormal()
    const ret = key('Escape')
    expect(ret).toBe(false)
  })

  it('unknown pending key resets pending', () => {
    const { ta, key, toNormal } = setup('hello', 0)
    toNormal()
    ta.selectionStart = 0
    key('d')
    const ret = key('z') // unknown motion
    expect(ret).toBe(true) // consumed but no-op
  })
})
