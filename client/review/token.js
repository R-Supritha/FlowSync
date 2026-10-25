const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '')
export const ids = {
  me: '6aacc821d3b767f4564a7299', other: '6aaccafd6fe1dd586a3a8640', ws: '6aacc8d0d3b767f4564a729a',
  project: '6ac87d8ee1de3a64a30140a4', t1: '6ac87dc3e1de3a64a30140ad', t2: '6ac87dc3e1de3a64a30140ae', t3: '6ac87dc3e1de3a64a30140af',
}
export const token = `${b64({ alg: 'HS256' })}.${b64({ id: ids.me, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
