import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from '@/lib/native'

export type FetchedWebPage = {
  url: string
  html: string
  contentType: string
  bytes: number
}

export type LocalizedArticleImage = {
  originalUrl: string
  source: string
  filename: string
  size: number
}

export type ArticleImageFailure = {
  originalUrl: string
  error: string
}

export type LocalizeArticleImagesReport = {
  localized: LocalizedArticleImage[]
  failures: ArticleImageFailure[]
}

export function canFetchWebPages() {
  return isDesktop()
}

export async function fetchDesktopWebPage(url: string) {
  if (!isDesktop()) throw new Error('受限网页抓取仅在 Knitspace 桌面版可用。')
  return invoke<FetchedWebPage>('fetch_web_page', { request: { url } })
}

export async function localizeDesktopWebArticleImages(documentId: string, urls: string[]) {
  if (!isDesktop()) throw new Error('网页图片本地化仅在 Knitspace 桌面版可用。')
  return invoke<LocalizeArticleImagesReport>('localize_web_article_images', {
    request: { documentId, images: urls.map(url => ({ url })) },
  })
}
