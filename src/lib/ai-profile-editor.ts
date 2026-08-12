import type { AiProfile } from '@/types'

export type AiProfileIdentity = Pick<AiProfile, 'label' | 'baseUrl' | 'model'>

function normalizedLabel(value: string) {
  return value.trim().toLocaleLowerCase()
}

export function normalizeAiProfileBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '').toLocaleLowerCase()
}

export function findReusableAiProfile(profiles: AiProfile[], draft: AiProfileIdentity) {
  const label = normalizedLabel(draft.label)
  const baseUrl = normalizeAiProfileBaseUrl(draft.baseUrl)
  const model = draft.model.trim().toLocaleLowerCase()
  return [...profiles].reverse().find((profile) => (
    normalizedLabel(profile.label) === label
    && normalizeAiProfileBaseUrl(profile.baseUrl) === baseUrl
    && profile.model.trim().toLocaleLowerCase() === model
  ))
}
