// Minimal, extensible i18n layer (FR22).
// The app currently ships English only. To add a language:
//   1. Add its id to LANGUAGES (only when real translations exist),
//   2. Add a dictionary of keys under `dictionaries`,
//   3. Users pick it in Settings -> Language; `useT()` resolves keys for everyone.
// A language must never appear in LANGUAGES before its dictionary exists.

import { useSelector } from 'react-redux'

export const DEFAULT_LANGUAGE = 'en'

// Keep in sync with GET /api/settings -> languages (server validates the value).
export const LANGUAGES = [{ id: 'en', label: 'English' }]

const dictionaries = {
  // English is the source language: missing keys fall back to the key itself,
  // which is already the English copy used throughout the UI.
  en: {},
}

export function translate(key, lang = DEFAULT_LANGUAGE) {
  const dict = dictionaries[lang] || dictionaries[DEFAULT_LANGUAGE]
  return dict[key] ?? dictionaries[DEFAULT_LANGUAGE][key] ?? key
}

export function useLanguage() {
  return useSelector((s) => s.ui.language) || DEFAULT_LANGUAGE
}

export function useT() {
  const lang = useLanguage()
  return (key) => translate(key, lang)
}
