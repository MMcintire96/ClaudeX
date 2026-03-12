import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'fs'
import type { AutomationDefinition, AutomationRun } from './types'

export class AutomationPersistence {
  private configDir: string
  private automationsPath: string
  private runsDir: string

  constructor() {
    this.configDir = join(app.getPath('userData'))
    this.automationsPath = join(this.configDir, 'automations.json')
    this.runsDir = join(this.configDir, 'automation-runs')
    mkdirSync(this.runsDir, { recursive: true })
  }

  // --- Automation definitions ---

  loadAutomations(): AutomationDefinition[] {
    try {
      if (existsSync(this.automationsPath)) {
        const raw = readFileSync(this.automationsPath, 'utf-8')
        return JSON.parse(raw) as AutomationDefinition[]
      }
    } catch (err) {
      console.warn('[AutomationPersistence] Failed to load automations:', err)
    }
    return []
  }

  saveAutomations(defs: AutomationDefinition[]): void {
    try {
      writeFileSync(this.automationsPath, JSON.stringify(defs, null, 2), 'utf-8')
    } catch (err) {
      console.error('[AutomationPersistence] Failed to save automations:', err)
    }
  }

  // --- Run records ---

  private runDir(automationId: string): string {
    const dir = join(this.runsDir, automationId)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  private runPath(automationId: string, runId: string): string {
    return join(this.runDir(automationId), `${runId}.json`)
  }

  saveRun(run: AutomationRun): void {
    try {
      writeFileSync(this.runPath(run.automationId, run.id), JSON.stringify(run, null, 2), 'utf-8')
    } catch (err) {
      console.error('[AutomationPersistence] Failed to save run:', err)
    }
  }

  loadRun(automationId: string, runId: string): AutomationRun | null {
    try {
      const p = this.runPath(automationId, runId)
      if (existsSync(p)) {
        return JSON.parse(readFileSync(p, 'utf-8')) as AutomationRun
      }
    } catch (err) {
      console.warn('[AutomationPersistence] Failed to load run:', err)
    }
    return null
  }

  loadRuns(automationId: string, limit?: number): AutomationRun[] {
    const dir = join(this.runsDir, automationId)
    if (!existsSync(dir)) return []

    try {
      const files = readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse() // newest first (UUIDs with timestamp prefixes or sorted by name)

      const runs: AutomationRun[] = []
      const max = limit ?? files.length
      for (let i = 0; i < Math.min(max, files.length); i++) {
        try {
          const raw = readFileSync(join(dir, files[i]), 'utf-8')
          runs.push(JSON.parse(raw) as AutomationRun)
        } catch { /* skip corrupt files */ }
      }
      // Sort by startedAt descending
      runs.sort((a, b) => b.startedAt - a.startedAt)
      return limit ? runs.slice(0, limit) : runs
    } catch (err) {
      console.warn('[AutomationPersistence] Failed to load runs:', err)
      return []
    }
  }

  loadAllTriageRuns(): AutomationRun[] {
    if (!existsSync(this.runsDir)) return []
    const triage: AutomationRun[] = []

    try {
      const automationDirs = readdirSync(this.runsDir)
      for (const automationId of automationDirs) {
        const dir = join(this.runsDir, automationId)
        try {
          const files = readdirSync(dir).filter(f => f.endsWith('.json'))
          for (const file of files) {
            try {
              const raw = readFileSync(join(dir, file), 'utf-8')
              const run = JSON.parse(raw) as AutomationRun
              if (run.triageStatus === 'triage' || run.triageStatus === 'pinned') {
                triage.push(run)
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    } catch (err) {
      console.warn('[AutomationPersistence] Failed to load triage runs:', err)
    }

    triage.sort((a, b) => b.startedAt - a.startedAt)
    return triage
  }

  deleteRunsForAutomation(automationId: string): void {
    const dir = join(this.runsDir, automationId)
    try {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    } catch (err) {
      console.warn('[AutomationPersistence] Failed to delete runs:', err)
    }
  }
}
