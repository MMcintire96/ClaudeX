import { homedir } from 'os'
import { join } from 'path'
import { readdir, readFile } from 'fs/promises'

export interface Skill {
  name: string
  description: string
  content: string
}

const SKILLS_DIR = join(homedir(), '.claude', 'skills')

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Returns { name, description, body } or null if parsing fails.
 */
function parseFrontmatter(raw: string): { name: string; description: string; body: string } | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return null

  const frontmatter = match[1]
  const body = match[2].trim()

  let name = ''
  let description = ''
  for (const line of frontmatter.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)$/)
    if (nameMatch) name = nameMatch[1].trim()
    const descMatch = line.match(/^description:\s*(.+)$/)
    if (descMatch) description = descMatch[1].trim()
  }

  if (!name) return null
  return { name, description, body }
}

/**
 * Load all user-defined skills from ~/.claude/skills/.
 * Each skill is a subdirectory containing a SKILL.md file.
 */
export async function loadUserSkills(): Promise<Skill[]> {
  const skills: Skill[] = []

  let entries: string[]
  try {
    entries = await readdir(SKILLS_DIR)
  } catch {
    return skills
  }

  for (const entry of entries) {
    const skillFile = join(SKILLS_DIR, entry, 'SKILL.md')
    try {
      const raw = await readFile(skillFile, 'utf-8')
      const parsed = parseFrontmatter(raw)
      if (parsed) {
        skills.push({
          name: parsed.name,
          description: parsed.description,
          content: parsed.body
        })
      }
    } catch {
      // Skip directories without SKILL.md
    }
  }

  return skills
}

/**
 * Format loaded skills into a system prompt section.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return ''

  const sections = skills.map(s => {
    const header = `## Skill: ${s.name}\n${s.description}\n`
    return `${header}\n${s.content}`
  })

  return '\n\n# User-Defined Skills\n\n' + sections.join('\n\n---\n\n')
}
