import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Host-side fallback for clients that render history images through
 * `workspaceFiles/read` (DSH Go does) instead of `session/attachment`.
 *
 * Pasted images live in the Harness attachment store, which sits outside every
 * workspace, so the native reader answers `WORKSPACE_PATH_DENIED` and the image
 * renders blank. This module can serve exactly two kinds of path: a file inside
 * the content-addressed store whose id the Host has already sent to a client.
 *
 * That last rule is the security boundary: a remote client may only read bytes
 * for an attachment it was already shown in history.
 */

const ATTACHMENT_ID = /^[a-f0-9]{64}$/
const ID_IN_TEXT = /"attachmentId":"sha256:([a-f0-9]{64})"/g
/** Ids seen in history frames; bounded so a long-lived Host cannot grow forever. */
const KNOWN_LIMIT = 2048

const known = new Map<string, true>()

function remember(id: string): void {
  if (known.has(id)) return
  known.set(id, true)
  while (known.size > KNOWN_LIMIT) {
    const oldest = known.keys().next().value
    if (oldest === undefined) break
    known.delete(oldest)
  }
}

/** Record attachment ids carried by one history frame. */
export function rememberAttachmentRefs(text: string): void {
  for (const match of text.matchAll(ID_IN_TEXT)) {
    const id = match[1]
    if (id !== undefined) remember(id)
  }
}

/** Test seam. */
export function isKnownAttachment(id: string): boolean {
  return known.has(id)
}

/** `~/.dsh/attachments/v1/objects` unless DSH_HOME says otherwise. */
export function attachmentStoreRoot(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'attachments', 'v1', 'objects')
}

function normalizePath(value: string): string | undefined {
  let path = value.trim()
  if (path.length === 0 || path.length > 4096 || /[\u0000-\u001f]/.test(path)) return undefined
  try {
    if (path.startsWith('file://')) path = fileURLToPath(path)
    else path = decodeURIComponent(path.split(/[?#]/u, 1)[0] ?? '')
  } catch {
    return undefined
  }
  return path
}

function sniffType(bytes: Buffer): string {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 6 && bytes.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  return 'application/octet-stream'
}

export interface AttachmentRead {
  data: string
  mimeType: string
}

/**
 * Read one file from the attachment store when `path` points at a known
 * attachment. Returns `undefined` for anything else, so the caller keeps the
 * original denial.
 */
export async function readKnownAttachment(rawPath: string): Promise<AttachmentRead | undefined> {
  const path = normalizePath(rawPath)
  if (path === undefined) return undefined
  const id = basename(path)
  if (!ATTACHMENT_ID.test(id) || !isKnownAttachment(id)) return undefined
  try {
    const root = await realpath(attachmentStoreRoot())
    const resolved = await realpath(path)
    if (!resolved.startsWith(root + sep)) return undefined
    const bytes = await readFile(resolved)
    if (bytes.length === 0) return undefined
    return { data: bytes.toString('base64'), mimeType: sniffType(bytes) }
  } catch {
    return undefined
  }
}
