import { useDispatch } from 'react-redux'
import { fileApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { pushToast } from '../store/uiSlice'

// Downloads a file through the API (so the login token is sent) and saves it.
export default function useDownload() {
  const dispatch = useDispatch()
  return async (file) => {
    try {
      const res = await fileApi.download(file._id)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = file.originalName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Download failed'), 'error'))
    }
  }
}
