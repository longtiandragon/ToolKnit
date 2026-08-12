import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const dropZone = readFileSync(new URL('src/components/FileDropZone.vue', root), 'utf8')
const library = readFileSync(new URL('src/views/LibraryView.vue', root), 'utf8')

describe('desktop file intake contract', () => {
  it('routes desktop library imports by path without constructing WebView file buffers', () => {
    expect(library).toContain(':desktop-path-only="desktop"')
    expect(library).toContain('@desktop-paths="importDesktopPaths"')
    expect(library).toContain('@request-desktop-choose="chooseImport"')

    const pathOnlyBranch = dropZone.indexOf("if(props.desktopPathOnly){emit('desktop-paths'")
    const byteReadLoop = dropZone.indexOf('loaded.push(await readDesktopInputFile(path))')
    expect(pathOnlyBranch).toBeGreaterThan(-1)
    expect(byteReadLoop).toBeGreaterThan(pathOnlyBranch)
  })

  it('keeps aggregate memory budgets available for byte-processing tools', () => {
    expect(dropZone).toContain('maxTotalBytes?:number')
    expect(dropZone).toContain('filesWithinDropBudget')
    expect(dropZone).toContain(':aria-busy="loading"')
  })
})
