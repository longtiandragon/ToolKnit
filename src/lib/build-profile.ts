/**
 * Compile-time product boundary. Vite replaces this constant before Rollup,
 * allowing personal-only routes and imports to disappear from Public Core.
 */
export const personalPackEnabled = __PERSONAL_PACK__

export type BuildProfileId = 'personal' | 'public'

export interface BuildProfileIdentity {
  id: BuildProfileId
  badge: 'DEV' | 'CORE'
  label: string
  title: string
  summary: string
  capability: string
  primaryAction: string
}

export function resolveBuildProfile(personalPack: boolean): BuildProfileIdentity {
  return personalPack
    ? {
        id: 'personal',
        badge: 'DEV',
        label: '个人开发版',
        title: 'Knitspace Personal',
        summary: '包含本地调试、私人工具清单与脚本执行器，适合你的日常开发工作区。',
        capability: 'Personal Pack 已编译',
        primaryAction: '打开私人工具包',
      }
    : {
        id: 'public',
        badge: 'CORE',
        label: '公开核心版',
        title: 'Knitspace Core',
        summary: '面向 GitHub 发布，Personal Pack 的页面、命令桥接与 Rust 执行器均未进入构建。',
        capability: 'Personal Pack 未编译',
        primaryAction: '浏览核心工具',
      }
}

export const buildProfile = resolveBuildProfile(personalPackEnabled)

export function buildProfileDiagnostic(identity: BuildProfileIdentity, version: string, desktop: boolean) {
  return [
    `${identity.title} v${version}`,
    `构建配置：${identity.id} (${identity.badge})`,
    `运行环境：${desktop ? 'Windows 桌面端' : '浏览器预览'}`,
    identity.capability,
  ].join('\n')
}
