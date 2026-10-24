import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { workspaceApi } from '../api/endpoints'
import { errorMessage } from '../api/client'

const CURRENT_KEY = 'flowsync_workspace'

export const fetchWorkspaces = createAsyncThunk('workspaces/fetch', async (_, { rejectWithValue }) => {
  try {
    return (await workspaceApi.list()).workspaces
  } catch (e) {
    return rejectWithValue(errorMessage(e, 'Failed to load workspaces'))
  }
})

export const createWorkspace = createAsyncThunk('workspaces/create', async (body, { rejectWithValue }) => {
  try {
    return (await workspaceApi.create(body)).workspace
  } catch (e) {
    return rejectWithValue(errorMessage(e, 'Failed to create workspace'))
  }
})

// Names live on the presence endpoint; roles live on the workspace itself.
export const fetchPeople = createAsyncThunk('workspaces/people', async (workspaceId, { rejectWithValue }) => {
  try {
    const { members } = await workspaceApi.people(workspaceId)
    const people = {}
    for (const m of members) {
      people[m.user._id] = { id: m.user._id, name: m.user.name, email: m.user.email, hidden: !!m.hidden }
    }
    return { workspaceId, people }
  } catch (e) {
    return rejectWithValue(errorMessage(e, 'Failed to load members'))
  }
})

export const inviteMember = createAsyncThunk(
  'workspaces/invite',
  async ({ workspaceId, email, role }, { dispatch, rejectWithValue }) => {
    try {
      const { workspace } = await workspaceApi.invite(workspaceId, { email, role })
      dispatch(fetchPeople(workspaceId))
      return workspace
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to invite member'))
    }
  },
)

export const removeMember = createAsyncThunk(
  'workspaces/removeMember',
  async ({ workspaceId, userId }, { rejectWithValue }) => {
    try {
      return (await workspaceApi.removeMember(workspaceId, userId)).workspace
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to remove member'))
    }
  },
)

export const updateWorkspace = createAsyncThunk(
  'workspaces/update',
  async ({ workspaceId, name, description }, { rejectWithValue }) => {
    try {
      return (await workspaceApi.update(workspaceId, { name, description })).workspace
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to save the workspace settings'))
    }
  },
)

export const changeMemberRole = createAsyncThunk(
  'workspaces/changeRole',
  async ({ workspaceId, userId, role }, { rejectWithValue }) => {
    try {
      return (await workspaceApi.setRole(workspaceId, userId, role)).workspace
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to change the role'))
    }
  },
)

export const deleteWorkspace = createAsyncThunk(
  'workspaces/delete',
  async ({ workspaceId, confirmName }, { rejectWithValue }) => {
    try {
      await workspaceApi.remove(workspaceId, confirmName)
      return workspaceId
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to delete the workspace'))
    }
  },
)

function replaceWorkspace(state, workspace) {
  const i = state.items.findIndex((w) => w._id === workspace._id)
  if (i >= 0) state.items[i] = workspace
  else state.items.push(workspace)
}

const workspacesSlice = createSlice({
  name: 'workspaces',
  initialState: {
    items: [],
    status: 'idle', // idle | loading | ready | error
    error: null,
    currentId: localStorage.getItem(CURRENT_KEY),
    people: {}, // workspaceId -> { userId -> { id, name, email } }
  },
  reducers: {
    setCurrentWorkspace(state, action) {
      state.currentId = action.payload
      localStorage.setItem(CURRENT_KEY, action.payload)
    },
    resetWorkspaces(state) {
      state.items = []
      state.status = 'idle'
      state.currentId = null
      state.people = {}
      localStorage.removeItem(CURRENT_KEY)
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchWorkspaces.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(fetchWorkspaces.fulfilled, (state, action) => {
        state.items = action.payload
        state.status = 'ready'
        if (!state.items.some((w) => w._id === state.currentId)) {
          state.currentId = state.items[0]?._id || null
          if (state.currentId) localStorage.setItem(CURRENT_KEY, state.currentId)
        }
      })
      .addCase(fetchWorkspaces.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.payload
      })
      .addCase(createWorkspace.fulfilled, (state, action) => {
        replaceWorkspace(state, action.payload)
        state.currentId = action.payload._id
        localStorage.setItem(CURRENT_KEY, action.payload._id)
      })
      .addCase(inviteMember.fulfilled, (state, action) => replaceWorkspace(state, action.payload))
      .addCase(removeMember.fulfilled, (state, action) => replaceWorkspace(state, action.payload))
      .addCase(updateWorkspace.fulfilled, (state, action) => replaceWorkspace(state, action.payload))
      .addCase(changeMemberRole.fulfilled, (state, action) => replaceWorkspace(state, action.payload))
      .addCase(deleteWorkspace.fulfilled, (state, action) => {
        state.items = state.items.filter((w) => w._id !== action.payload)
        delete state.people[action.payload]
        if (state.currentId === action.payload) {
          state.currentId = state.items[0]?._id || null
          if (state.currentId) localStorage.setItem(CURRENT_KEY, state.currentId)
          else localStorage.removeItem(CURRENT_KEY)
        }
      })
      .addCase(fetchPeople.fulfilled, (state, action) => {
        state.people[action.payload.workspaceId] = action.payload.people
      })
  },
})

export const { setCurrentWorkspace, resetWorkspaces } = workspacesSlice.actions
export default workspacesSlice.reducer

export const selectCurrentWorkspace = (state) =>
  state.workspaces.items.find((w) => w._id === state.workspaces.currentId) || null

export const selectRoleIn = (state, workspaceId) => {
  const ws = state.workspaces.items.find((w) => w._id === workspaceId)
  const me = state.auth.user?.id
  return ws?.members.find((m) => String(m.user) === String(me))?.role || null
}

export const selectMyRole = (state) => selectRoleIn(state, state.workspaces.currentId)
