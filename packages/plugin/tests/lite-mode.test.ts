import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'
import {
  LITE_HISTORY_RECORDS,
  LITE_PROJECTION_BUDGET_BYTES,
  LITE_PROJECTION_MAX_BYTES,
  applyLiteMode,
  filterLiteProjections,
} from '../src/lite-mode.js'

const snapshot = (records: number, projections: Record<string, unknown> = {}) => ({
  streamId: 'stream',
  hasValue: true,
  value: { type: 'snapshot', records: Array.from({ length: records }, (_, index) => ({ seq: index })), projections },
})

describe('lite mode', () => {
  it('is on by default and can be turned off explicitly', () => {
    expect(resolveConfig({}).liteMode).toBe(true)
    expect(resolveConfig({ liteMode: false }).liteMode).toBe(false)
    expect(resolveConfig({ liteMode: true }).liteMode).toBe(true)
  })

  it('keeps only the newest history page and reports hasMore', () => {
    const shaped = applyLiteMode(snapshot(40)) as { value: { records: unknown[], hasMore: boolean } }
    expect(shaped.value.records).toHaveLength(LITE_HISTORY_RECORDS)
    expect(shaped.value.records.at(-1)).toEqual({ seq: 39 })
    expect(shaped.value.hasMore).toBe(true)
  })

  it('drops oversized projections but keeps the render-critical ones', () => {
    const projections = filterLiteProjections({
      title: { text: 'x'.repeat(LITE_PROJECTION_MAX_BYTES * 2) },
      contextLens: { requests: Array.from({ length: 500 }, () => 'y'.repeat(64)) },
      smallPanel: { ok: true },
    }) as Record<string, unknown>
    expect(Object.keys(projections).sort()).toEqual(['smallPanel', 'title'])
  })

  it('bounds the total projection payload even when every entry is small', () => {
    const projections = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`panel${index}`, 'z'.repeat(12 * 1024)]))
    const kept = filterLiteProjections(projections) as Record<string, unknown>
    const total = Buffer.byteLength(JSON.stringify(kept))
    expect(Object.keys(kept).length).toBeLessThan(64)
    expect(total).toBeLessThanOrEqual(LITE_PROJECTION_BUDGET_BYTES)
  })

  it('skips a projection frame that would only carry dropped data', () => {
    expect(applyLiteMode({ streamId: 's', hasValue: true, value: { type: 'projection', value: 'q'.repeat(LITE_PROJECTION_MAX_BYTES * 2) } })).toBeUndefined()
    expect(applyLiteMode({ streamId: 's', hasValue: true, value: { type: 'projection', value: { ok: true } } })).toBeDefined()
  })
})
