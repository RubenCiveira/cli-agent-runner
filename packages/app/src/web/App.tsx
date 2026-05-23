import { useState, useEffect, useCallback } from 'react'
import { api } from './api.ts'
import type { Project, Session, Skill, Agent } from './api.ts'
import { Sidebar } from './components/Sidebar.tsx'
import { Chat } from './components/Chat.tsx'
import { AddProjectModal, NewSessionModal } from './components/Modals.tsx'

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [agents, setAgents] = useState<Agent[]>([])

  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)

  const [showAddProject, setShowAddProject] = useState(false)
  const [showNewSession, setShowNewSession] = useState(false)

  // Initial load
  useEffect(() => {
    api.projects.list().then(setProjects)
    api.skills.list().then(setSkills)
    api.agents.list().then(setAgents)
  }, [])

  // Load sessions when project changes
  useEffect(() => {
    if (!selectedProject) { setSessions([]); return }
    api.projects.sessions(selectedProject.id).then(setSessions)
  }, [selectedProject?.id])

  // Select project handler — deselect session if from different project
  const handleSelectProject = useCallback((p: Project) => {
    setSelectedProject(p)
    setSelectedSession(null)
  }, [])

  // Add project
  const handleAddProject = useCallback(async (folderPath: string, name?: string) => {
    const project = await api.projects.add({ path: folderPath, name })
    const updated = await api.projects.list()
    setProjects(updated)
    setSelectedProject(project)
  }, [])

  // New session
  const handleCreateSession = useCallback(async (opts: {
    name?: string; agentId?: string; skillId?: string; model?: string
  }) => {
    if (!selectedProject) return
    const session = await api.projects.createSession(selectedProject.id, opts)
    const updatedSessions = await api.projects.sessions(selectedProject.id)
    setSessions(updatedSessions)
    // Update project session count
    setProjects((prev) => prev.map((p) => p.id === selectedProject.id ? { ...p, sessionCount: updatedSessions.length } : p))
    setSelectedSession(session)
  }, [selectedProject])

  // Session selection — refresh messages are handled inside Chat
  const handleSelectSession = useCallback((s: Session) => {
    setSelectedSession(s)
  }, [])

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        sessions={sessions}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        onSelectProject={handleSelectProject}
        onSelectSession={handleSelectSession}
        onAddProject={() => setShowAddProject(true)}
        onNewSession={() => setShowNewSession(true)}
      />

      <main style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedSession ? (
          <Chat key={selectedSession.id} session={selectedSession} />
        ) : (
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
