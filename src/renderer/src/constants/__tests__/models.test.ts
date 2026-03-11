import { describe, it, expect } from 'vitest'
import { getModelLabel, getModelEffortLevels, AVAILABLE_MODELS, MODEL_IDS, DEFAULT_MODEL, DEFAULT_EFFORT } from '../models'

describe('getModelLabel', () => {
  it('returns label for known model', () => {
    expect(getModelLabel('claude-opus-4-6')).toBe('Opus 4.6')
    expect(getModelLabel('claude-sonnet-4-6')).toBe('Sonnet 4.6')
    expect(getModelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  })

  it('returns formatted fallback for unknown model', () => {
    // Splits on '-', drops first segment, joins rest
    expect(getModelLabel('unknown-foo-bar')).toBe('foo bar')
  })
})

describe('getModelEffortLevels', () => {
  it('returns effort levels for models that support them', () => {
    const levels = getModelEffortLevels('claude-opus-4-6')
    expect(levels).toEqual(['low', 'medium', 'high'])
  })

  it('returns null for models without effort levels', () => {
    expect(getModelEffortLevels('claude-haiku-4-5-20251001')).toBeNull()
  })

  it('returns null for unknown model', () => {
    expect(getModelEffortLevels('nonexistent')).toBeNull()
  })
})

describe('constants', () => {
  it('MODEL_IDS matches AVAILABLE_MODELS', () => {
    expect(MODEL_IDS).toEqual(AVAILABLE_MODELS.map(m => m.id))
  })

  it('DEFAULT_MODEL is a valid model', () => {
    expect(MODEL_IDS).toContain(DEFAULT_MODEL)
  })

  it('DEFAULT_EFFORT is a valid effort level', () => {
    expect(['low', 'medium', 'high', 'max']).toContain(DEFAULT_EFFORT)
  })
})
