// A profile picture is either a link to another website, or a file kept by our own server ("/avatars/...").
// The second kind is shown from the API's address, which is the API URL without its "/api" ending.
export function avatarSrc(url) {
  if (!url) return undefined
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('/')) {
    const api = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
    return `${api.replace(/\/api\/?$/, '')}${url}`
  }
  return undefined
}
