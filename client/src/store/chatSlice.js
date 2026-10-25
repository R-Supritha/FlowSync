import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { chatApi } from '../api/endpoints'
import { errorMessage } from '../api/client'

export const fetchChannels = createAsyncThunk('chat/fetchChannels', async (workspaceId, { rejectWithValue }) => {
  try {
    const res = await chatApi.channels(workspaceId)
    return { workspaceId, channels: res.channels, canPost: res.canPost, canManage: res.canManage }
  } catch (e) {
    return rejectWithValue(errorMessage(e, 'Could not load the channels'))
  }
})

const ORDER = { general: 0, project: 1, custom: 2 }
const sortChannels = (list) => [...list].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.name.localeCompare(b.name))

const chatSlice = createSlice({
  name: 'chat',
  initialState: { workspaceId: null, channels: [], canPost: false, canManage: false, status: 'idle', error: '' },
  reducers: {
    channelRead(state, action) {
      const c = state.channels.find((x) => x._id === action.payload)
      if (c) c.unread = 0
    },
    // A message arrived over the live stream. Only messages in a channel you are not looking at count as unread.
    messageArrived(state, action) {
      const { channelId, message, mine, active } = action.payload
      const c = state.channels.find((x) => x._id === channelId)
      if (!c) return
      c.lastMessage = { text: String(message.text || '').slice(0, 80), createdAt: message.createdAt, author: message.author && message.author.name }
      if (!mine && !active) c.unread = (c.unread || 0) + 1
    },
    // every message of the channel was removed ("Clear chat")
    channelCleared(state, action) {
      const c = state.channels.find((x) => x._id === action.payload)
      if (c) {
        c.unread = 0
        c.lastMessage = null
      }
    },
    removeChannel(state, action) {
      state.channels = state.channels.filter((x) => x._id !== action.payload)
    },
    upsertChannel(state, action) {
      const incoming = action.payload
      const i = state.channels.findIndex((x) => x._id === incoming._id)
      if (i >= 0) state.channels[i] = { ...state.channels[i], ...incoming }
      else state.channels = sortChannels([...state.channels, { unread: 0, lastMessage: null, ...incoming }])
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchChannels.pending, (state, action) => {
        if (state.workspaceId !== action.meta.arg) {
          state.workspaceId = action.meta.arg
          state.channels = []
          state.status = 'loading'
        }
      })
      .addCase(fetchChannels.fulfilled, (state, action) => {
        if (action.payload.workspaceId !== state.workspaceId) return // a late answer for a workspace we left
        state.channels = action.payload.channels
        state.canPost = action.payload.canPost
        state.canManage = action.payload.canManage
        state.status = 'ready'
        state.error = ''
      })
      .addCase(fetchChannels.rejected, (state, action) => {
        state.status = state.channels.length ? 'ready' : 'error'
        state.error = action.payload || 'Could not load the channels'
      })
  },
})

export const { channelRead, channelCleared, messageArrived, removeChannel, upsertChannel } = chatSlice.actions
export const selectUnreadTotal = (s) => s.chat.channels.reduce((n, c) => n + (c.unread || 0), 0)
export default chatSlice.reducer
