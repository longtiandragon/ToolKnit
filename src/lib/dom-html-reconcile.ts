export interface HtmlChildReconcilePlan {
  prefix: number
  suffix: number
  fullReplace: boolean
}

/**
 * Keep the longest unchanged prefix and suffix of a rendered HTML tree.
 * Comparing the previous render signatures (instead of the live DOM) matters:
 * syntax highlighting, Mermaid and local-image hydration intentionally mutate
 * live nodes after mount and must not make an otherwise unchanged section look
 * dirty on the next editor keystroke.
 */
export function planHtmlChildReconciliation(previous: readonly string[], next: readonly string[], liveChildCount: number): HtmlChildReconcilePlan {
  if (liveChildCount !== previous.length) return { prefix: 0, suffix: 0, fullReplace: true }

  const sharedLength = Math.min(previous.length, next.length)
  let prefix = 0
  while (prefix < sharedLength && previous[prefix] === next[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < sharedLength - prefix
    && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) suffix += 1

  return { prefix, suffix, fullReplace: false }
}

function compactSignature(value: string) {
  let forward = 2166136261
  let backward = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    forward ^= value.charCodeAt(index)
    forward = Math.imul(forward, 16777619)
    backward ^= value.charCodeAt(value.length - index - 1)
    backward = Math.imul(backward, 16777619)
  }
  return `${value.length}:${forward >>> 0}:${backward >>> 0}`
}

function nodeSignature(node: ChildNode) {
  const value = node.nodeType === Node.ELEMENT_NODE ? (node as Element).outerHTML : (node.textContent ?? '')
  // Retain a fixed-size signature rather than another full multi-megabyte HTML
  // copy. Length plus two directional hashes keeps accidental reuse negligible.
  return `${node.nodeType}:${compactSignature(value)}`
}

export interface HtmlChildReconcileState {
  signatures: string[]
  reused: number
  replaced: number
}

/**
 * Reconcile only top-level preview nodes. The new HTML is parsed off-screen,
 * while unchanged live nodes remain attached, retaining selection/focus and
 * already completed lazy enhancements.
 */
export function reconcileRootHtml(root: HTMLElement, nextHtml: string, previousSignatures: readonly string[]): HtmlChildReconcileState {
  const template = document.createElement('template')
  template.innerHTML = nextHtml
  const nextNodes = [...template.content.childNodes]
  const nextSignatures = nextNodes.map(nodeSignature)
  const liveNodes = [...root.childNodes]
  const plan = planHtmlChildReconciliation(previousSignatures, nextSignatures, liveNodes.length)

  if (plan.fullReplace) {
    root.replaceChildren(...nextNodes)
    return { signatures: nextSignatures, reused: 0, replaced: nextNodes.length }
  }

  const changedOldEnd = liveNodes.length - plan.suffix
  for (let index = plan.prefix; index < changedOldEnd; index += 1) liveNodes[index].remove()

  const anchor = plan.suffix ? liveNodes[liveNodes.length - plan.suffix] : null
  const fragment = document.createDocumentFragment()
  const changedNewEnd = nextNodes.length - plan.suffix
  for (let index = plan.prefix; index < changedNewEnd; index += 1) fragment.append(nextNodes[index])
  root.insertBefore(fragment, anchor)

  return {
    signatures: nextSignatures,
    reused: plan.prefix + plan.suffix,
    replaced: changedNewEnd - plan.prefix,
  }
}
