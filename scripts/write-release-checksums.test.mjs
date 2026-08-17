import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeReleaseChecksums } from './write-release-checksums.mjs'

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('release checksum writer', () => {
  it('writes deterministic sha256sum-compatible lines with basenames only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'knitspace-release-checksum-'))
    temporaryRoots.push(root)
    const installer = join(root, 'Knitspace_1.2.3_x64-setup.exe')
    const output = join(root, 'SHA256SUMS.txt')
    writeFileSync(installer, 'installer fixture')

    await writeReleaseChecksums({ files: [installer], output })

    const expectedHash = createHash('sha256').update('installer fixture').digest('hex')
    const manifest = readFileSync(output, 'utf8')
    expect(manifest).toBe(`${expectedHash}  Knitspace_1.2.3_x64-setup.exe\n`)
    expect(manifest).not.toContain(root)
  })

  it('rejects missing artifacts and duplicate basenames', async () => {
    const root = mkdtempSync(join(tmpdir(), 'knitspace-release-checksum-'))
    temporaryRoots.push(root)
    const first = join(root, 'first.exe')
    writeFileSync(first, 'one')
    await expect(writeReleaseChecksums({ files: [join(root, 'missing.exe')], output: join(root, 'out.txt') })).rejects.toThrow(/not a file/)
    await expect(writeReleaseChecksums({ files: [first, first], output: join(root, 'out.txt') })).rejects.toThrow(/Duplicate/)
  })
})
