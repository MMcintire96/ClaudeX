import { describe, it, expect, beforeEach } from 'vitest'
import { useTerminalStore, TerminalTab } from '../terminalStore'

const store = useTerminalStore

function resetStore(): void {
  store.setState({
    terminals: [],
    activeTerminalId: null,
    panelVisible: false,
    panelHeight: 300,
    projectTerminalMemory: {},
    manuallyRenamed: {},
    shellSplitIds: [],
    splitRatio: 0.5,
    poppedOut: {}
  })
}

function makeTab(id: string, projectPath = '/project'): TerminalTab {
  return { id, projectPath, pid: 1000 + parseInt(id.replace(/\D/g, '') || '0') }
}

beforeEach(resetStore)

describe('addTerminal', () => {
  it('adds tab, sets active, shows panel', () => {
    store.getState().addTerminal(makeTab('t1'))
    const state = store.getState()
    expect(state.terminals).toHaveLength(1)
    expect(state.activeTerminalId).toBe('t1')
    expect(state.panelVisible).toBe(true)
  })
})

describe('removeTerminal', () => {
  it('removes tab and picks new active', () => {
    store.getState().addTerminal(makeTab('t1'))
    store.getState().addTerminal(makeTab('t2'))
    store.getState().removeTerminal('t2')
    expect(store.getState().terminals).toHaveLength(1)
    expect(store.getState().activeTerminalId).toBe('t1')
  })

  it('nulls active and hides panel when last tab removed', () => {
    store.getState().addTerminal(makeTab('t1'))
    store.getState().removeTerminal('t1')
    expect(store.getState().activeTerminalId).toBeNull()
    expect(store.getState().panelVisible).toBe(false)
  })

  it('cleans up manuallyRenamed', () => {
    store.getState().addTerminal(makeTab('t1'))
    store.setState({ manuallyRenamed: { t1: true } })
    store.getState().removeTerminal('t1')
    expect(store.getState().manuallyRenamed['t1']).toBeUndefined()
  })

  it('cleans up shell split state', () => {
    store.getState().addTerminal(makeTab('t1'))
    store.getState().addTerminal(makeTab('t2'))
    store.setState({ shellSplitIds: ['t1', 't2'] })
    store.getState().removeTerminal('t2')
    // With only one remaining, splits should be cleared
    expect(store.getState().shellSplitIds).toEqual([])
  })
})

describe('setActiveTerminal', () => {
  it('sets active terminal', () => {
    store.getState().addTerminal(makeTab('t1'))
    store.getState().addTerminal(makeTab('t2'))
    store.getState().setActiveTerminal('t1')
    expect(store.getState().activeTerminalId).toBe('t1')
  })

  it('remembers per-project', () => {
    store.getState().addTerminal(makeTab('t1', '/p1'))
    store.getState().addTerminal(makeTab('t2', '/p1'))
    store.getState().setActiveTerminal('t1')
    expect(store.getState().projectTerminalMemory['/p1']).toBe('t1')
  })

  it('handles null', () => {
    store.getState().setActiveTerminal(null)
    expect(store.getState().activeTerminalId).toBeNull()
  })
})

describe('switchToProjectTerminals', () => {
  it('uses remembered terminal', () => {
    store.getState().addTerminal(makeTab('t1', '/p1'))
    store.getState().addTerminal(makeTab('t2', '/p1'))
    store.getState().setActiveTerminal('t1')
    store.getState().addTerminal(makeTab('t3', '/p2')) // switches active to t3
    store.getState().switchToProjectTerminals('/p1')
    expect(store.getState().activeTerminalId).toBe('t1')
  })

  it('falls back to first project terminal', () => {
    store.getState().addTerminal(makeTab('t1', '/p1'))
    store.getState().addTerminal(makeTab('t2', '/p2'))
    store.getState().switchToProjectTerminals('/p1')
    expect(store.getState().activeTerminalId).toBe('t1')
  })

  it('nulls active and hides panel for project with no terminals', () => {
    store.getState().switchToProjectTerminals('/empty')
    expect(store.getState().activeTerminalId).toBeNull()
    expect(store.getState().panelVisible).toBe(false)
  })
})

describe('setPanelHeight', () => {
  it('sets within bounds', () => {
    store.getState().setPanelHeight(400)
    expect(store.getState().panelHeight).toBe(400)
  })

  it('clamps to minimum 150', () => {
    store.getState().setPanelHeight(50)
    expect(store.getState().panelHeight).toBe(150)
  })

  it('clamps to maximum 600', () => {
    store.getState().setPanelHeight(999)
    expect(store.getState().panelHeight).toBe(600)
  })
})

describe('setSplitRatio', () => {
  it('sets within bounds', () => {
    store.getState().setSplitRatio(0.6)
    expect(store.getState().splitRatio).toBe(0.6)
  })

  it('clamps to minimum 0.15', () => {
    store.getState().setSplitRatio(0.05)
    expect(store.getState().splitRatio).toBe(0.15)
  })

  it('clamps to maximum 0.85', () => {
    store.getState().setSplitRatio(0.95)
    expect(store.getState().splitRatio).toBe(0.85)
  })
})

describe('autoRenameTerminal', () => {
  it('renames when not manually renamed', () => {
    store.getState().addTerminal(makeTab('t1'))
    store.getState().autoRenameTerminal('t1', 'auto-name')
    expect(store.getState().terminals[0].name).toBe('auto-name')
  })

  it('skips rename when manually renamed', () => {
    store.getState().addTerminal(makeTab('t1'))
    store.getState().manualRenameTerminal('t1', 'manual-name')
    store.getState().autoRenameTerminal('t1', 'auto-name')
    expect(store.getState().terminals[0].name).toBe('manual-name')
  })
})

describe('splitShell / unsplitShell', () => {
  it('splits and unsplits', () => {
    store.getState().addTerminal(makeTab('t1'))
    store.getState().splitShell('t2')
    expect(store.getState().shellSplitIds).toEqual(['t1', 't2'])

    store.getState().unsplitShell()
    expect(store.getState().shellSplitIds).toEqual([])
    expect(store.getState().splitRatio).toBe(0.5)
    expect(store.getState().activeTerminalId).toBe('t1')
  })

  it('does nothing when no active terminal', () => {
    store.getState().setActiveTerminal(null)
    store.getState().splitShell('t2')
    expect(store.getState().shellSplitIds).toEqual([])
  })
})

describe('togglePanel', () => {
  it('toggles visibility', () => {
    store.getState().togglePanel()
    expect(store.getState().panelVisible).toBe(true)
    store.getState().togglePanel()
    expect(store.getState().panelVisible).toBe(false)
  })
})

describe('setPoppedOut', () => {
  it('sets and clears popped out state', () => {
    store.getState().setPoppedOut('t1', true)
    expect(store.getState().poppedOut['t1']).toBe(true)

    store.getState().setPoppedOut('t1', false)
    expect(store.getState().poppedOut['t1']).toBeUndefined()
  })
})
