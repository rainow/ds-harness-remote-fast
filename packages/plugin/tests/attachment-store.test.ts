import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isKnownAttachment, readKnownAttachment, rememberAttachmentRefs } from '../src/attachment-store.js'

const randomHex = () => Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  delete process.env.DSH_HOME
})

async function storeFile(): Promise<{ home: string, id: string, path: string }> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-attach-'))
  directories.push(home)
  process.env.DSH_HOME = home
  const id = randomHex()
  const directory = join(home, 'attachments', 'v1', 'objects', 'aa')
  await mkdir(directory, { recursive: true })
  const path = join(directory, id)
  await writeFile(path, PNG)
  return { home, id, path }
}

describe('attachment store fallback', () => {
  it('only remembers ids that were actually sent to a client', async () => {
    const { id } = await storeFile()
    expect(isKnownAttachment(id)).toBe(false)
    rememberAttachmentRefs(`{"type":"image","attachment":{"attachmentId":"sha256:${id}"}}`)
    expect(isKnownAttachment(id)).toBe(true)
  })

  it('serves a known attachment with a sniffed media type', async () => {
    const { id, path } = await storeFile()
    rememberAttachmentRefs(`{"attachmentId":"sha256:${id}"}`)
    const read = await readKnownAttachment(path)
    expect(read?.mimeType).toBe('image/png')
    expect(Buffer.from(read!.data, 'base64')).toEqual(PNG)
  })

  it('keeps refusing unknown ids, non-store paths and traversal', async () => {
    const { id, path, home } = await storeFile()
    expect(await readKnownAttachment(path)).toBeUndefined()
    rememberAttachmentRefs(`{"attachmentId":"sha256:${id}"}`)
    expect(await readKnownAttachment('/etc/hosts')).toBeUndefined()
    expect(await readKnownAttachment(join(home, 'attachments', 'v1', 'objects', 'aa', '..', 'aa', id))).toBeDefined()
    expect(await readKnownAttachment('file:///etc/passwd')).toBeUndefined()
  })
})
