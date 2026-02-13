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

  setProject: (path: string, isGitRepo: boolean) => void
  setRecent: (projects: RecentProject[]) => void
  toggleProjectExpanded: (path: string) => void
  setProjectExpanded: (path: string, expanded: boolean) => void
  clear: () => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentPath: null,
  currentName: null,
  isGitRepo: false,
  recentProjects: [],
  expandedProjects: [],

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

  clear: (): void => {
    set({ currentPath: null, currentName: null, isGitRepo: false })
  }
}))
