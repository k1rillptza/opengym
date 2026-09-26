export const telegramWebApp = () => window.Telegram?.WebApp || null
export const telegramInitData = () => telegramWebApp()?.initData || ''
export const isTelegramMiniApp = () => !!telegramInitData()

export function initTelegram() {
  const app = telegramWebApp()
  if (!app) return
  app.ready()
  app.expand()
  app.enableClosingConfirmation?.()

  const applyInsets = () => {
    const safe = app.safeAreaInset || {}
    const content = app.contentSafeAreaInset || {}
    const root = document.documentElement
    root.style.setProperty('--tg-safe-top', `${Math.max(safe.top || 0, content.top || 0)}px`)
    root.style.setProperty('--tg-safe-bottom', `${Math.max(safe.bottom || 0, content.bottom || 0)}px`)
  }
  applyInsets()
  app.onEvent?.('safeAreaChanged', applyInsets)
  app.onEvent?.('contentSafeAreaChanged', applyInsets)
}

