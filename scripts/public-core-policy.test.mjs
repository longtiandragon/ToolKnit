import assert from 'node:assert/strict'
import { test } from 'vitest'
import { assertSafeExportTarget, findSensitiveContent, isPublicReleaseCandidate } from './public-core-policy.mjs'

test('detects personal home paths without embedding one in this source file', () => {
  const privatePath = ['C:', 'Users', 'alice', 'AppData', 'Local'].join('\\')
  assert.deepEqual(findSensitiveContent(privatePath), ['absolute user-home path'])
})

test('detects high-confidence key material', () => {
  const keyHeader = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')
  assert.deepEqual(findSensitiveContent(keyHeader), ['private key block'])
  assert.deepEqual(findSensitiveContent(`sk-${'a'.repeat(24)}`), ['OpenAI-style API key'])
})

test('allows generic fixtures and documented desktop scopes', () => {
  for (const value of ['C:\\demo', 'C:\\Notes', 'F:\\Vault', '$DOCUMENT/KnitspaceVault', '<USER_HOME>/Notes']) {
    assert.deepEqual(findSensitiveContent(value), [])
  }
  assert.equal(isPublicReleaseCandidate('.env.example'), true)
  assert.equal(isPublicReleaseCandidate('src/lib/example.test.ts'), true)
})

test('excludes private and generated material from a public release', () => {
  assert.equal(isPublicReleaseCandidate('.env'), false)
  assert.equal(isPublicReleaseCandidate('personal-pack/tools.json'), false)
  assert.equal(isPublicReleaseCandidate('design-qa-current.png'), false)
  assert.equal(isPublicReleaseCandidate('dist/assets/app.js'), false)
})

test('requires the export target to be absolute and outside the workspace', () => {
  const root = 'F:\\Workspace\\Knitspace'
  assert.throws(() => assertSafeExportTarget(root, 'public-export'))
  assert.throws(() => assertSafeExportTarget(root, `${root}\\release`))
  assert.equal(assertSafeExportTarget(root, 'F:\\KnitspacePublic'), 'F:\\KnitspacePublic')
})
