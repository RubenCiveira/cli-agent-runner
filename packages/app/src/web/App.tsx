import { useState, useEffect, useCallback } from 'react'
import { api } from './api.ts'
import type { Project, Session, Skill, Agent } from './api.ts'
import { Sidebar } from './components/Sidebar.tsx'
import { Chat } from './components/Chat.tsx'
import { AddProjectModal, NewSessionModal } from './components/Modals.tsx'
import { LibraryPanel } from './components/LibraryPanel.tsx'
import { ProjectResourcesPanel } from './components/ProjectResourcesPanel.tsx'

export type AppView = 'chat' | 'project-resources' | 'library'

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [agents, setAgents] = useState<Agent[]>([])

  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [view, setView] = useState<AppView>('chat')

  const [showAddProject, setShowAddProject] = useState(false)
  const [showNewSession, setShowNewSession] = useState(false)

  useEffect(() => {
    api.projects.list().then(setProjects)
    api.skills.list().then(setSkills)
    api.agents.list().then(setAgents)
  }, [])

  useEffect(() => {
    if (!selectedProject) { setSessions([]); return }
    api.projects.sessions(selectedProject.id).then(setSessions)
  }, [selectedProject?.id])

  const handleSelectProject = useCallback((p: Project) => {
    setSelectedProject(p)
    setSelectedSession(null)
    setView('chat')
  }, [])

  const handleAddProject = useCallback(async (folderPath: string, name?: string) => {
    const project = await api.projects.add({ path: folderPath, name })
    const updated = await api.projects.list()
    setProjects(updated)
    setSelectedProject(project)
  }, [])

  const handleCreateSession = useCallback(async (opts: {
    name?: string; agentId?: string; skillId?: string; model?: string
  }) => {
    if (!selectedProject) return
    const session = await api.projects.createSession(selectedProject.id, opts)
    const updatedSessions = await api.projects.sessions(selectedProject.id)
    setSessions(updatedSessions)
    setProjects((prev) => prev.map((p) => p.id === selectedProject.id ? { ...p, sessionCount: updatedSessions.length } : p))
    setSelectedSession(session)
    setView('chat')
  }, [selectedProject])

  const handleSelectSession = useCallback((s: Session) => {
    setSelectedSession(s)
    setView('chat')
  }, [])

  const handleViewChange = useCallback((v: AppView) => {
    setView(v)
    if (v !== 'chat') setSelectedSession(null)
  }, [])

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        sessions={sessions}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        view={view}
        onSelectProject={handleSelectProject}
        onSelectSession={handleSelectSession}
        onAddProject={() => setShowAddProject(true)}
        onNewSession={() => setShowNewSession(true)}
        onViewChange={handleViewChange}
      />

      <main style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {view === 'library' && <LibraryPanel />}

        {view === 'project-resources' && selectedProject && (
          <ProjectResourcesPanel project={selectedProject} />
        )}

        {view === 'chat' && selectedSession && (
          <Chat key={selectedSession.id} session={selectedSession} />
        )}

        {view === 'chat' && !selectedSession && (
          <div className="empty-state">
            <div className="empty-icon">💬</div>
            <h2>{selectedProject ? 'No session selected' : 'Select a project'}</h2>
            <p>
              {selectedProject
                ? 'Create a new session or select one from the sidebar.'
                : 'Add a project folder from the sidebar to get started.'}
            </p>
            {selectedProject && (
              <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => setShowNewSession(true)}>
                New session
              </button>
            )}
            {!selectedProject && (
              <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setShowAddProject(true)}>
                Add project
              </button>
            )}
          </div>
        )}
      </main>

      {showAddProject && (
        <AddProjectModal onAdd={handleAddProject} onClose={() => setShowAddProject(false)} />
      )}

      {showNewSession && selectedProject && (
        <NewSessionModal
          projectId={selectedProject.id}
          skills={skills}
          agents={agents}
          onCreate={handleCreateSession}
          onClose={() => setShowNewSession(false)}
        />
      )}
    </div>
  )
}
