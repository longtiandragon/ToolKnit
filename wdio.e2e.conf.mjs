import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const binaryName = process.platform === 'win32' ? 'knitspace.exe' : 'knitspace'
const appBinaryPath = resolve(root, 'src-tauri', 'target', 'debug', binaryName)
const e2eLogLevel = process.env.CI ? 'warn' : 'info'
const crashManifestPath = join(tmpdir(), 'knitspace-e2e-crash-recovery-state.json')

async function terminatePreparedCrash(specs) {
  const crashSpec = specs.some((spec) => spec.replaceAll('\\', '/').endsWith('/e2e/organizer-crash-prepare.e2e.mjs'))
  if (!crashSpec) return
  const manifest = JSON.parse(await readFile(crashManifestPath, 'utf8'))
  const processId = manifest.processId
  if (!manifest.armed || !Number.isSafeInteger(processId) || processId <= 0 || processId === process.pid) {
    throw new Error('Crash preparation did not provide a safe Tauri process id.')
  }
  // This PID was returned by the live E2E-only IPC call in the worker that has
  // just exited. Kill it only after WebDriver has deleted its session cleanly.
  process.kill(processId, 0)
  process.kill(processId, 'SIGKILL')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      process.kill(processId, 0)
    } catch (error) {
      if (error?.code === 'ESRCH') return
      throw error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error('The isolated Tauri E2E process did not terminate.')
}

export const config = {
  runner: 'local',
  // Keep crash preparation and recovery in separate workers. With one instance,
  // the embedded launcher observes the terminated process and starts a fresh
  // app before the recovery spec.
  specs: [
    './e2e/automation-center.e2e.mjs',
    './e2e/organizer-execution.e2e.mjs',
    './e2e/organizer-windows-matrix.e2e.mjs',
    './e2e/organizer-crash-prepare.e2e.mjs',
    './e2e/organizer-crash-recovery.e2e.mjs',
  ],
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
  onWorkerEnd: async (_cid, exitCode, specs) => {
    if (exitCode === 0) await terminatePreparedCrash(specs)
  },
  reporters: ['spec'],
}
