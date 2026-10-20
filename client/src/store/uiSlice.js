import { createSlice } from '@reduxjs/toolkit'

export const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'contrast', label: 'High contrast' },
]

const THEME_KEY = 'flowsync_theme'
const FONT_KEY = 'flowsync_font'

function read(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

let toastId = 0

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    theme: read(THEME_KEY, 'system'), // 'system' follows the OS light/dark setting
    fontSize: Number(read(FONT_KEY, '14')),
    sidebarOpen: true,
    panelOpen: false,
    toasts: [],
  },
  reducers: {
    setTheme(state, action) {
      state.theme = action.payload
      localStorage.setItem(THEME_KEY, action.payload)
    },
    setFontSize(state, action) {
      state.fontSize = action.payload
      localStorage.setItem(FONT_KEY, String(action.payload))
    },
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen
    },
    togglePanel(state) {
      state.panelOpen = !state.panelOpen
    },
    pushToast: {
      reducer(state, action) {
        state.toasts.push(action.payload)
      },
      prepare(message, type = 'info') {
        return { payload: { id: ++toastId, message, type } }
      },
    },
    dismissToast(state, action) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload)
    },
  },
})

export const { setTheme, setFontSize, toggleSidebar, togglePanel, pushToast, dismissToast } =
  uiSlice.actions
export default uiSlice.reducer
