import { logout } from './authSlice'
import { resetWorkspaces } from './workspacesSlice'
import { clearProjects } from './projectsSlice'
import { resetBoard } from './boardSlice'

// Signs out and clears everything that belongs to the previous person.
export const signOut = () => (dispatch) => {
  dispatch(logout())
  dispatch(resetWorkspaces())
  dispatch(clearProjects())
  dispatch(resetBoard())
}
