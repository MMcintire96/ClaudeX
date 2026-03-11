import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../uiStore'

const store = useUIStore

function resetStore(): void {
  store.setState({
    sidebarVisible: true,
    sidePanelView: null,
    theme: 'dark',
    sidebarWidth: 240,
    sidePanelWidth: 480,
    projectSidePanelMemory: {},
    pendingBrowserUrl: null,
    chatDetached: false,
    splitView: false,
    splitSessionId: null,
    splitRatio: 0.5,
    focusedSplitPane: 'left',
    projectPairMemory: {},
    chatZoom: 1,
    settingsOpen: false
  })
}

beforeEach(resetStore)

describe('setChatZoom', () => {
  it('sets zoom within bounds', () => {
    store.getState().setChatZoom(1.5)
    expect(store.getState().chatZoom).toBe(1.5)
  })

  it('clamps to minimum 0.5', () => {
    store.getState().setChatZoom(0.1)
    expect(store.getState().chatZoom).toBe(0.5)
  })

  it('clamps to maximum 2.0', () => {
    store.getState().setChatZoom(3)
    expect(store.getState().chatZoom).toBe(2)
  })
})

describe('setSidebarWidth', () => {
  it('sets width within bounds', () => {
    store.getState().setSidebarWidth(300)
    expect(store.getState().sidebarWidth).toBe(300)
  })

  it('clamps to minimum 180', () => {
    store.getState().setSidebarWidth(50)
    expect(store.getState().sidebarWidth).toBe(180)
  })

  it('clamps to maximum 400', () => {
    store.getState().setSidebarWidth(999)
    expect(store.getState().sidebarWidth).toBe(400)
  })
})

describe('setSplitRatio', () => {
  it('sets ratio within bounds', () => {
    store.getState().setSplitRatio(0.6)
    expect(store.getState().splitRatio).toBe(0.6)
  })

  it('clamps to minimum 0.20', () => {
    store.getState().setSplitRatio(0.05)
    expect(store.getState().splitRatio).toBe(0.20)
  })

  it('clamps to maximum 0.80', () => {
    store.getState().setSplitRatio(0.95)
    expect(store.getState().splitRatio).toBe(0.80)
  })
})

describe('cycleTheme', () => {
  it('cycles to next theme', () => {
    store.getState().cycleTheme()
    expect(store.getState().theme).toBe('light') // dark -> light
  })

  it('wraps around from last to first', () => {
    store.getState().setTheme('one-light') // last in list
    store.getState().cycleTheme()
    expect(store.getState().theme).toBe('dark') // wraps to first
  })
})

describe('toggleSidebar', () => {
  it('toggles visibility', () => {
    store.getState().toggleSidebar()
    expect(store.getState().sidebarVisible).toBe(false)
    store.getState().toggleSidebar()
    expect(store.getState().sidebarVisible).toBe(true)
  })
})

describe('setSidePanelView', () => {
  it('sets the view', () => {
    store.getState().setSidePanelView({ type: 'browser', projectPath: '/p' })
    expect(store.getState().sidePanelView).toEqual({ type: 'browser', projectPath: '/p' })
  })

  it('toggles off when same view clicked again without file', () => {
    store.getState().setSidePanelView({ type: 'browser', projectPath: '/p' })
    store.getState().setSidePanelView({ type: 'browser', projectPath: '/p' })
    expect(store.getState().sidePanelView).toBeNull()
  })

  it('does not toggle off when navigating to specific file', () => {
    store.getState().setSidePanelView({ type: 'diff', projectPath: '/p' })
    store.getState().setSidePanelView({ type: 'diff', projectPath: '/p', file: 'foo.ts' })
    expect(store.getState().sidePanelView).toEqual({ type: 'diff', projectPath: '/p', file: 'foo.ts' })
  })

  it('remembers panel type per project', () => {
    store.getState().setSidePanelView({ type: 'diff', projectPath: '/p' })
    expect(store.getState().projectSidePanelMemory['/p']).toBe('diff')
  })
})

describe('toggleChatDetached', () => {
  it('enables detached and disables split view', () => {
    store.setState({ splitView: true, splitSessionId: 'x' })
    store.getState().toggleChatDetached()
    expect(store.getState().chatDetached).toBe(true)
    expect(store.getState().splitView).toBe(false)
    expect(store.getState().splitSessionId).toBeNull()
  })

  it('toggles back off', () => {
    store.getState().toggleChatDetached()
    store.getState().toggleChatDetached()
    expect(store.getState().chatDetached).toBe(false)
  })
})

describe('toggleSplitView', () => {
  it('enables split and disables detached', () => {
    store.setState({ chatDetached: true })
    store.getState().toggleSplitView()
    expect(store.getState().splitView).toBe(true)
    expect(store.getState().chatDetached).toBe(false)
  })

  it('toggles off and resets state', () => {
    store.getState().toggleSplitView()
    store.setState({ splitSessionId: 'x', splitRatio: 0.7 })
    store.getState().toggleSplitView()
    expect(store.getState().splitView).toBe(false)
    expect(store.getState().splitSessionId).toBeNull()
    expect(store.getState().splitRatio).toBe(0.5)
  })
})

