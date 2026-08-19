import type { RasterProcessOptions } from '@/lib/image-processing'

type ImageWorkerResponse = { blob?: Blob; error?: string }

/** Runs one raster operation on the shared image worker and tears it down
 * afterwards. Callers that need progress or an abort signal should keep their
 * own longer-lived worker instead. */
export function processRasterInWorker(file: File | Blob, options: RasterProcessOptions) {
  return new Promise<Blob>((resolve, reject) => {
    if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
      reject(new Error('当前环境不支持后台图片处理，请使用 Knitspace 桌面版。'))
      return
    }
    const worker = new Worker(new URL('../workers/image-process.worker.ts', import.meta.url), { type: 'module' })
    worker.onerror = () => { worker.terminate(); reject(new Error('后台图片处理器启动失败。')) }
    worker.onmessage = ({ data }: MessageEvent<ImageWorkerResponse>) => {
      worker.terminate()
      if (data.error) reject(new Error(data.error))
      else if (data.blob) resolve(data.blob)
      else reject(new Error('后台图片处理没有返回结果。'))
    }
    worker.postMessage({ file, options })
  })
}
