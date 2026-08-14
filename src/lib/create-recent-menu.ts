/**
 * The recent-work context menu on /create has to be positioned before it is
 * rendered — `clampMenuPosition` needs a height to keep the panel inside the
 * window — so the height is computed from the number of actions rather than
 * measured.
 */
export function recentCreateMenuHeight(kind: 'note' | 'visual') {
  const actionCount = kind === 'note' ? 6 : 2
  return 57 + actionCount * 55
}
