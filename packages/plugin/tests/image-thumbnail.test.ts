import { describe, expect, it } from 'vitest'
import {
  THUMBNAIL_MAX_EDGE,
  THUMBNAIL_MIN_BYTES,
  isThumbnailModeEnabled,
  setThumbnailModeEnabled,
} from '../src/thumbnail-mode.js'
import { clearThumbnailCache, shouldThumbnail, thumbnailAttachmentValue, thumbnailImage } from '../src/image-thumbnail.js'

/** Uncompressed 24-bit BMP: easy to build without an image dependency. */
function bigBmp(width: number, height: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixels = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * rowSize + x * 3
      pixels[offset] = (x * 7 + y * 13) % 256
      pixels[offset + 1] = (x * 31 + y * 3) % 256
      pixels[offset + 2] = (x * 11 + y * 17) % 256
    }
  }
  const header = Buffer.alloc(54)
  header.write('BM', 0, 'ascii')
  header.writeUInt32LE(54 + pixels.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(width, 18)
  header.writeInt32LE(height, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(pixels.length, 34)
  return Buffer.concat([header, pixels])
}

describe('forced thumbnail mode', () => {
  it('toggles the process flag and only claims images above the threshold', () => {
    expect(isThumbnailModeEnabled()).toBe(false)
    setThumbnailModeEnabled(true)
    expect(isThumbnailModeEnabled()).toBe(true)
    setThumbnailModeEnabled(false)
    expect(shouldThumbnail('image/jpeg', THUMBNAIL_MIN_BYTES)).toBe(false)
    expect(shouldThumbnail('image/png', THUMBNAIL_MIN_BYTES + 1)).toBe(true)
    expect(shouldThumbnail('application/pdf', THUMBNAIL_MIN_BYTES + 1)).toBe(false)
  })

  it('leaves small or non-image payloads untouched', async () => {
    clearThumbnailCache()
    await expect(thumbnailImage({ data: Buffer.from('tiny').toString('base64'), mediaType: 'image/png' })).resolves.toBeUndefined()
    await expect(thumbnailImage({ data: 'A'.repeat(400_000), mediaType: 'application/octet-stream' })).resolves.toBeUndefined()
  })

  it('downscales a large image and caches by attachment identity', async () => {
    clearThumbnailCache()
    const source = bigBmp(1600, 1200)
    const input = { data: source.toString('base64'), mediaType: 'image/bmp', identity: 'sha256:test' }
    const first = await thumbnailImage(input)
    if (first === undefined) {
      // No encoder on this platform (no sips / imagemagick / sharp): the call
      // must degrade to "forward the original", never to a broken payload.
      expect(process.platform).not.toBe('darwin')
      return
    }
    expect(first.mediaType).toBe('image/jpeg')
    expect(Buffer.from(first.data, 'base64').length).toBeLessThan(source.length)
    const cached = await thumbnailImage(input)
    expect(cached).toBe(first)
  })

  it('keeps the recorded attachment reference while shrinking the payload', async () => {
    clearThumbnailCache()
    const data = bigBmp(1600, 1200).toString('base64')
    const reference = { attachmentId: 'sha256:abc', mediaType: 'image/bmp', bytes: 1234, width: 1600, height: 1200 }
    const shaped = await thumbnailAttachmentValue({ attachment: reference, data })
    if (shaped === undefined) {
      expect(process.platform).not.toBe('darwin')
      return
    }
    expect(shaped.attachment).toEqual(reference)
    expect(shaped.data).not.toBe(data)
    expect(Buffer.from(shaped.data as string, 'base64').length).toBeLessThan(Buffer.from(data, 'base64').length)
  })

  it('ignores results that are not image attachments', async () => {
    await expect(thumbnailAttachmentValue({ data: 'AAAA' })).resolves.toBeUndefined()
    await expect(thumbnailAttachmentValue({ attachment: { mediaType: 'text/plain' }, data: 'AAAA' })).resolves.toBeUndefined()
  })

  it.skipIf(process.platform !== 'darwin')('caps the longest edge on macOS', async () => {
    clearThumbnailCache()
    const thumb = await thumbnailImage({ data: bigBmp(2400, 1200).toString('base64'), mediaType: 'image/bmp', identity: 'sha256:edge' })
    expect(thumb).toBeDefined()
    const { width, height } = jpegSize(Buffer.from(thumb!.data, 'base64'))
    expect(Math.max(width, height)).toBeLessThanOrEqual(THUMBNAIL_MAX_EDGE)
    expect(width / height).toBeCloseTo(2, 1)
  })
})

/** Reads image dimensions from a JPEG's SOF marker (only what the test needs). */
function jpegSize(buffer: Buffer): { width: number, height: number } {
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue }
    const marker = buffer[offset + 1]!
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + buffer.readUInt16BE(offset + 2)
  }
  throw new Error('no SOF marker')
}