describe('projectPairMemory', () => {
  it('stores and clears pairs', () => {
    store.getState().setProjectPair('/p', 'w1', 'r1')
    expect(store.getState().projectPairMemory['/p']).toEqual({ writerId: 'w1', reviewerId: 'r1' })

    store.getState().clearProjectPair('/p')
    expect(store.getState().projectPairMemory['/p']).toBeUndefined()
  })
})

describe('setSidePanelWidth', () => {
  it('sets width within bounds', () => {
    store.getState().setSidePanelWidth(600)
    expect(store.getState().sidePanelWidth).toBe(600)
  })

  it('clamps to minimum 300', () => {
    store.getState().setSidePanelWidth(100)
    expect(store.getState().sidePanelWidth).toBe(300)
  })

  it('clamps to max based on window width', () => {
    // window.innerWidth = 1920, so max = max(300, 1920-300) = 1620
    store.getState().setSidePanelWidth(9999)
    expect(store.getState().sidePanelWidth).toBe(1620)
  })
})

describe('setSplitSessionId', () => {
  it('sets split session id', () => {
    store.getState().setSplitSessionId('sess-2')
    expect(store.getState().splitSessionId).toBe('sess-2')
  })

  it('clears with null', () => {
    store.getState().setSplitSessionId('sess-2')
    store.getState().setSplitSessionId(null)
    expect(store.getState().splitSessionId).toBeNull()
  })
})

describe('setFocusedSplitPane', () => {
  it('sets to right', () => {
    store.getState().setFocusedSplitPane('right')
    expect(store.getState().focusedSplitPane).toBe('right')
  })

  it('sets to left', () => {
    store.getState().setFocusedSplitPane('right')
    store.getState().setFocusedSplitPane('left')
    expect(store.getState().focusedSplitPane).toBe('left')
  })
})

describe('setSettingsOpen', () => {
  it('opens settings', () => {
    store.getState().setSettingsOpen(true)
    expect(store.getState().settingsOpen).toBe(true)
  })

  it('closes settings', () => {
    store.getState().setSettingsOpen(true)
    store.getState().setSettingsOpen(false)
    expect(store.getState().settingsOpen).toBe(false)
  })
})

describe('setPendingBrowserUrl', () => {
  it('sets a pending URL', () => {
    store.getState().setPendingBrowserUrl('https://example.com')
    expect(store.getState().pendingBrowserUrl).toBe('https://example.com')
  })

  it('clears with null', () => {
    store.getState().setPendingBrowserUrl('https://example.com')
    store.getState().setPendingBrowserUrl(null)
    expect(store.getState().pendingBrowserUrl).toBeNull()
  })
})

describe('setSidePanelView - null', () => {
  it('clears view and preserves memory', () => {
    store.getState().setSidePanelView({ type: 'browser', projectPath: '/p' })
    store.getState().setSidePanelView(null)
    expect(store.getState().sidePanelView).toBeNull()
    // Memory from before should still be there
    expect(store.getState().projectSidePanelMemory['/p']).toBe('browser')
  })

  it('switches between different view types', () => {
    store.getState().setSidePanelView({ type: 'browser', projectPath: '/p' })
    store.getState().setSidePanelView({ type: 'diff', projectPath: '/p' })
    expect(store.getState().sidePanelView!.type).toBe('diff')
    expect(store.getState().projectSidePanelMemory['/p']).toBe('diff')
  })

  it('does not toggle off when different project', () => {
    store.getState().setSidePanelView({ type: 'browser', projectPath: '/p1' })
    store.getState().setSidePanelView({ type: 'browser', projectPath: '/p2' })
    expect(store.getState().sidePanelView).toEqual({ type: 'browser', projectPath: '/p2' })
  })
})

describe('suspendSplitView', () => {
  it('disables split view and clears session', () => {
    store.setState({ splitView: true, splitSessionId: 'x', focusedSplitPane: 'right' })
    store.getState().suspendSplitView()
    expect(store.getState().splitView).toBe(false)
    expect(store.getState().splitSessionId).toBeNull()
    expect(store.getState().focusedSplitPane).toBe('left')
  })

  it('calls unpairSessions when split was active', () => {
    store.setState({ splitView: true, splitSessionId: 'x' })
    store.getState().suspendSplitView()
    expect(window.api.agent.unpairSessions).toHaveBeenCalledWith('x')
  })

  it('does not call unpair when no split session', () => {
    const fn = window.api.agent.unpairSessions as ReturnType<typeof import('vitest').vi.fn>
    fn.mockClear()
    store.setState({ splitView: false, splitSessionId: null })
    store.getState().suspendSplitView()
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('restoreSplitView', () => {
  it('restores split view with session id', () => {
    store.setState({ chatDetached: true })
    store.getState().restoreSplitView('sess-2')
    expect(store.getState().splitView).toBe(true)
    expect(store.getState().splitSessionId).toBe('sess-2')
    expect(store.getState().focusedSplitPane).toBe('left')
    expect(store.getState().chatDetached).toBe(false)
  })
})

describe('toggleSplitView - unpair on close', () => {
  it('calls unpairSessions when closing split with a session', () => {
    store.setState({ splitView: true, splitSessionId: 'x' })
    store.getState().toggleSplitView()
    expect(window.api.agent.unpairSessions).toHaveBeenCalledWith('x')
  })
})
