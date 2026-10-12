import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { authApi } from '../api/endpoints'
import { errorMessage, TOKEN_KEY } from '../api/client'

const USER_KEY = 'flowsync_user'

function readUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY))
  } catch {
    return null
  }
}

function persist({ token, user }) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export const login = createAsyncThunk('auth/login', async (body, { rejectWithValue }) => {
  try {
    const res = await authApi.login(body)
    persist(res)
    return res
  } catch (e) {
    return rejectWithValue(errorMessage(e, 'Login failed'))
  }
})

export const register = createAsyncThunk('auth/register', async (body, { rejectWithValue }) => {
  try {
    const res = await authApi.register(body)
    persist(res)
    return res
  } catch (e) {
    return rejectWithValue(errorMessage(e, 'Registration failed'))
  }
})

const initialState = {
  token: localStorage.getItem(TOKEN_KEY),
  user: readUser(),
  status: 'idle',
  error: null,
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout(state) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      state.token = null
      state.user = null
      state.status = 'idle'
      state.error = null
    },
    clearAuthError(state) {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    for (const thunk of [login, register]) {
      builder
        .addCase(thunk.pending, (state) => {
          state.status = 'loading'
          state.error = null
        })
        .addCase(thunk.fulfilled, (state, action) => {
          state.status = 'idle'
          state.token = action.payload.token
          state.user = action.payload.user
        })
        .addCase(thunk.rejected, (state, action) => {
          state.status = 'idle'
          state.error = action.payload || 'Something went wrong'
        })
    }
  },
})

export const { logout, clearAuthError } = authSlice.actions
export default authSlice.reducer
