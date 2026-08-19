import { describe, expect, it } from 'vitest'
import { portableProcessingJob } from './job-privacy'

describe('processing history privacy', () => {
  it('removes every absolute path without mutating the live job', () => {
    const live = {
      id: 'job', kind: 'archive' as const, label: '交付', status: 'succeeded' as const, progress: 100,
      inputs: [{ name: 'input.pdf', path: 'C:\\private\\input.pdf', size: 12 }],
      outputs: [{ name: 'output.zip', path: 'D:\\private\\output.zip', size: 24 }],
      inputNames: ['input.pdf'],
      parameters: { outputDirectory: 'D:\\private', quality: 90, stepConfigs: ['{"toolId":"image.compress"}'] },
      detail: '无法读取：C:\\private\\input.pdf',
      createdAt: '2026-08-19T00:00:00Z',
    }
    const portable = portableProcessingJob(live)
    expect(portable.inputs?.[0]).toMatchObject({ name: 'input.pdf', size: 12 })
    expect(portable.outputs?.[0]).toMatchObject({ name: 'output.zip', size: 24 })
    expect(portable.inputs?.[0].path).toBeUndefined()
    expect(portable.inputNames).toEqual(['input.pdf'])
    expect(portable.parameters).toEqual({ quality: 90, stepConfigs: ['{"toolId":"image.compress"}'] })
    expect(portable.detail).toBe('任务详情已省略（包含本机路径）。')
    expect(JSON.stringify(portable)).not.toMatch(/[CD]:\\private/)
    expect(live.outputs[0].path).toBe('D:\\private\\output.zip')
  })
})
