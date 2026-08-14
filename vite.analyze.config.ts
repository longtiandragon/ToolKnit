import { writeFileSync } from 'node:fs'
import baseConfig from './vite.config'

export default async (env: any) => {
  const resolved: any = await (baseConfig as any)(env)
  resolved.plugins = [
    ...resolved.plugins,
    {
      name: 'knitspace-chunk-analysis',
      generateBundle(_options: any, bundle: any) {
        const report: Record<string, unknown> = {}
        for (const [fileName, output] of Object.entries<any>(bundle)) {
          if (output.type !== 'chunk') continue
          report[fileName] = {
            size: output.code.length,
            isEntry: output.isEntry,
            isDynamicEntry: output.isDynamicEntry,
            imports: output.imports,
            dynamicImports: output.dynamicImports,
            modules: Object.entries<any>(output.modules)
              .map(([id, info]) => ({ id, rendered: info.renderedLength }))
              .sort((a, b) => b.rendered - a.rendered),
          }
        }
        writeFileSync('chunk-analysis.json', JSON.stringify(report, null, 2))
      },
    },
  ]
  return resolved
}
