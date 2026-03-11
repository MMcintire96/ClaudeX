import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../editorStore'

const store = useEditorStore

function resetStore(): void {
  store.setState({
    activeEditors: {},
    mainPanelTab: 'chat'
  })
}

beforeEach(resetStore)

describe('setMainPanelTab', () => {
  it('switches to editor', () => {
    store.getState().setMainPanelTab('editor')
    expect(store.getState().mainPanelTab).toBe('editor')
  })

  it('switches back to chat', () => {
    store.getState().setMainPanelTab('editor')
    store.getState().setMainPanelTab('chat')
    expect(store.getState().mainPanelTab).toBe('chat')
  })
})

describe('setEditorActive', () => {
  it('registers an editor for a project', () => {
    store.getState().setEditorActive('/project', 1234)
    const editor = store.getState().activeEditors['/project']
    expect(editor).toEqual({ pid: 1234, ready: true })
  })

  it('overwrites previous editor for same project', () => {
    store.getState().setEditorActive('/project', 1234)
    store.getState().setEditorActive('/project', 5678)
    expect(store.getState().activeEditors['/project'].pid).toBe(5678)
  })

  it('tracks multiple projects independently', () => {
    store.getState().setEditorActive('/p1', 100)
    store.getState().setEditorActive('/p2', 200)
    expect(store.getState().activeEditors['/p1'].pid).toBe(100)
    expect(store.getState().activeEditors['/p2'].pid).toBe(200)
  })
})

describe('removeEditor', () => {
  it('removes editor for project', () => {
    store.getState().setEditorActive('/project', 1234)
    store.getState().removeEditor('/project')
    expect(store.getState().activeEditors['/project']).toBeUndefined()
  })

  it('does not affect other projects', () => {
    store.getState().setEditorActive('/p1', 100)
    store.getState().setEditorActive('/p2', 200)
    store.getState().removeEditor('/p1')
    expect(store.getState().activeEditors['/p2'].pid).toBe(200)
  })

  it('handles removing nonexistent project gracefully', () => {
    store.getState().removeEditor('/nonexistent')
    expect(store.getState().activeEditors).toEqual({})
  })
})
