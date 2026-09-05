// Shared helper for custom tabBar overlay behavior.
// Mode 1 (hide): hide the custom tabBar entirely when modal/sheet is open.
// Mode 2 (lock): keep tabBar visible but pointer-events locked (new Global Dock contract).
// Does NOT touch selected routing logic.
function setTabBarHidden(page, hidden) {
  if (!page || typeof page.getTabBar !== 'function') return
  const bar = page.getTabBar()
  if (bar && typeof bar.setData === 'function') bar.setData({ hidden })
}

function setTabBarLocked(page, locked) {
  if (!page || typeof page.getTabBar !== 'function') return
  const bar = page.getTabBar()
  if (bar && typeof bar.setData === 'function') bar.setData({ locked })
}

function hideTabBar(page) { setTabBarHidden(page, true) }
function showTabBar(page) { setTabBarHidden(page, false) }
function lockTabBar(page) { setTabBarLocked(page, true) }
function unlockTabBar(page) { setTabBarLocked(page, false) }

module.exports = { hideTabBar, showTabBar, setTabBarHidden, lockTabBar, unlockTabBar, setTabBarLocked }
