import { create } from 'zustand'

export interface RecentProject {
  path: string
  name: string
  lastOpened: number
}

interface ProjectState {
  currentPath: string | null
  currentName: string | null
  isGitRepo: boolean
  recentProjects: RecentProject[]
  expandedProjects: string[]
  gitBranches: Record<string, string>

  setProject: (path: string, isGitRepo: boolean) => void
  setRecent: (projects: RecentProject[]) => void
  toggleProjectExpanded: (path: string) => void
  setProjectExpanded: (path: string, expanded: boolean) => void
  reorderProjects: (paths: string[]) => void
  removeProject: (path: string) => void
  setGitBranch: (projectPath: string, branch: string) => void
  clear: () => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentPath: null,
  currentName: null,
  isGitRepo: false,
  recentProjects: [],
  expandedProjects: [],
  gitBranches: {},

  setProject: (path: string, isGitRepo: boolean): void => {
    const name = path.split('/').pop() || path
    set(state => ({
      currentPath: path,
      currentName: name,
      isGitRepo,
      expandedProjects: state.expandedProjects.includes(path)
        ? state.expandedProjects
        : [...state.expandedProjects, path]
    }))
  },

  setRecent: (projects: RecentProject[]): void => {
    set({ recentProjects: projects })
  },

  toggleProjectExpanded: (path: string): void => {
    set(state => ({
      expandedProjects: state.expandedProjects.includes(path)
        ? state.expandedProjects.filter(p => p !== path)
        : [...state.expandedProjects, path]
    }))
  },

  setProjectExpanded: (path: string, expanded: boolean): void => {
    set(state => ({
      expandedProjects: expanded
        ? state.expandedProjects.includes(path)
          ? state.expandedProjects
          : [...state.expandedProjects, path]
        : state.expandedProjects.filter(p => p !== path)
    }))
  },

  reorderProjects: (paths: string[]): void => {
    set(state => {
      const byPath = new Map(state.recentProjects.map(p => [p.path, p]))
      const reordered: RecentProject[] = []
      for (const path of paths) {
        const proj = byPath.get(path)
        if (proj) reordered.push(proj)
      }
      return { recentProjects: reordered }
    })
  },

  removeProject: (path: string): void => {
    set(state => ({
      recentProjects: state.recentProjects.filter(p => p.path !== path),
      expandedProjects: state.expandedProjects.filter(p => p !== path),
      ...(state.currentPath === path
        ? { currentPath: null, currentName: null, isGitRepo: false }
        : {})
    }))
  },

  setGitBranch: (projectPath: string, branch: string): void => {
    set(state => ({
      gitBranches: { ...state.gitBranches, [projectPath]: branch }
    }))
  },

  clear: (): void => {
    set({ currentPath: null, currentName: null, isGitRepo: false })
  }
}))
