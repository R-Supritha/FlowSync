import { createSlice } from '@reduxjs/toolkit'

export const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'contrast', label: 'High contrast' },
]

export const PANEL_TABS = [
  { id: 'activity', label: 'Activity' },
  { id: 'github', label: 'GitHub' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'contributions', label: 'Contributions' },
]

const THEME_KEY = 'flowsync_theme'
const FONT_KEY = 'flowsync_font'
const NEXT_KEY = 'flowsync_notifications'

function read(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function readBool(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === 'true'
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
    panelTab: 'activity',
    searchOpen: false,
    notificationPrefs: readBool(NEXT_KEY, true),
    toasts: [],
    // Open editor-style tabs: { path, label, kind }
    tabs: [],
    // The task shown in the right-side drawer (null when closed).
    openTaskId: null,
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
    setNotificationPrefs(state, action) {
      state.notificationPrefs = action.payload
      localStorage.setItem(NEXT_KEY, String(action.payload))
    },
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen
    },
    setSidebar(state, action) {
      state.sidebarOpen = action.payload
    },
    togglePanel(state, action) {
      state.panelOpen = action.payload === undefined ? !state.panelOpen : action.payload
    },
    setPanelTab(state, action) {
      state.panelTab = action.payload
      state.panelOpen = true
    },
    setSearchOpen(state, action) {
      state.searchOpen = action.payload
    },
    openTab(state, action) {
      const { path, label, kind = 'page' } = action.payload
      const existing = state.tabs.find((t) => t.path === path)
      if (existing) {
        existing.label = label
        existing.kind = kind
      } else {
        state.tabs.push({ path, label, kind })
      }
    },
    closeTab(state, action) {
      state.tabs = state.tabs.filter((t) => t.path !== action.payload)
    },
    resetTabs(state) {
      state.tabs = []
    },
    openTask(state, action) {
      state.openTaskId = action.payload
    },
    closeTask(state) {
      state.openTaskId = null
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

export const {
  setTheme,
  setFontSize,
  setNotificationPrefs,
  toggleSidebar,
  setSidebar,
  togglePanel,
  setPanelTab,
  setSearchOpen,
  openTab,
  closeTab,
  resetTabs,
  openTask,
  closeTask,
  pushToast,
  dismissToast,
} = uiSlice.actions
export default uiSlice.reducer
