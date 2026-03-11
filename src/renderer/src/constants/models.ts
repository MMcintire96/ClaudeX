export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6', provider: 'anthropic', effortLevels: ['low', 'medium', 'high'] as EffortLevel[] },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', provider: 'anthropic', effortLevels: ['low', 'medium', 'high'] as EffortLevel[] },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', provider: 'anthropic', effortLevels: null },
  { id: 'gpt-5-codex-mini', label: 'Codex Mini', provider: 'openai', effortLevels: null },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', provider: 'openai', effortLevels: null },
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai', effortLevels: null },
] as const

type ModelId = (typeof AVAILABLE_MODELS)[number]['id']

export const DEFAULT_MODEL: ModelId = 'claude-opus-4-6'
export const DEFAULT_EFFORT: EffortLevel = 'high'

export const MODEL_IDS = AVAILABLE_MODELS.map(m => m.id)

export function getModelLabel(id: string): string {
  return AVAILABLE_MODELS.find(m => m.id === id)?.label ?? id.split('-').slice(1).join(' ')
}

export function getModelEffortLevels(id: string): readonly EffortLevel[] | null {
  return AVAILABLE_MODELS.find(m => m.id === id)?.effortLevels ?? null
}
