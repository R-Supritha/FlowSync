import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../api/client'

// Loads data when the inputs change. Returns { data, error, loading, reload }.
// `fn` runs inside an effect, and state is only set from the promise callbacks.
export default function useAsync(fn, inputs = []) {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState({ key: null, data: null, error: null })
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })

  const key = JSON.stringify([version, ...inputs])
  useEffect(() => {
    let alive = true
    Promise.resolve()
      .then(() => fnRef.current())
      .then((data) => alive && setResult({ key, data, error: null }))
      .catch((e) => alive && setResult({ key, data: null, error: errorMessage(e) }))
    return () => {
      alive = false
    }
  }, [key])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  const settled = result.key === key
  return {
    data: result.data,
    error: settled ? result.error : null,
    loading: !settled,
    reload,
  }
}
