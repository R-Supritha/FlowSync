import axios from 'axios'

export const TOKEN_KEY = 'flowsync_token'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
})

let onUnauthorized = () => {}
// The store registers its logout here, which avoids a circular import.
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    const url = error.config?.url || ''
    // Wrong credentials also return 401, so login/register must not trigger a sign-out.
    if (status === 401 && !url.startsWith('/auth/')) onUnauthorized()
    return Promise.reject(error)
  },
)

export function errorMessage(error, fallback = 'Something went wrong') {
  if (!error) return fallback
  // A 429 from our own endpoints says exactly what to wait for; the general limiter sends no message.
  if (error.response?.status === 429 && !error.response?.data?.message) {
    return 'Too many requests. Please wait a few minutes and try again.'
  }
  if (error.response?.data?.message) return error.response.data.message
  if (error.request && !error.response) return 'Cannot reach the server. Check your connection.'
  return error.message || fallback
}

export default api
