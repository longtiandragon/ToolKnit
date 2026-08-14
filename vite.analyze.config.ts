/*
 * The ordinary build reports chunk sizes and nothing about their contents,
 * which is how 670 kB of Mermaid's shared parser came to be reported under the
 * name of one obscure diagram type. This config wraps the real one and writes
 * `chunk-analysis.json`: every chunk, its size, whether it is a dynamic entry,
 * and the modules inside it sorted by rendered bytes.
 *
 *   npx vite build --config vite.analyze.config.ts
 *
 * The report is a build artefact, not source — it is git-ignored.
 */
import { writeFileSync } from 'node:fs'
import type { Plugin, UserConfig } from 'vite'
import baseConfig from './vite.config'

type ConfigFactory = (env: { mode: string; command: string }) => Promise<UserConfig> | UserConfig

export default async (env: { mode: string; command: string }) => {
  const resolved = await (baseConfig as unknown as ConfigFactory)(env)
  const report: Plugin = {
    name: 'knitspace-chunk-analysis',
    generateBundle(_options, bundle) {
      const chunks: Record<string, unknown> = {}
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue
        chunks[fileName] = {
          size: output.code.length,
          isEntry: output.isEntry,
          isDynamicEntry: output.isDynamicEntry,
          imports: output.imports,
          dynamicImports: output.dynamicImports,
          modules: Object.entries(output.modules)
            .map(([id, info]) => ({ id, rendered: info.renderedLength }))
            .sort((a, b) => b.rendered - a.rendered),
        }
      }
      writeFileSync('chunk-analysis.json', JSON.stringify(chunks, null, 2))
    },
  }
  resolved.plugins = [...(resolved.plugins ?? []), report]
  return resolved
}
