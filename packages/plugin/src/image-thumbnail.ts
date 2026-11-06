import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { THUMBNAIL_MAX_EDGE, THUMBNAIL_MIN_BYTES, THUMBNAIL_QUALITY } from './thumbnail-mode.js'

const run = promisify(execFile)

/** How many thumbnails may be generated at once; a chat screen can mount many images. */
const MAX_CONCURRENT = 2
/** Cache entries; images are content-addressed so repeat reads are common. */
const CACHE_LIMIT = 32
/** A thumbnail has to be meaningfully smaller to replace the original. */
const MIN_SAVING = 0.1

interface Thumbnail {
  data: string
  mediaType: string
}

const cache = new Map<string, Thumbnail>()
let running = 0
const waiting: Array<() => void> = []

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
}

function isImageType(mediaType: string): boolean {
  return mediaType.startsWith('image/')
}

/** Whether this attachment is worth re-encoding at all. */
export function shouldThumbnail(mediaType: string, bytes: number): boolean {
  return isImageType(mediaType) && bytes > THUMBNAIL_MIN_BYTES
}

function cacheKey(identity: string | undefined, buffer: Buffer): string {
  return identity !== undefined && identity.length > 0
    ? `id:${identity}`
    : `sha:${createHash('sha256').update(buffer).digest('hex')}`
}

function remember(key: string, value: Thumbnail): void {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1
    return
  }
  await new Promise<void>(resolve => waiting.push(resolve))
  running += 1
}

function release(): void {
  running -= 1
  const next = waiting.shift()
  if (next !== undefined) next()
}

/** Optional dependency; resolved at runtime so the bundle works without it. */
async function loadOptional(name: string): Promise<unknown> {
  try {
    return await import(name)
  } catch {
    return undefined
  }
}

async function encodeWithSharp(buffer: Buffer): Promise<Thumbnail | undefined> {
  try {
    const module = await loadOptional('sharp') as {
      default?: (input: Buffer) => {
        resize(options: { width: number, height: number, fit: string, withoutEnlargement: boolean }): {
          jpeg(options: { quality: number }): { toBuffer(): Promise<Buffer> }
        }
      }
    }
    const sharp = module.default
    if (typeof sharp !== 'function') return undefined
    const output = await sharp(buffer)
      .resize({ width: THUMBNAIL_MAX_EDGE, height: THUMBNAIL_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: THUMBNAIL_QUALITY })
      .toBuffer()
    return { data: output.toString('base64'), mediaType: 'image/jpeg' }
  } catch {
    return undefined
  }
}

async function encodeWithCli(buffer: Buffer, mediaType: string, command: string, args: (input: string, output: string) => string[]): Promise<Thumbnail | undefined> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-thumb-'))
  try {
    const input = join(directory, `in.${EXTENSIONS[mediaType] ?? 'img'}`)
    const output = join(directory, 'out.jpg')
    await writeFile(input, buffer)
    await run(command, args(input, output), { timeout: 15_000 })
    const output2 = await readFile(output)
    return output2.length === 0 ? undefined : { data: output2.toString('base64'), mediaType: 'image/jpeg' }
  } catch {
    return undefined
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function encodeWithSips(buffer: Buffer, mediaType: string): Promise<Thumbnail | undefined> {
  return encodeWithCli(buffer, mediaType, 'sips', (input, output) => [
    '-Z', String(THUMBNAIL_MAX_EDGE),
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', String(THUMBNAIL_QUALITY),
    input, '--out', output,
  ])
}

async function encodeWithImageMagick(buffer: Buffer, mediaType: string, command: string): Promise<Thumbnail | undefined> {
  return encodeWithCli(buffer, mediaType, command, (input, output) => [
    input,
    '-resize', `${THUMBNAIL_MAX_EDGE}x${THUMBNAIL_MAX_EDGE}>`,
    '-quality', String(THUMBNAIL_QUALITY),
    output,
  ])
}

/** Pure-JS fallback: PNG only, nearest-neighbour downscale, still a PNG. */
async function encodeWithPngjs(buffer: Buffer): Promise<Thumbnail | undefined> {
  try {
    const module = await loadOptional('pngjs') as { PNG: { sync: { read(input: Buffer): { width: number, height: number, data: Buffer }, write(input: { width: number, height: number, data: Buffer }): Buffer } } } | undefined
    if (module === undefined) return undefined
    const PNG = module.PNG
    const source = PNG.sync.read(buffer)
    const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(source.width, source.height))
    if (scale >= 1) return undefined
    const width = Math.max(1, Math.round(source.width * scale))
    const height = Math.max(1, Math.round(source.height * scale))
    const output = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(source.height - 1, Math.floor(y / scale))
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(source.width - 1, Math.floor(x / scale))
        const from = (sourceY * source.width + sourceX) * 4
        const to = (y * width + x) * 4
        output[to] = source.data[from]!
        output[to + 1] = source.data[from + 1]!
        output[to + 2] = source.data[from + 2]!
        output[to + 3] = source.data[from + 3]!
      }
    }
    return { data: PNG.sync.write({ width, height, data: output }).toString('base64'), mediaType: 'image/png' }
  } catch {
    return undefined
  }
}

