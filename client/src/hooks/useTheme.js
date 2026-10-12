import { useEffect } from 'react'
import { useSelector } from 'react-redux'

// Writes the chosen theme and font size onto <html>. "system" follows the OS.
export default function useTheme() {
  const theme = useSelector((s) => s.ui.theme)
  const fontSize = useSelector((s) => s.ui.fontSize)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      document.documentElement.setAttribute('data-theme', resolved)
    }
    apply()
    if (theme !== 'system') return undefined
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--font-size', `${fontSize}px`)
  }, [fontSize])
}
