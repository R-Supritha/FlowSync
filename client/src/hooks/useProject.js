import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { fetchProject } from '../store/projectsSlice'
import { selectRoleIn, setCurrentWorkspace } from '../store/workspacesSlice'

// Loads the project for `projectId` into the store, points the active workspace at it
// (so sidebar people/members align), and returns the project plus the caller's role.
export default function useProject(projectId) {
  const dispatch = useDispatch()
  const project = useSelector((s) => (s.projects.current?._id === projectId ? s.projects.current : null))
  const error = useSelector((s) => s.projects.error)
  const workspaceId = project?.workspace
  const role = useSelector((s) => (workspaceId ? selectRoleIn(s, workspaceId) : null))
  const currentWorkspaceId = useSelector((s) => s.workspaces.currentId)

  useEffect(() => {
    if (project) {
      if (workspaceId && workspaceId !== currentWorkspaceId) dispatch(setCurrentWorkspace(workspaceId))
    } else {
      dispatch(fetchProject(projectId))
    }
  }, [dispatch, projectId, project, workspaceId, currentWorkspaceId])

  return { project, role, error }
}