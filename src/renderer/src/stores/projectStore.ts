import { create } from 'zustand'

interface RecentProject {
  path: string
  name: string
  lastOpened: number
}

export interface ProjectGroup {
  id: string
  name: string
  projectPaths: string[]
}

interface ProjectState {
  currentPath: string | null
  currentName: string | null
  isGitRepo: boolean
  recentProjects: RecentProject[]
  expandedProjects: string[]
  gitBranches: Record<string, string>
  groups: ProjectGroup[]
  groupOrder: string[]
  collapsedGroups: string[]

  setProject: (path: string, isGitRepo: boolean) => void
  setRecent: (projects: RecentProject[]) => void
  setGroups: (groups: ProjectGroup[], groupOrder: string[]) => void
  toggleProjectExpanded: (path: string) => void
  setProjectExpanded: (path: string, expanded: boolean) => void
  reorderProjects: (paths: string[]) => void
  removeProject: (path: string) => void
  setGitBranch: (projectPath: string, branch: string) => void
  toggleGroupCollapsed: (groupId: string) => void
  setCollapsedGroups: (collapsedGroups: string[]) => void
  updateGroupLocally: (groupId: string, update: Partial<ProjectGroup>) => void
  removeGroupLocally: (groupId: string) => void
  addGroupLocally: (group: ProjectGroup) => void
  moveProjectToGroupLocally: (projectPath: string, groupId: string | null) => void
  reorderGroupOrder: (newOrder: string[]) => void
  reorderWithinGroupLocally: (groupId: string, paths: string[]) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentPath: null,
  currentName: null,
  isGitRepo: false,
  recentProjects: [],
  expandedProjects: [],
  gitBranches: {},
  groups: [],
  groupOrder: [],
  collapsedGroups: [],

  setProject: (path: string, isGitRepo: boolean): void => {
    const name = path.split('/').pop() || path
    set({
      currentPath: path,
      currentName: name,
      isGitRepo,
    })
  },

  setRecent: (projects: RecentProject[]): void => {
    set({ recentProjects: projects })
  },

  setGroups: (groups: ProjectGroup[], groupOrder: string[]): void => {
    set({ groups, groupOrder })
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
      groups: state.groups.map(g => ({
        ...g,
        projectPaths: g.projectPaths.filter(p => p !== path)
      })),
      groupOrder: state.groupOrder.filter(e => e !== path),
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

  toggleGroupCollapsed: (groupId: string): void => {
    set(state => ({
      collapsedGroups: state.collapsedGroups.includes(groupId)
        ? state.collapsedGroups.filter(id => id !== groupId)
        : [...state.collapsedGroups, groupId]
    }))
  },

  setCollapsedGroups: (collapsedGroups: string[]): void => {
    set({ collapsedGroups })
  },

  addGroupLocally: (group: ProjectGroup): void => {
    set(state => ({
      groups: [...state.groups, group],
      groupOrder: [...state.groupOrder, group.id]
    }))
  },

  updateGroupLocally: (groupId: string, update: Partial<ProjectGroup>): void => {
    set(state => ({
      groups: state.groups.map(g => g.id === groupId ? { ...g, ...update } : g)
    }))
  },

  removeGroupLocally: (groupId: string): void => {
    set(state => {
      const group = state.groups.find(g => g.id === groupId)
      const ungroupedPaths = group?.projectPaths ?? []
      const groupIdx = state.groupOrder.indexOf(groupId)
      const newOrder = [...state.groupOrder]
      if (groupIdx !== -1) {
        newOrder.splice(groupIdx, 1, ...ungroupedPaths)
      }
      return {
        groups: state.groups.filter(g => g.id !== groupId),
        groupOrder: newOrder
      }
    })
  },

  moveProjectToGroupLocally: (projectPath: string, groupId: string | null): void => {
    set(state => {
      // Remove from all groups
      const newGroups = state.groups.map(g => ({
        ...g,
        projectPaths: g.projectPaths.filter(p => p !== projectPath)
      }))
      let newOrder = state.groupOrder.filter(e => e !== projectPath)

      if (groupId === null) {
        // Move to ungrouped — add to end of groupOrder
        newOrder.push(projectPath)
      } else {
        // Add to target group
        const target = newGroups.find(g => g.id === groupId)
        if (target) {
          target.projectPaths.push(projectPath)
        }
      }

      return { groups: newGroups, groupOrder: newOrder }
    })
  },

  reorderGroupOrder: (newOrder: string[]): void => {
    set({ groupOrder: newOrder })
  },

  reorderWithinGroupLocally: (groupId: string, paths: string[]): void => {
    set(state => ({
      groups: state.groups.map(g => g.id === groupId ? { ...g, projectPaths: paths } : g)
    }))
  }
}))
