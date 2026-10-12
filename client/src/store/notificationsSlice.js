import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { notificationApi } from '../api/endpoints'
import { errorMessage } from '../api/client'

export const fetchNotifications = createAsyncThunk(
  'notifications/fetch',
  async ({ unread = false, page = 1, limit = 20 } = {}, { rejectWithValue }) => {
    try {
      return await notificationApi.list({ unread: unread ? true : undefined, page, limit })
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to load notifications'))
    }
  },
)

export const markNotificationRead = createAsyncThunk(
  'notifications/read',
  async (id, { rejectWithValue }) => {
    try {
      return (await notificationApi.markRead(id)).notification
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to update notification'))
    }
  },
)

export const markAllNotificationsRead = createAsyncThunk(
  'notifications/readAll',
  async (_, { rejectWithValue }) => {
    try {
      return await notificationApi.markAllRead()
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to update notifications'))
    }
  },
)

export const deleteNotification = createAsyncThunk(
  'notifications/delete',
  async (id, { rejectWithValue }) => {
    try {
      await notificationApi.remove(id)
      return id
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to delete notification'))
    }
  },
)

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState: {
    items: [],
    unreadCount: 0,
    total: 0,
    page: 1,
    pages: 1,
    status: 'idle',
    error: null,
    unreadOnly: false,
  },
  reducers: {
    setUnreadOnly(state, action) {
      state.unreadOnly = action.payload
      state.page = 1
    },
    resetNotifications(state) {
      state.items = []
      state.unreadCount = 0
      state.status = 'idle'
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchNotifications.pending, (state, action) => {
        if (state.status === 'idle') state.status = 'loading'
        state.error = null
        if (action.meta.arg?.page) state.page = action.meta.arg.page
      })
      .addCase(fetchNotifications.fulfilled, (state, action) => {
        state.status = 'ready'
        state.items = action.payload.notifications
        state.unreadCount = action.payload.unreadCount
        state.total = action.payload.total
        state.page = action.payload.page
        state.pages = action.payload.pages
      })
      .addCase(fetchNotifications.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.payload
      })
      .addCase(markNotificationRead.fulfilled, (state, action) => {
        const n = action.payload
        const item = state.items.find((i) => i._id === n._id)
        if (item && !item.isRead) {
          item.isRead = true
          state.unreadCount = Math.max(0, state.unreadCount - 1)
        }
        if (state.unreadOnly) state.items = state.items.filter((i) => i._id !== n._id)
      })
      .addCase(markAllNotificationsRead.fulfilled, (state) => {
        state.items = state.items.map((i) => ({ ...i, isRead: true }))
        state.unreadCount = 0
        if (state.unreadOnly) state.items = []
      })
      .addCase(deleteNotification.fulfilled, (state, action) => {
        const gone = state.items.find((i) => i._id === action.payload)
        if (gone && !gone.isRead) state.unreadCount = Math.max(0, state.unreadCount - 1)
        state.items = state.items.filter((i) => i._id !== action.payload)
      })
  },
})

export const { setUnreadOnly, resetNotifications } = notificationsSlice.actions
export default notificationsSlice.reducer
