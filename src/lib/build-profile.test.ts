import { describe, expect, it } from 'vitest'
import { buildProfileDiagnostic, resolveBuildProfile } from './build-profile'

describe('build profile identity', () => {
  it('describes the personal development build without calling it a web preview', () => {
    const profile = resolveBuildProfile(true)
    expect(profile).toMatchObject({ id: 'personal', badge: 'DEV', label: '个人开发版' })
    expect(profile.capability).toContain('已编译')
    expect(buildProfileDiagnostic(profile, '0.1.0', true)).toContain('运行环境：Windows 桌面端')
  })

  it('makes the public compile-time boundary explicit', () => {
    const profile = resolveBuildProfile(false)
    expect(profile).toMatchObject({ id: 'public', badge: 'CORE', label: '公开核心版' })
    expect(profile.summary).toContain('Rust 执行器')
    expect(buildProfileDiagnostic(profile, '0.1.0', false)).toContain('Personal Pack 未编译')
  })
})
