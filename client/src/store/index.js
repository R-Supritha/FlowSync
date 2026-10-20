import { configureStore } from '@reduxjs/toolkit'
import { setUnauthorizedHandler } from '../api/client'
import auth from './authSlice'
import ui from './uiSlice'
import workspaces from './workspacesSlice'
import projects from './projectsSlice'
import board from './boardSlice'
import { signOut } from './session'

const store = configureStore({
  reducer: { auth, ui, workspaces, projects, board },
})

// Any 401 outside login/register signs the person out; ProtectedRoute then sends them to /login.
setUnauthorizedHandler(() => {
  if (store.getState().auth.token) store.dispatch(signOut())
})

export default store
