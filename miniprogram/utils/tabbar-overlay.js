// Shared helper for custom tabBar overlay behavior.
// When a modal/bottom sheet is open, hide the custom tabBar entirely.
// When closed, restore it. Does NOT touch selected routing logic.
function setTabBarHidden(page, hidden) {
  if (!page || typeof page.getTabBar !== 'function') return
  const bar = page.getTabBar()
  if (bar && typeof bar.setData === 'function') bar.setData({ hidden })
}

function hideTabBar(page) { setTabBarHidden(page, true) }
function showTabBar(page) { setTabBarHidden(page, false) }

module.exports = { hideTabBar, showTabBar, setTabBarHidden }
