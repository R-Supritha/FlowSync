import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { presenceApi } from '../api/endpoints'
import { errorMessage } from '../api/client'

// The heartbeat and status endpoints both return the resolved presence for `me`.
export const sendHeartbeat = createAsyncThunk(
  'presence/heartbeat',
  async (active, { rejectWithValue }) => {
    try {
      return (await presenceApi.heartbeat(active)).presence
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to record presence'))
    }
  },
)

export const fetchMyPresence = createAsyncThunk('presence/me', async (_, { rejectWithValue }) => {
  try {
    return (await presenceApi.me()).presence
  } catch (e) {
    return rejectWithValue(errorMessage(e, 'Failed to load presence'))
  }
})

export const updateMyPresence = createAsyncThunk(
  'presence/update',
  async (body, { rejectWithValue }) => {
    try {
      return (await presenceApi.setStatus(body)).presence
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to update presence'))
    }
  },
)

export const fetchWorkspacePresence = createAsyncThunk(
  'presence/workspace',
  async (workspaceId, { rejectWithValue }) => {
    try {
      const { members } = await presenceApi.workspace(workspaceId)
      return { workspaceId, members }
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to load presence'))
    }
  },
)

const presenceSlice = createSlice({
  name: 'presence',
  initialState: {
    me: null, // resolved presence of the current user
    team: {}, // workspaceId -> [ { user, status, workMode, hidden, workingOn } ]
  },
  reducers: {},
  extraReducers: (builder) => {
    const setMe = (state, action) => {
      if (action.payload) state.me = action.payload
    }
    builder
      .addCase(sendHeartbeat.fulfilled, setMe)
      .addCase(fetchMyPresence.fulfilled, setMe)
      .addCase(updateMyPresence.fulfilled, setMe)
      .addCase(fetchWorkspacePresence.fulfilled, (state, action) => {
        state.team[action.payload.workspaceId] = action.payload.members
      })
  },
})

export default presenceSlice.reducer
