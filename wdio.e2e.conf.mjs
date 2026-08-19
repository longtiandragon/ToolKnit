import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const binaryName = process.platform === 'win32' ? 'knitspace.exe' : 'knitspace'
const appBinaryPath = resolve(root, 'src-tauri', 'target', 'debug', binaryName)
const e2eLogLevel = process.env.CI ? 'warn' : 'info'

export const config = {
  runner: 'local',
  specs: ['./e2e/**/*.e2e.mjs'],
  maxInstances: 1,
  services: [[
    '@wdio/tauri-service',
    {
      appBinaryPath,
      driverProvider: 'embedded',
      embeddedPort: Number(process.env.KNITSPACE_E2E_PORT || 4445),
      startTimeout: 90_000,
      commandTimeout: 45_000,
      logLevel: e2eLogLevel,
      captureBackendLogs: true,
      captureFrontendLogs: true,
      backendLogLevel: 'warn',
      frontendLogLevel: 'warn',
    },
  ]],
  capabilities: [{
    browserName: 'tauri',
    'tauri:options': { application: appBinaryPath },
  }],
  logLevel: e2eLogLevel,
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 120_000,
  },
  reporters: ['spec'],
}