async function encode(buffer: Buffer, mediaType: string): Promise<Thumbnail | undefined> {
  return await encodeWithSharp(buffer)
    ?? (process.platform === 'darwin' ? await encodeWithSips(buffer, mediaType) : undefined)
    ?? (process.platform === 'linux' ? await encodeWithImageMagick(buffer, mediaType, 'convert') : undefined)
    ?? (process.platform === 'linux' ? await encodeWithImageMagick(buffer, mediaType, 'magick') : undefined)
    ?? (mediaType === 'image/png' ? await encodeWithPngjs(buffer) : undefined)
}

export interface ThumbnailInput {
  /** Canonical base64 of the stored attachment. */
  data: string
  mediaType: string
  /** Content-addressed attachment id, used as the cache key. */
  identity?: string
}

/**
 * Downscale one image attachment. Returns `undefined` when the attachment should
 * be forwarded untouched (not an image, small enough, no encoder, or no saving).
 */
export async function thumbnailImage(input: ThumbnailInput): Promise<Thumbnail | undefined> {
  if (!shouldThumbnail(input.mediaType, Buffer.byteLength(input.data, 'base64'))) return undefined
  const buffer = Buffer.from(input.data, 'base64')
  const key = cacheKey(input.identity, buffer)
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  await acquire()
  try {
    const once = await encode(buffer, input.mediaType)
    if (once === undefined) return undefined
    if (once.data.length > buffer.length * (1 - MIN_SAVING)) return undefined
    remember(key, once)
    return once
  } finally {
    release()
  }
}

/**
 * Rewrite a `session/attachment` result value so its `data` is a thumbnail.
 * The recorded reference (`attachment`) is echoed unchanged: clients compare
 * `bytes` / `width` / `height` against the history record and reject a mismatch,
 * so only the payload may shrink.
 */
export async function thumbnailAttachmentValue(value: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  const attachment = value.attachment
  if (attachment === null || typeof attachment !== 'object' || Array.isArray(attachment)) return undefined
  const reference = attachment as Record<string, unknown>
  const mediaType = typeof reference.mediaType === 'string' ? reference.mediaType : undefined
  const data = typeof value.data === 'string' ? value.data : undefined
  if (mediaType === undefined || data === undefined) return undefined
  const thumbnail = await thumbnailImage({
    data,
    mediaType,
    identity: typeof reference.attachmentId === 'string' ? reference.attachmentId : undefined,
  })
  return thumbnail === undefined ? undefined : { ...value, data: thumbnail.data }
}

/** Test seam: drop cached thumbnails. */
export function clearThumbnailCache(): void {
  cache.clear()
}
