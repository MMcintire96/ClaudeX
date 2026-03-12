import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore } from '../projectStore'

const store = useProjectStore

function resetStore(): void {
  store.setState({
    currentPath: null,
    currentName: null,
    isGitRepo: false,
    recentProjects: [],
    expandedProjects: [],
    gitBranches: {}
  })
}

beforeEach(resetStore)

describe('setProject', () => {
  it('sets current project and extracts name', () => {
    store.getState().setProject('/home/user/myproject', true)
    const state = store.getState()
    expect(state.currentPath).toBe('/home/user/myproject')
    expect(state.currentName).toBe('myproject')
    expect(state.isGitRepo).toBe(true)
  })

  it('handles root path', () => {
    store.getState().setProject('/', false)
    // '/'.split('/').pop() returns '' which is falsy, so falls back to '/'
    expect(store.getState().currentName).toBe('/')
  })
})

describe('toggleProjectExpanded', () => {
  it('adds path to expanded list', () => {
    store.getState().toggleProjectExpanded('/p1')
    expect(store.getState().expandedProjects).toContain('/p1')
  })

  it('removes path when toggled again', () => {
    store.getState().toggleProjectExpanded('/p1')
    store.getState().toggleProjectExpanded('/p1')
    expect(store.getState().expandedProjects).not.toContain('/p1')
  })
})

describe('setProjectExpanded', () => {
  it('expands a project', () => {
    store.getState().setProjectExpanded('/p1', true)
    expect(store.getState().expandedProjects).toContain('/p1')
  })

  it('collapses a project', () => {
    store.getState().setProjectExpanded('/p1', true)
    store.getState().setProjectExpanded('/p1', false)
    expect(store.getState().expandedProjects).not.toContain('/p1')
  })

  it('does not duplicate when already expanded', () => {
    store.getState().setProjectExpanded('/p1', true)
    store.getState().setProjectExpanded('/p1', true)
    expect(store.getState().expandedProjects.filter(p => p === '/p1')).toHaveLength(1)
  })
})

describe('reorderProjects', () => {
  it('reorders by given path order', () => {
    store.setState({
      recentProjects: [
        { path: '/a', name: 'a', lastOpened: 1 },
        { path: '/b', name: 'b', lastOpened: 2 },
        { path: '/c', name: 'c', lastOpened: 3 }
      ]
    })
    store.getState().reorderProjects(['/c', '/a', '/b'])
    const paths = store.getState().recentProjects.map(p => p.path)
    expect(paths).toEqual(['/c', '/a', '/b'])
  })

  it('drops paths not in the order list', () => {
    store.setState({
      recentProjects: [
        { path: '/a', name: 'a', lastOpened: 1 },
        { path: '/b', name: 'b', lastOpened: 2 }
      ]
    })
    store.getState().reorderProjects(['/a'])
    expect(store.getState().recentProjects).toHaveLength(1)
  })
})

describe('removeProject', () => {
  it('removes from recent and expanded', () => {
    store.setState({
      recentProjects: [{ path: '/p1', name: 'p1', lastOpened: 1 }],
      expandedProjects: ['/p1']
    })
    store.getState().removeProject('/p1')
    expect(store.getState().recentProjects).toHaveLength(0)
    expect(store.getState().expandedProjects).toHaveLength(0)
  })

  it('clears current if removed project is active', () => {
    store.setState({
      currentPath: '/p1',
      currentName: 'p1',
      isGitRepo: true,
      recentProjects: [{ path: '/p1', name: 'p1', lastOpened: 1 }]
    })
    store.getState().removeProject('/p1')
    expect(store.getState().currentPath).toBeNull()
    expect(store.getState().currentName).toBeNull()
  })

  it('keeps current if different project removed', () => {
    store.setState({
      currentPath: '/p1',
      currentName: 'p1',
      recentProjects: [
        { path: '/p1', name: 'p1', lastOpened: 1 },
        { path: '/p2', name: 'p2', lastOpened: 2 }
      ]
    })
    store.getState().removeProject('/p2')
    expect(store.getState().currentPath).toBe('/p1')
  })
})

describe('setGitBranch', () => {
  it('stores branch per project', () => {
    store.getState().setGitBranch('/p1', 'main')
    store.getState().setGitBranch('/p2', 'develop')
    expect(store.getState().gitBranches).toEqual({ '/p1': 'main', '/p2': 'develop' })
  })
})

