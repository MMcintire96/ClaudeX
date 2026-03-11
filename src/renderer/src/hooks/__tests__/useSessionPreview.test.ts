// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionPreview } from '../useSessionPreview'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function createMouseEvent(rect = { x: 0, y: 0, width: 100, height: 30, top: 0, left: 0, bottom: 30, right: 100 }) {
  return {
    currentTarget: {
      getBoundingClientRect: () => rect as DOMRect
    }
  } as unknown as React.MouseEvent
}

describe('useSessionPreview', () => {
  it('starts with null previewTarget', () => {
    const { result } = renderHook(() => useSessionPreview())
    expect(result.current.previewTarget).toBeNull()
  })

  it('shows preview after 300ms delay on mouse enter', () => {
    const { result } = renderHook(() => useSessionPreview())

    act(() => {
      result.current.onSessionMouseEnter(createMouseEvent(), 'sess-1', null)
    })

    // Not shown yet
    expect(result.current.previewTarget).toBeNull()

    // Advance past 300ms
    act(() => { vi.advanceTimersByTime(300) })

    expect(result.current.previewTarget).toEqual({
      sessionId: 'sess-1',
      historyEntry: null,
      triggerRect: expect.any(Object)
    })
  })

  it('cancels show if mouse leaves before delay', () => {
    const { result } = renderHook(() => useSessionPreview())

    act(() => {
      result.current.onSessionMouseEnter(createMouseEvent(), 'sess-1', null)
    })

    // Leave before 300ms
    act(() => { vi.advanceTimersByTime(100) })
    act(() => { result.current.onSessionMouseLeave() })
    act(() => { vi.advanceTimersByTime(500) })

    expect(result.current.previewTarget).toBeNull()
  })

  it('hides preview 150ms after mouse leave', () => {
    const { result } = renderHook(() => useSessionPreview())

    // Show preview
    act(() => { result.current.onSessionMouseEnter(createMouseEvent(), 'sess-1', null) })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current.previewTarget).not.toBeNull()

    // Leave session
    act(() => { result.current.onSessionMouseLeave() })

    // Still visible during 150ms grace period
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current.previewTarget).not.toBeNull()

    // Hidden after 150ms
    act(() => { vi.advanceTimersByTime(50) })
    expect(result.current.previewTarget).toBeNull()
  })

  it('stays visible when mouse enters preview popup', () => {
    const { result } = renderHook(() => useSessionPreview())

    // Show preview
    act(() => { result.current.onSessionMouseEnter(createMouseEvent(), 'sess-1', null) })
    act(() => { vi.advanceTimersByTime(300) })

    // Leave session
    act(() => { result.current.onSessionMouseLeave() })

    // Enter preview before 150ms grace period ends
    act(() => { vi.advanceTimersByTime(50) })
    act(() => { result.current.onPreviewMouseEnter() })

    // Wait well past the grace period
    act(() => { vi.advanceTimersByTime(500) })

    // Still visible because we're hovering the preview
    expect(result.current.previewTarget).not.toBeNull()
  })

  it('hides when mouse leaves preview popup', () => {
    const { result } = renderHook(() => useSessionPreview())

    // Show preview
    act(() => { result.current.onSessionMouseEnter(createMouseEvent(), 'sess-1', null) })
    act(() => { vi.advanceTimersByTime(300) })

    // Hover preview then leave
    act(() => { result.current.onPreviewMouseEnter() })
    act(() => { result.current.onPreviewMouseLeave() })

    // Hidden after 150ms
    act(() => { vi.advanceTimersByTime(150) })
    expect(result.current.previewTarget).toBeNull()
  })

  it('dismiss immediately clears preview', () => {
    const { result } = renderHook(() => useSessionPreview())

    // Show preview
    act(() => { result.current.onSessionMouseEnter(createMouseEvent(), 'sess-1', null) })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current.previewTarget).not.toBeNull()

    act(() => { result.current.dismiss() })
    expect(result.current.previewTarget).toBeNull()
  })

  it('passes history entry to previewTarget', () => {
    const { result } = renderHook(() => useSessionPreview())
    const entry = { name: 'Test Session', createdAt: 1000, endedAt: 2000 }

    act(() => { result.current.onSessionMouseEnter(createMouseEvent(), null, entry) })
    act(() => { vi.advanceTimersByTime(300) })

    expect(result.current.previewTarget).toEqual({
      sessionId: null,
      historyEntry: entry,
      triggerRect: expect.any(Object)
    })
  })

  it('dismisses on window resize', () => {
    const { result } = renderHook(() => useSessionPreview())

    // Show preview
    act(() => { result.current.onSessionMouseEnter(createMouseEvent(), 'sess-1', null) })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current.previewTarget).not.toBeNull()

    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(result.current.previewTarget).toBeNull()
  })

  it('dismisses on dragstart', () => {
    const { result } = renderHook(() => useSessionPreview())

    // Show preview
    act(() => { result.current.onSessionMouseEnter(createMouseEvent(), 'sess-1', null) })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current.previewTarget).not.toBeNull()

    act(() => { window.dispatchEvent(new Event('dragstart')) })
    expect(result.current.previewTarget).toBeNull()
  })

  it('switches preview when hovering different session', () => {
    const { result } = renderHook(() => useSessionPreview())

    // Show preview for session 1
    act(() => { result.current.onSessionMouseEnter(createMouseEvent(), 'sess-1', null) })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current.previewTarget!.sessionId).toBe('sess-1')

    // Hover session 2 (clears timers, starts new show timer)
    act(() => { result.current.onSessionMouseEnter(createMouseEvent(), 'sess-2', null) })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current.previewTarget!.sessionId).toBe('sess-2')
  })
})
