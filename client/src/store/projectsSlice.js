import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { projectApi } from '../api/endpoints'
import { errorMessage } from '../api/client'

const wrap = (type, fn, fallback) =>
  createAsyncThunk(type, async (arg, { rejectWithValue }) => {
    try {
      return await fn(arg)
    } catch (e) {
      return rejectWithValue(errorMessage(e, fallback))
    }
  })

export const fetchProjects = wrap(
  'projects/fetch',
  async ({ workspaceId, archived }) => ({
    archived: !!archived,
    projects: (await projectApi.list(workspaceId, !!archived)).projects,
  }),
  'Failed to load projects',
)
export const fetchTemplates = wrap('projects/templates', async () => (await projectApi.templates()).templates, 'Failed to load templates')
export const fetchProject = wrap('projects/one', async (id) => (await projectApi.get(id)).project, 'Failed to load project')
export const createProject = wrap(
  'projects/create',
  async ({ workspaceId, ...body }) => (await projectApi.create(workspaceId, body)).project,
  'Failed to create project',
)
export const updateProject = wrap(
  'projects/update',
  async ({ id, ...body }) => (await projectApi.update(id, body)).project,
  'Failed to update project',
)
export const archiveProject = wrap('projects/archive', async (id) => (await projectApi.archive(id)).project, 'Failed to archive project')
export const unarchiveProject = wrap('projects/unarchive', async (id) => (await projectApi.unarchive(id)).project, 'Failed to restore project')
export const deleteProject = wrap(
  'projects/delete',
  async (id) => {
    await projectApi.remove(id)
    return id
  },
  'Failed to delete project',
)

const without = (list, id) => list.filter((p) => p._id !== id)
const replace = (list, project) => list.map((p) => (p._id === project._id ? project : p))

const projectsSlice = createSlice({
  name: 'projects',
  initialState: {
    active: [],
    archived: [],
    templates: [],
    current: null, // the project open on the board
    status: 'idle',
    error: null,
  },
  reducers: {
    clearProjects(state) {
      state.active = []
      state.archived = []
      state.current = null
      state.status = 'idle'
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchProjects.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(fetchProjects.fulfilled, (state, action) => {
        state.status = 'ready'
        state[action.payload.archived ? 'archived' : 'active'] = action.payload.projects
      })
      .addCase(fetchProjects.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.payload
      })
      .addCase(fetchTemplates.fulfilled, (state, action) => {
        state.templates = action.payload
      })
      .addCase(fetchProject.pending, (state) => {
        state.error = null
      })
      .addCase(fetchProject.fulfilled, (state, action) => {
        state.current = action.payload
      })
      .addCase(fetchProject.rejected, (state, action) => {
        state.current = null
        state.error = action.payload
      })
      .addCase(createProject.fulfilled, (state, action) => {
        state.active.unshift(action.payload)
      })
      .addCase(updateProject.fulfilled, (state, action) => {
        state.active = replace(state.active, action.payload)
        state.archived = replace(state.archived, action.payload)
        if (state.current?._id === action.payload._id) state.current = action.payload
      })
      .addCase(archiveProject.fulfilled, (state, action) => {
        state.active = without(state.active, action.payload._id)
        state.archived.unshift(action.payload)
      })
      .addCase(unarchiveProject.fulfilled, (state, action) => {
        state.archived = without(state.archived, action.payload._id)
        state.active.unshift(action.payload)
      })
      .addCase(deleteProject.fulfilled, (state, action) => {
        state.active = without(state.active, action.payload)
        state.archived = without(state.archived, action.payload)
      })
  },
})

export const { clearProjects } = projectsSlice.actions
export default projectsSlice.reducer
