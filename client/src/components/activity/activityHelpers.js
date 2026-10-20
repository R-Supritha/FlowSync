import { relativeTime } from '../../utils/format'

// Pure helpers for rendering activity entries. Message text is produced server-side,
// so these are just presentation bits.
export const formatting = {
  message: (a) => a.message || '',
  time: relativeTime,
}