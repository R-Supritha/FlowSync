import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { boardApi, taskApi } from '../api/endpoints'
import { errorMessage } from '../api/client'

const clean = (filters = {}) =>
  Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v != null))

export const fetchBoard = createAsyncThunk(
  'board/fetch',
  async ({ projectId, filters }, { rejectWithValue }) => {
    try {
      const res = await boardApi.get(projectId, clean(filters))
      return { projectId, columns: res.columns, tasksByColumn: res.tasksByColumn }
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to load the board'))
    }
  },
)

// Moves a card in the UI at once, then tells the server. If the server says no,
// the previous board is put back and the caller gets the reason.
export const moveTask = createAsyncThunk(
  'board/move',
  async ({ projectId, taskId, from, to, index }, { dispatch, getState, rejectWithValue }) => {
    const snapshot = {
      columns: getState().board.columns,
      tasksByColumn: getState().board.tasksByColumn,
    }
    dispatch(moveLocal({ taskId, from, to, index }))
    const orderedTaskIds = getState().board.tasksByColumn[to].map((t) => t._id)
    try {
      if (from !== to) {
        await taskApi.move(taskId, { status: to, position: index })
        try {
          await boardApi.reorder(projectId, { status: to, orderedTaskIds })
        } catch {
          // The task did change column. The reorder endpoint insists on every task in the
          // column, archived ones included, while the board hides those, so it can refuse.
          // Keep the move and let the next board load show the server's order.
        }
      } else {
        await boardApi.reorder(projectId, { status: to, orderedTaskIds })
      }
      return true
    } catch (e) {
      dispatch(restoreBoard(snapshot))
      return rejectWithValue(errorMessage(e, 'Could not move the task'))
    }
  },
)

export const createTask = createAsyncThunk(
  'board/createTask',
  async ({ projectId, filters, ...body }, { dispatch, rejectWithValue }) => {
    try {
      const { task } = await taskApi.create(projectId, body)
      await dispatch(fetchBoard({ projectId, filters }))
      return task
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to create task'))
    }
  },
)

export const saveColumns = createAsyncThunk(
  'board/saveColumns',
  async ({ projectId, columns, filters }, { dispatch, rejectWithValue }) => {
    try {
      await boardApi.setColumns(projectId, columns)
      await dispatch(fetchBoard({ projectId, filters }))
      return columns
    } catch (e) {
      return rejectWithValue(errorMessage(e, 'Failed to update columns'))
    }
  },
)

const boardSlice = createSlice({
  name: 'board',
  initialState: {
    projectId: null,
    columns: [],
    tasksByColumn: {},
    status: 'idle', // idle | loading | ready | error
    error: null,
  },
  reducers: {
    moveLocal(state, action) {
      const { taskId, from, to, index } = action.payload
      const source = state.tasksByColumn[from]
      const at = source.findIndex((t) => t._id === taskId)
      if (at < 0) return
      const [task] = source.splice(at, 1)
      const target = state.tasksByColumn[to]
      // When moving down inside one column the removal shifted everything up by one.
      const insertAt = from === to && index > at ? index - 1 : index
      task.status = to
      target.splice(Math.max(0, Math.min(insertAt, target.length)), 0, task)
    },
    restoreBoard(state, action) {
      state.columns = action.payload.columns
      state.tasksByColumn = action.payload.tasksByColumn
    },
    resetBoard(state) {
      state.projectId = null
      state.columns = []
      state.tasksByColumn = {}
      state.status = 'idle'
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchBoard.pending, (state, action) => {
        // Keep the old cards on screen while a filter change reloads.
        if (state.projectId !== action.meta.arg.projectId) {
          state.columns = []
          state.tasksByColumn = {}
        }
        state.status = state.status === 'ready' ? 'ready' : 'loading'
        state.error = null
      })
      .addCase(fetchBoard.fulfilled, (state, action) => {
        state.projectId = action.payload.projectId
        state.columns = action.payload.columns
        state.tasksByColumn = action.payload.tasksByColumn
        state.status = 'ready'
      })
      .addCase(fetchBoard.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.payload
      })
  },
})

export const { moveLocal, restoreBoard, resetBoard } = boardSlice.actions
export default boardSlice.reducer
