#!/usr/bin/env node
// Guards `npm publish`: the tarball must ship the esbuild bundles, never the
// raw `tsc` output. `tsc -p tsconfig.json` writes dist/client.js as an ESM
// module (starts with `import`), and if that runs after build-bundles the
// client entry silently stops being importable in the browser.
//
// Wired to `prepack`, so `npm pack` / `npm publish` fail loudly instead of
// shipping a broken package (this happened for 0.6.5-fast.2).
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIN_BUNDLE_BYTES = 300_000

const failures = []

async function check(file, { minBytes, forbidHead }) {
  const path = join(root, 'dist', file)
  let size
  try {
    size = (await stat(path)).size
  } catch {
    failures.push(`${file}: missing (run the build first)`)
    return
  }
  if (size < minBytes) failures.push(`${file}: ${size} bytes < ${minBytes} — looks like raw tsc output`)
  if (forbidHead) {
    const head = (await readFile(path, 'utf8')).slice(0, 200)
    if (forbidHead.test(head)) failures.push(`${file}: starts with ${JSON.stringify(head.slice(0, 40))} — tsc output, not the bundle`)
  }
}

await check('index.js', { minBytes: 1_000_000 })
await check('client.js', { minBytes: MIN_BUNDLE_BYTES, forbidHead: /^\s*(import\s|export\s)/ })
await check('client.github.js', { minBytes: MIN_BUNDLE_BYTES, forbidHead: /^\s*(import\s|export\s)/ })

if (failures.length > 0) {
  console.error('Refusing to pack: committed bundles are not esbuild output')
  for (const line of failures) console.error(`  - ${line}`)
  process.exit(1)
}

console.log('Bundle check ok: dist/index.js + client bundles are esbuild output')
