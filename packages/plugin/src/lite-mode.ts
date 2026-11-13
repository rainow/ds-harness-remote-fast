/**
 * Lite mode: shrink what a remote client receives on first paint.
 *
 * Large sessions make the initial `snapshot` frame megabytes wide (hundreds of
 * records plus per-session projections such as the context-lens panel). Clients
 * that cannot chunk a frame (`transferFrames: false`, e.g. the web client) hit
 * "Oversized Harness Remote frame" and the whole connection drops. Lite mode
 * keeps the frame small instead:
 *
 * - `records` is trimmed to the newest few entries (the client still sees
 *   `hasMore: true`, so it can page back for older ones),
 * - projections above {@link LITE_PROJECTION_MAX_BYTES} are dropped, while a
 *   small keep-list of projections the UI needs to render survives regardless.
 *
 * Only data sent over the wire is affected; the session store and the agent
 * context are untouched.
 */

/**
 * Projections a remote client must never miss: they drive the chrome and, more
 * importantly, live state the user is acting on (permission switches, pending
 * questions, turn status). These bypass the size caps -- dropping one leaves the
 * client permanently stale while the Host has already applied the change.
 *
 * Mirrors the core keys the Host itself keeps in SESSION_PROJECTION_WHITELIST
 * (see harness-remote-bridge.ts). Deliberately a copy, not an import: lite-mode
 * must not depend on the bridge, and adding a key here is a product decision.
 */
export const LITE_PROJECTION_KEEP_KEYS: ReadonlySet<string> = new Set([
  // chrome that frames the conversation
  'title',
  'sessionTitle',
  'conversationTitle',
  'label',
  'name',
  'summary',
  'modelSelection',
  'model',
  'agentPreset',
  'imageLimits',
  'sessionListMetadata',
  // live state: permissions, questions, turn lifecycle
  'permissions',
  'remoteStatusKnown',
  'codexStatus',
  'inbox',
  'agentTeam',
  'turnOutline',
  'turn',
  'turnState',
  'status',
  'activeTurnId',
  'userQuestions',
])

/** Projections larger than this many bytes are dropped in lite mode. */
export const LITE_PROJECTION_MAX_BYTES = 16 * 1024

/**
 * Total budget for one frame's projections. Individual entries can be small and
 * still add up (dozens of sessions in one baseline), so the frame is capped.
 */
export const LITE_PROJECTION_BUDGET_BYTES = 256 * 1024

/** How many records the initial history page keeps in lite mode. */
export const LITE_HISTORY_RECORDS = 10

/**
 * Process-wide switch, mirroring how the plugin wires other runtime flags: the Host
 * and its bridges live in one process, so a single module-level value is enough and
 * a toggle applies to the next frame instead of requiring a reconnect.
 */
let enabled = false

/** Whether lite mode is currently on. */
export function isLiteModeEnabled(): boolean {
  return enabled
}

/** Flip lite mode for subsequent frames. */
export function setLiteModeEnabled(next: boolean): void {
  enabled = next === true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sizeOf(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value))
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/**
 * Keep the render-critical projections, then the smallest of the rest while the
 * frame stays under {@link LITE_PROJECTION_BUDGET_BYTES}.
 */
export function filterLiteProjections(projections: unknown): unknown {
  if (!isRecord(projections)) return projections
  const kept: Record<string, unknown> = {}
  const candidates: Array<{ key: string, value: unknown, size: number }> = []
  let used = 0
  for (const [key, value] of Object.entries(projections)) {
    const size = sizeOf(value)
    if (LITE_PROJECTION_KEEP_KEYS.has(key)) {
      kept[key] = value
      used += size
      continue
    }
    if (size <= LITE_PROJECTION_MAX_BYTES) candidates.push({ key, value, size })
  }
  candidates.sort((left, right) => left.size - right.size)
  for (const { key, value, size } of candidates) {
    if (used + size > LITE_PROJECTION_BUDGET_BYTES) break
    kept[key] = value
    used += size
  }
  return kept
}

/**
 * Apply lite-mode shaping to one history frame.
 * @returns the (possibly rewritten) frame, or `undefined` when the whole frame
 *   should be skipped because it carries only a dropped projection.
 */
export function applyLiteMode(frame: unknown): unknown {
  if (!isRecord(frame) || !isRecord(frame.value)) return frame
  const layer = frame.value
  if (layer.type === 'baseline' && isRecord(layer.value)) {
    const inner = layer.value
    if (!isRecord(inner.projections)) return frame
    // Shape is `projections[sessionId] = { asOfSeq, values: { key: value } }`
    // (see client-core `applyProjectionBaseline`). Filter the inner `values`
    // map -- filtering the block itself would treat `asOfSeq`/`values` as
    // projection keys and drop the whole block once it grew past the cap,
    // which silently loses permissions/questions on first paint.
    const projections: Record<string, unknown> = {}
    for (const [sessionId, block] of Object.entries(inner.projections)) {
      if (!isRecord(block) || !isRecord(block.values)) {
        projections[sessionId] = block
        continue
      }
      projections[sessionId] = { ...block, values: filterLiteProjections(block.values) }
    }
    return { ...frame, value: { ...layer, value: { ...inner, projections } } }
  }
  if (layer.type === 'snapshot') {
    // The snapshot payload is either the layer itself or nested under `value`,
    // depending on the backend that produced it.
    const nested = isRecord(layer.value)
    const inner: Record<string, unknown> = { ...(nested ? (layer.value as Record<string, unknown>) : layer) }
    if (Array.isArray(inner.records) && inner.records.length > LITE_HISTORY_RECORDS) {
      inner.records = inner.records.slice(-LITE_HISTORY_RECORDS)
      inner.hasMore = true
    }
    if (isRecord(inner.projections) && isRecord(inner.projections.values)) {
      inner.projections = { ...inner.projections, values: filterLiteProjections(inner.projections.values) }
    }
    return { ...frame, value: nested ? { ...layer, value: inner } : inner }
  }
  if (layer.type === 'projection') {
    // A projection frame is a live update of one key. Dropping a state-bearing
    // key silently desynchronises the client (permissions applied on the Host
    // but never shown, questions never surfaced), so only unknown/cosmetic keys
    // are allowed to be dropped for size.
    const key = typeof layer.key === 'string' ? layer.key : undefined
    if (key !== undefined && LITE_PROJECTION_KEEP_KEYS.has(key)) return frame
    if (sizeOf(layer.value) > LITE_PROJECTION_MAX_BYTES) return undefined
  }
  return frame
}
