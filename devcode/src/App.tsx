import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Editor } from '@monaco-editor/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Code, FileText, Folder, Moon, Play, RefreshCcw, Save, Sun, MessageSquare, TerminalSquare, X, ChevronRight, FileJson, FileCode, Image as ImageIcon, FileType, Download } from 'lucide-react'
import { apiGet, apiPost, sse } from './lib/api'
import type { Chat, ChatMessage, FsTree } from './lib/types'

// xterm imports
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

import logo from './assets/logo.png'

// Ensure we have a persistent device ID for active user counting
const DEVICE_ID = localStorage.getItem('devcode_device_id') || crypto.randomUUID();
if (!localStorage.getItem('devcode_device_id')) {
  localStorage.setItem('devcode_device_id', DEVICE_ID);
}

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('devcode-theme')
    if (stored === 'dark' || stored === 'light') return stored
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
  })

  const [projectRoot, setProjectRoot] = useState<string | null>(null)
  const [tree, setTree] = useState<FsTree | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '.': true })
  
  // Editor state
  const [openFiles, setOpenFiles] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [fileContents, setFileContents] = useState<Record<string, string>>({})
  const [dirtyFiles, setDirtyFiles] = useState<Record<string, boolean>>({})

  // Layout state
  const [showExplorer, setShowExplorer] = useState(true)
  const [showChat, setShowChat] = useState(true)
  const [showTerminal, setShowTerminal] = useState(true)

  const [tab, setTab] = useState<'editor' | 'preview'>('editor')
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [urls, setUrls] = useState<string[]>([])

  const [chat, setChat] = useState<Chat>({ id: 'default', messages: [] })
  const [chatDraft, setChatDraft] = useState('')
  const [chatBusy, setChatBusy] = useState(false)

  // Update System
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string, forced: boolean, url: string, releaseNotes: string } | null>(null)
  const [showUpdateModal, setShowUpdateModal] = useState(false)

  // Global settings & Onboarding
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(0)
  const [globalProjects, setGlobalProjects] = useState<string[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})

  const chatLogRef = useRef<HTMLDivElement | null>(null)
  
  // Terminal refs
  const terminalRef = useRef<HTMLDivElement | null>(null)
  const termInstance = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('devcode-theme', theme)
    
    // Update terminal theme if running
    if (termInstance.current) {
      termInstance.current.options.theme = {
        background: theme === 'dark' ? '#18181b' : '#f4f5f7',
        foreground: theme === 'dark' ? '#e4e4e7' : '#1a1a1a',
        cursor: theme === 'dark' ? '#e4e4e7' : '#1a1a1a',
      }
    }
  }, [theme])

  // Live active users heartbeat
  useEffect(() => {
    const pingActiveUsers = async () => {
      try {
        await fetch('https://devcode-ai-webservice.vercel.app/api/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: DEVICE_ID })
        })
      } catch (err) {
        // Silently fail if unable to reach server
      }
    }

    // Ping immediately on load
    pingActiveUsers()
    
    // Ping every 30 seconds to keep session alive
    const interval = setInterval(pingActiveUsers, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTo({ top: chatLogRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [chat.messages])

  // Initialize interactive terminal
  useEffect(() => {
    if (!showTerminal || !projectRoot || !terminalRef.current) return
    if (termInstance.current) return

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: theme === 'dark' ? '#18181b' : '#f4f5f7',
        foreground: theme === 'dark' ? '#e4e4e7' : '#1a1a1a',
        cursor: theme === 'dark' ? '#e4e4e7' : '#1a1a1a',
      }
    })
    
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    
    // small delay to ensure container is fully rendered before fitting
    setTimeout(() => fitAddon.fit(), 10)

    termInstance.current = term
    fitAddonRef.current = fitAddon

    const wsUrl = `ws://localhost:3030/api/terminal/pty?cwd=${encodeURIComponent(projectRoot)}`
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws

    ws.onopen = () => {
      term.onData((data) => ws.send(data))
      term.onResize(({ cols, rows }) => {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      })
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }

    ws.onmessage = (ev) => {
      const text = ev.data as string
      term.write(text)
      
      // Basic URL extraction from terminal output to update preview links
      const re = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s'"]*/gi
      const found = [...text.matchAll(re)].map(m => m[0])
      if (found.length) {
        setUrls(prev => {
          const next = [...new Set([...prev, ...found])]
          if (next.length !== prev.length && !previewUrl) {
            setPreviewUrl(next[0])
          }
          return next
        })
      }
    }

    const handleResize = () => {
      if (fitAddonRef.current) fitAddonRef.current.fit()
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      term.dispose()
      ws.close()
      termInstance.current = null
      wsRef.current = null
    }
  }, [showTerminal, projectRoot])

  async function refreshTree() {
    const r = await apiGet<{ tree: FsTree }>('/api/fs/tree?dir=.')
    if (r.ok) setTree(r.tree)
  }

  async function openProjectFolder() {
    const selected = (await window.devcode?.selectFolder?.()) ?? null
    if (!selected) return
    const r = await apiPost<{ projectRoot: string }>('/api/project/open', { path: selected })
    if (!r.ok) return
    setProjectRoot(r.projectRoot)
    setOpenFiles([])
    setActivePath(null)
    setFileContents({})
    setDirtyFiles({})
    await refreshTree()
    await loadChat('default')
  }

  async function initProject() {
    const s = await apiGet<{ settings: { onboarded: boolean, theme: string }, env: Record<string, string> }>('/api/settings')
    if (s.ok) {
      if (!s.settings.onboarded) {
        setShowOnboarding(true)
      }
      if (s.settings.theme) {
        setTheme(s.settings.theme as 'light'|'dark')
      }
      setApiKeys(s.env || {})
    }

    const pr = await apiGet<{ projects: string[] }>('/api/projects')
    if (pr.ok) {
      setGlobalProjects(pr.projects)
    }

    const state = (await window.devcode?.getState?.()) ?? {}
    const last = typeof state.lastProjectPath === 'string' ? state.lastProjectPath : null
    if (!last) return
    
    for (let i = 0; i < 10; i++) {
      const r = await apiPost<{ projectRoot: string }>('/api/project/open', { path: last })
      if (r.ok) {
        setProjectRoot(r.projectRoot)
        await apiPost('/api/projects', { projectRoot: r.projectRoot }) // Add to global if not exists
        
        // Refresh global projects list
        const pr2 = await apiGet<{ projects: string[] }>('/api/projects')
        if (pr2.ok) setGlobalProjects(pr2.projects)

        await refreshTree()
        await loadChat('default')
        return
      }
      await new Promise(res => setTimeout(res, 500))
    }
  }

  function compareSemver(a: string, b: string) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
  }

  async function checkUpdate() {
    try {
      const CURRENT_VERSION = '1.0.2'
      // Cache buster to ensure it checks the actual raw GitHub file and not a cached version
      const res = await fetch('https://raw.githubusercontent.com/StarGazerDevelopment/devcode-app/main/devcode.config?t=' + Date.now())
      if (!res.ok) return
      const config = await res.json()

      const isNewer = compareSemver(config.version, CURRENT_VERSION) > 0
      if (!isNewer) return

      // It's a new version. Check remind settings.
      const remRes = await apiGet<{ data: { date: number, skippedVersion: string } | null }>('/api/update/remind')
      let shouldShow = true

      if (remRes.ok && remRes.data) {
        const { date, skippedVersion } = remRes.data
        const now = Date.now()
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000

        // If it's a forced update, ignore reminder
        if (config.forced) {
          shouldShow = true
        } else {
          // If the config version is greater than the skipped version (meaning 2 updates have passed)
          if (compareSemver(config.version, skippedVersion) > 0) {
            shouldShow = true
          } else if (now - date < threeDaysMs) {
            // Within 3 days of reminder for the same version
            shouldShow = false
          }
        }
      }

      if (shouldShow) {
        setUpdateAvailable({
          version: config.version,
          forced: config.forced,
          url: config.downloadUrl,
          releaseNotes: config.releaseNotes || 'Bug fixes and performance improvements.'
        })
        setShowUpdateModal(true)
      }

    } catch (err) {
      console.error('Update check failed:', err)
    }
  }

  useEffect(() => {
    void initProject()
    void checkUpdate()
  }, [])

  useEffect(() => {
    if (!projectRoot) return
    let timeout: ReturnType<typeof setTimeout>
    
    const es = sse('/api/fs/watch')
    es.addEventListener('change', () => {
      // Debounce the refresh
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        void refreshTree()
      }, 500)
    })
    
    return () => {
      clearTimeout(timeout)
      es.close()
    }
  }, [projectRoot])

  async function loadFile(p: string) {
    if (!openFiles.includes(p)) {
      setOpenFiles((prev) => [...prev, p])
    }
    setActivePath(p)
    setTab('editor')
    
    if (fileContents[p] !== undefined) return

    const r = await apiGet<{ content: string }>(`/api/fs/read?path=${encodeURIComponent(p)}`)
    if (!r.ok) return
    setFileContents((prev) => ({ ...prev, [p]: r.content }))
    setDirtyFiles((prev) => ({ ...prev, [p]: false }))
  }

  function closeFile(p: string, e: React.MouseEvent) {
    e.stopPropagation()
    const next = openFiles.filter((f) => f !== p)
    setOpenFiles(next)
    if (activePath === p) {
      setActivePath(next.length ? next[next.length - 1] : null)
    }
  }

  async function saveFile() {
    if (!activePath) return
    const content = fileContents[activePath] || ''
    const r = await apiPost<Record<string, never>>('/api/fs/write', { path: activePath, content })
    if (!r.ok) return
    setDirtyFiles((prev) => ({ ...prev, [activePath]: false }))
    await refreshTree()
  }

  async function loadChat(id: string) {
    const r = await apiGet<{ chat: Chat }>(`/api/chat/${encodeURIComponent(id)}`)
    if (r.ok) setChat(r.chat)
  }

  async function persistChat(next: Chat) {
    setChat(next)
    await apiPost<Record<string, never>>(`/api/chat/${encodeURIComponent(next.id)}`, { chat: next })
  }

  async function sendChat() {
    const text = chatDraft.trim()
    if (!text || chatBusy) return
    setChatDraft('')
    setChatBusy(true)

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, ts: Date.now() }
    const assistantId = crypto.randomUUID()
    const initialAssistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', ts: Date.now() }
    
    const next = { ...chat, messages: [...chat.messages, userMsg, initialAssistantMsg] }
    setChat(next) // Optimistic update
    
    // We only send the messages up to the user message
    const payload = {
      messages: [...chat.messages, userMsg]
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content })),
    }

    try {
      const res = await fetch('http://localhost:3030/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (res.body) {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentText = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          
          const lines = buffer.split('\n\n')
          buffer = lines.pop() || ''
          
          for (const line of lines) {
            if (line.startsWith('event: token')) {
              const dataStr = line.split('\ndata: ')[1]
              if (dataStr) {
                try {
                  const data = JSON.parse(dataStr)
                  currentText += data.text
                  setChat(prev => {
                    const msgs = [...prev.messages]
                    const idx = msgs.findIndex(m => m.id === assistantId)
                    if (idx !== -1) {
                      msgs[idx] = { ...msgs[idx], content: currentText }
                    }
                    return { ...prev, messages: msgs }
                  })
                } catch (e) {}
              }
            } else if (line.startsWith('event: done')) {
              // stream finished
            }
          }
        }
      }
      
      // After stream is complete, persist
      setChat(prev => {
        void persistChat(prev)
        return prev
      })
    } catch (e) {
      console.error('Chat error:', e)
    } finally {
      setChatBusy(false)
    }
  }

  useEffect(() => {
    if (!previewUrl && urls.length) setPreviewUrl(urls[0])
  }, [urls, previewUrl])

  const flattened = useMemo(() => {
    const rows: Array<{ path: string; type: 'file' | 'dir'; depth: number; name: string; truncated?: boolean }> = []
    const walk = (node: FsTree, depth: number) => {
      if (node.type === 'file') {
        const name = node.path.split('/').at(-1) || node.path
        rows.push({ path: node.path, type: 'file', depth, name })
        return
      }
      const isRoot = node.path === '.'
      if (!isRoot) {
        const name = node.path.split('/').at(-1) || node.path
        rows.push({ path: node.path, type: 'dir', depth, name, truncated: node.truncated })
      }
      const open = expanded[node.path] ?? isRoot
      if (!open) return
      
      const children = [...(node.children || [])].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.path.localeCompare(b.path)
      })
      
      for (const child of children) walk(child, isRoot ? depth : depth + 1)
    }
    if (tree) walk(tree, 0)
    return rows
  }, [tree, expanded])

  function handleRemindMe() {
    if (!updateAvailable) return
    apiPost('/api/update/remind', { date: Date.now(), skippedVersion: updateAvailable.version })
    setShowUpdateModal(false)
  }

  async function completeOnboarding() {
    await apiPost('/api/settings', { settings: { onboarded: true, theme }, env: apiKeys })
    setShowOnboarding(false)
  }

  async function openGlobalProject(p: string) {
    if (window.devcode?.setState) {
      await window.devcode.setState({ lastProjectPath: p })
    }
    const r = await apiPost<{ projectRoot: string }>('/api/project/open', { path: p })
    if (r.ok) {
      setProjectRoot(r.projectRoot)
      await refreshTree()
      await loadChat('default')
    }
  }

  async function pickNewProject() {
    if (window.devcode?.selectFolder) {
      const p = await window.devcode.selectFolder()
      if (p) {
        await apiPost('/api/projects', { projectRoot: p })
        const pr = await apiGet<{ projects: string[] }>('/api/projects')
        if (pr.ok) setGlobalProjects(pr.projects)
        await openGlobalProject(p)
      }
    }
  }

  const providers = [
    { id: 'GROQ_API_KEY', name: 'Groq' },
    { id: 'OPENAI_API_KEY', name: 'OpenAI' },
    { id: 'ANTHROPIC_API_KEY', name: 'Anthropic' },
    { id: 'OPENROUTER_API_KEY', name: 'OpenRouter' },
    { id: 'GEMINI_API_KEY', name: 'Google Gemini' },
    { id: 'MISTRAL_API_KEY', name: 'Mistral' },
    { id: 'TOGETHER_API_KEY', name: 'Together AI' },
    { id: 'DEEPSEEK_API_KEY', name: 'DeepSeek' },
    { id: 'AZURE_OPENAI_API_KEY', name: 'Azure OpenAI' },
    { id: 'COHERE_API_KEY', name: 'Cohere' },
    { id: 'PERPLEXITY_API_KEY', name: 'Perplexity' },
    { id: 'CUSTOM_ENDPOINT_KEY', name: 'Custom Endpoint' },
  ]

  return (
    <div className="layout">
      {/* GLOBAL SIDEBAR */}
      <div className="global-sidebar">
        <div className="global-projects">
          {globalProjects.map((p, i) => {
            const isSelected = p === projectRoot
            const firstLetter = p.split(/[\/\\]/).pop()?.[0]?.toUpperCase() || '?'
            // Generate a deterministic soft color based on the path string
            const hue = p.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360
            const softColor = `hsl(${hue}, 70%, 80%)`

            return (
              <div
                key={i}
                className={`project-bubble ${isSelected ? 'selected' : ''}`}
                style={{ backgroundColor: softColor }}
                title={p}
                onClick={() => openGlobalProject(p)}
              >
                {firstLetter}
              </div>
            )
          })}
          <div className="project-bubble add-project" onClick={pickNewProject} title="Add Project">
            +
          </div>
        </div>
        <div className="global-settings-btn" onClick={() => setShowSettings(true)} title="Settings">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </div>
      </div>

      {/* MAIN APP CONTAINER */}
      <div className="app">
      {/* UPDATE MODAL */}
      {showUpdateModal && updateAvailable && (
        <div className="update-modal-overlay">
          <div className="update-modal">
            <h2>Update Available ({updateAvailable.version})</h2>
            <div className="update-notes">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{updateAvailable.releaseNotes}</ReactMarkdown>
            </div>
            <div className="update-actions">
              {!updateAvailable.forced && (
                <button className="btn outline" onClick={handleRemindMe}>
                  Remind me in 3 days
                </button>
              )}
              <a href={updateAvailable.url} target="_blank" rel="noreferrer" className="btn primary" onClick={() => !updateAvailable.forced && setShowUpdateModal(false)}>
                <Download size={16} /> Download Update
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ONBOARDING MODAL */}
      {showOnboarding && (
        <div className="update-modal-overlay" style={{ backdropFilter: 'blur(10px)', background: 'var(--bg-primary)' }}>
          <div className="update-modal" style={{ textAlign: 'center', maxWidth: 600 }}>
            {onboardingStep === 0 && (
              <>
                <h1 style={{ fontSize: '2rem', marginBottom: '1rem', background: 'linear-gradient(to right, #3b82f6, #8b5cf6)', WebkitBackgroundClip: 'text', color: 'transparent' }}>Welcome to DevCode!</h1>
                <p style={{ color: 'var(--fg-secondary)', marginBottom: '2rem', fontSize: '1.1rem' }}>Your ultimate AI-powered coding platform.</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '2rem' }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--accent-color)' }} />
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--border-color)' }} />
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--border-color)' }} />
                </div>
                <button className="primaryBtn" style={{ padding: '0.75rem 2rem', fontSize: '1.1rem' }} onClick={() => setOnboardingStep(1)}>
                  Next <ChevronRight size={18} style={{ marginLeft: 8 }} />
                </button>
              </>
            )}
            {onboardingStep === 1 && (
              <>
                <h2 style={{ marginBottom: '2rem' }}>Select a Theme</h2>
                <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', marginBottom: '2rem' }}>
                  <div 
                    className={`theme-card ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => setTheme('light')}
                    style={{ padding: '2rem', border: '2px solid', borderColor: theme === 'light' ? 'var(--accent-color)' : 'var(--border-color)', borderRadius: 12, cursor: 'pointer', background: '#f8fafc', color: '#0f172a' }}
                  >
                    <Sun size={48} style={{ marginBottom: '1rem' }} />
                    <h3>Light</h3>
                  </div>
                  <div 
                    className={`theme-card ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => setTheme('dark')}
                    style={{ padding: '2rem', border: '2px solid', borderColor: theme === 'dark' ? 'var(--accent-color)' : 'var(--border-color)', borderRadius: 12, cursor: 'pointer', background: '#0f172a', color: '#f8fafc' }}
                  >
                    <Moon size={48} style={{ marginBottom: '1rem' }} />
                    <h3>Dark</h3>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '2rem' }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--border-color)' }} />
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--accent-color)' }} />
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--border-color)' }} />
                </div>
                <button className="primaryBtn" style={{ padding: '0.75rem 2rem', fontSize: '1.1rem' }} onClick={() => setOnboardingStep(2)}>
                  Next <ChevronRight size={18} style={{ marginLeft: 8 }} />
                </button>
              </>
            )}
            {onboardingStep === 2 && (
              <>
                <h2 style={{ marginBottom: '0.5rem' }}>Host your own AIs: Keep DevCode Free</h2>
                <p style={{ color: 'var(--fg-secondary)', marginBottom: '1.5rem' }}>Enter an API key from your preferred provider to get started.</p>
                
                <div style={{ textAlign: 'left', maxHeight: '40vh', overflowY: 'auto', paddingRight: '1rem', marginBottom: '2rem' }}>
                  {providers.map(p => (
                    <div key={p.id} style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.25rem', color: 'var(--fg-primary)' }}>{p.name} API Key</label>
                      <input 
                        type="password" 
                        placeholder={`Enter ${p.name} API Key...`} 
                        value={apiKeys[p.id] || ''}
                        onChange={(e) => setApiKeys(prev => ({ ...prev, [p.id]: e.target.value }))}
                        className="api-input"
                      />
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '2rem' }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--border-color)' }} />
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--border-color)' }} />
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--accent-color)' }} />
                </div>
                <button className="primaryBtn" style={{ padding: '0.75rem 2rem', fontSize: '1.1rem' }} onClick={completeOnboarding}>
                  Get Started <ChevronRight size={18} style={{ marginLeft: 8 }} />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="update-modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="update-modal" style={{ maxWidth: 600, width: '100%', height: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0 }}>Settings</h2>
              <button className="iconBtn" onClick={() => setShowSettings(false)}><X size={20} /></button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '1rem' }}>
              <h3 style={{ marginBottom: '1rem', color: 'var(--fg-secondary)' }}>Theme</h3>
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                <button className={`btn ${theme === 'light' ? 'primary' : 'outline'}`} onClick={() => setTheme('light')}>Light</button>
                <button className={`btn ${theme === 'dark' ? 'primary' : 'outline'}`} onClick={() => setTheme('dark')}>Dark</button>
              </div>

              <h3 style={{ marginBottom: '1rem', color: 'var(--fg-secondary)' }}>API Providers</h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '1rem' }}>Keys are stored locally in your ~/.devcode folder.</p>
              
              {providers.map(p => (
                <div key={p.id} style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.25rem', color: 'var(--fg-primary)' }}>{p.name} API Key</label>
                  <input 
                    type="password" 
                    placeholder={`Enter ${p.name} API Key...`} 
                    value={apiKeys[p.id] || ''}
                    onChange={(e) => setApiKeys(prev => ({ ...prev, [p.id]: e.target.value }))}
                    className="api-input"
                  />
                </div>
              ))}
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
              <button className="primaryBtn" onClick={() => {
                apiPost('/api/settings', { settings: { theme, onboarded: true }, env: apiKeys })
                setShowSettings(false)
              }}>
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
        <div className="activityBar">
        <div 
          className={showExplorer ? 'activityIcon active' : 'activityIcon'} 
          onClick={() => setShowExplorer(!showExplorer)}
          title="Explorer"
        >
          <Folder size={20} />
        </div>
        <div 
          className={showChat ? 'activityIcon active' : 'activityIcon'} 
          onClick={() => setShowChat(!showChat)}
          title="Chat"
        >
          <MessageSquare size={20} />
        </div>
        <div className="grow" />
        <div 
          className={showTerminal ? 'activityIcon active' : 'activityIcon'} 
          onClick={() => setShowTerminal(!showTerminal)}
          title="Terminal"
        >
          <TerminalSquare size={20} />
        </div>
        <div 
          className="activityIcon" 
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Toggle Theme"
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </div>
      </div>

      {/* Chat Sidebar (Left) */}
      {showChat && (
        <aside className="sidebar" style={{ borderLeft: 'none', borderRight: '1px solid var(--border)' }}>
          <div className="topbar">
            <span className="brand">CHAT</span>
          </div>
          <section className="chat">
            <div className="chatLog" ref={chatLogRef}>
              {chat.messages.length ? null : (
                <div className="msg">
                  <div className="msgRole">assistant</div>
                  <div className="msgBubble msgBubbleAssistant">
                    Hi! Open a project, then ask me anything. I can read/write files and run commands to help you build.
                  </div>
                </div>
              )}
              {chat.messages.map((m) => (
                <div className="msg" key={m.id}>
                  <div className="msgRole">{m.role}</div>
                  <div className={m.role === 'assistant' ? 'msgBubble msgBubbleAssistant' : 'msgBubble'}>
                    {m.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown> : m.content}
                  </div>
                </div>
              ))}
            </div>
            <div className="chatInputContainer">
              <div className="chatInputWrapper">
                <textarea
                  className="chatInput"
                  placeholder={projectRoot ? 'Ask devcode...' : 'Open a folder to start...'}
                  value={chatDraft}
                  disabled={!projectRoot || chatBusy}
                  onChange={(e) => setChatDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void sendChat()
                    }
                  }}
                />
                <div className="chatInputActions">
                  <div className="chatInputButtons"></div>
                  <button className="primaryBtn" disabled={!projectRoot || chatBusy || !chatDraft.trim()} onClick={() => void sendChat()}>
                    Send
                  </button>
                </div>
              </div>
            </div>
          </section>
        </aside>
      )}

      {/* Main Editor Area */}
      <main className="mainArea">
        <div className="editorArea">
          {openFiles.length > 0 ? (
            <div className="editorTabs">
              {openFiles.map(p => (
                <div 
                  key={p} 
                  className={activePath === p ? 'editorTab active' : 'editorTab'}
                  onClick={() => setActivePath(p)}
                >
                  <FileIcon name={p.split('/').pop() || ''} size={14} style={{ opacity: 0.7 }} />
                  {p.split('/').pop()}
                  {dirtyFiles[p] && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)' }} />}
                  <div className="iconBtn" style={{ width: 20, height: 20, marginLeft: 4 }} onClick={(e) => closeFile(p, e)}>
                    <X size={14} />
                  </div>
                </div>
              ))}
              <div className="grow" />
              <div className="tabsGroup">
                <button className={tab === 'editor' ? 'tabBtn tabBtnActive' : 'tabBtn'} onClick={() => setTab('editor')}>
                  <Code size={14} style={{ marginRight: 4 }} /> Editor
                </button>
                <button className={tab === 'preview' ? 'tabBtn tabBtnActive' : 'tabBtn'} onClick={() => setTab('preview')}>
                  <Play size={14} style={{ marginRight: 4 }} /> Preview
                </button>
              </div>
            </div>
          ) : (
            <div className="editorTabs">
               <div className="grow" />
               <div className="tabsGroup">
                 <button className={tab === 'preview' ? 'tabBtn tabBtnActive' : 'tabBtn'} onClick={() => setTab('preview')}>
                   <Play size={14} style={{ marginRight: 4 }} /> Preview
                 </button>
               </div>
            </div>
          )}

          <div className="mainBody">
            {!projectRoot ? (
              <div className="empty">
                <div className="card">
                  <div className="cardTitle">devcode</div>
                  <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                    Start by opening a folder to enable the workspace.
                  </div>
                  <button className="primaryBtn" onClick={() => void openProjectFolder()} style={{ marginTop: 8 }}>
                    <Folder size={16} /> Open Folder
                  </button>
                </div>
              </div>
            ) : tab === 'preview' ? (
              previewUrl ? (
                <iframe className="iframe" src={previewUrl} />
              ) : (
                <div className="empty">
                  <div className="card">
                    <div className="cardTitle">Preview</div>
                    <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                      Run a dev server in the terminal (e.g. npm run dev) and the URL will appear here.
                    </div>
                  </div>
                </div>
              )
            ) : activePath ? (
              <Editor
                height="100%"
                language={guessLanguage(activePath)}
                value={fileContents[activePath] || ''}
                theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                onChange={(v) => {
                  setFileContents(prev => ({ ...prev, [activePath]: v ?? '' }))
                  setDirtyFiles(prev => ({ ...prev, [activePath]: true }))
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  fontFamily: 'ui-monospace, Consolas, monospace',
                  wordWrap: 'on',
                  padding: { top: 16 },
                  scrollBeyondLastLine: false,
                  lineHeight: 24,
                  fontLigatures: true,
                }}
              />
            ) : (
              <div className="empty">
                <div className="card" style={{ background: 'transparent', boxShadow: 'none', border: 'none' }}>
                  <div className="cardTitle" style={{ opacity: 0.5 }}>devcode</div>
                  <div style={{ color: 'var(--muted)', fontSize: 13, display: 'flex', gap: 16, marginTop: 16 }}>
                    <span><kbd>Ctrl</kbd> + <kbd>S</kbd> to Save</span>
                    <span><kbd>Enter</kbd> to Send Chat</span>
                  </div>
                </div>
              </div>
            )}
            
            {activePath && dirtyFiles[activePath] && tab === 'editor' && (
              <button 
                className="primaryBtn" 
                style={{ position: 'absolute', bottom: 16, right: 16, boxShadow: 'var(--shadow)' }}
                onClick={() => void saveFile()}
              >
                <Save size={14} /> Save File
              </button>
            )}
          </div>
        </div>

        {/* Bottom Terminal */}
        {showTerminal && (
          <section className="terminalPanel">
            <div className="terminalTabs">
              <div className="terminalTab active">TERMINAL</div>
              <div className="grow" />
              {urls.length > 0 && (
                <div className="chip" style={{ cursor: 'pointer' }} onClick={() => { setPreviewUrl(urls[0]); setTab('preview') }}>
                  {urls[0]}
                </div>
              )}
              <div className="iconBtn" style={{ width: 24, height: 24 }} onClick={() => setShowTerminal(false)}>
                <X size={14} />
              </div>
            </div>
            <div className="terminalContent" style={{ padding: '8px 12px' }}>
              <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
            </div>
          </section>
        )}
      </main>

      {/* Explorer Sidebar (Right) */}
      {showExplorer && (
        <aside className="explorerSidebar" style={{ borderRight: 'none', borderLeft: '1px solid var(--border)' }}>
          <div className="topbar">
            <span className="brand">EXPLORER</span>
            <div className="grow" />
            <button className="iconBtn" onClick={() => void refreshTree()} title="Refresh">
              <RefreshCcw size={14} />
            </button>
          </div>
          <div className="fileTree">
            {projectRoot ? (
              flattened.map((r) => {
                const pad = 16 + r.depth * 12
                const active = r.type === 'file' && r.path === activePath
                return (
                  <div
                    key={r.path}
                    className={active ? 'treeRow treeRowActive' : 'treeRow'}
                    style={{ paddingLeft: `${pad}px` }}
                    onClick={() => {
                      if (r.type === 'dir') {
                        setExpanded((s) => ({ ...s, [r.path]: !(s[r.path] ?? false) }))
                      } else {
                        void loadFile(r.path)
                      }
                    }}
                  >
                    {r.type === 'dir' ? (
                      <ChevronRight size={14} style={{ transform: expanded[r.path] || (r.path === '.' && expanded['.']) ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', opacity: 0.5 }} />
                    ) : (
                      <FileIcon name={r.name} size={14} style={{ marginLeft: 2 }} />
                    )}
                    <span className="treeLabel">{r.name}</span>
                    {r.truncated ? <span className="chip">…</span> : null}
                    {dirtyFiles[r.path] && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', marginLeft: 'auto' }} />}
                  </div>
                )
              })
            ) : (
              <div style={{ padding: 16, textAlign: 'center' }}>
                <button className="primaryBtn" style={{ margin: '0 auto' }} onClick={() => void openProjectFolder()}>
                  Open Folder
                </button>
              </div>
            )}
          </div>
          
          {/* Logo at the bottom right */}
          <div style={{ padding: 32, display: 'flex', justifyContent: 'center', alignItems: 'center', borderTop: '1px solid var(--border)', background: 'var(--panel-2)' }}>
            <img 
              src={logo} 
              alt="devcode logo" 
              style={{ 
                width: '100%', 
                maxWidth: 200, 
                height: 'auto', 
                objectFit: 'contain',
                opacity: 0.9,
                filter: theme === 'dark' ? 'drop-shadow(0 0 16px rgba(59,130,246,0.2))' : 'drop-shadow(0 4px 12px rgba(0,0,0,0.05))'
              }} 
            />
          </div>
        </aside>
      )}
      </div>
    </div>
  )
}

function FileIcon({ name, size, style }: { name: string; size: number; style?: React.CSSProperties }) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return <FileText size={size} style={style} />
  
  if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) return <FileCode size={size} style={{ ...style, color: '#f59e0b' }} />
  if (['json', 'jsonc'].includes(ext)) return <FileJson size={size} style={{ ...style, color: '#10b981' }} />
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext)) return <ImageIcon size={size} style={{ ...style, color: '#8b5cf6' }} />
  if (['css', 'scss', 'less'].includes(ext)) return <FileType size={size} style={{ ...style, color: '#3b82f6' }} />
  if (['html', 'htm'].includes(ext)) return <Code size={size} style={{ ...style, color: '#ef4444' }} />
  if (['md', 'txt'].includes(ext)) return <FileText size={size} style={{ ...style, color: '#64748b' }} />
  
  return <FileText size={size} style={style} />
}

export default App

function guessLanguage(p: string) {
  const ext = p.split('.').pop()?.toLowerCase()
  if (!ext) return 'plaintext'
  if (ext === 'ts') return 'typescript'
  if (ext === 'tsx') return 'typescript'
  if (ext === 'js') return 'javascript'
  if (ext === 'jsx') return 'javascript'
  if (ext === 'json') return 'json'
  if (ext === 'css') return 'css'
  if (ext === 'html') return 'html'
  if (ext === 'md') return 'markdown'
  if (ext === 'py') return 'python'
  if (ext === 'go') return 'go'
  if (ext === 'rs') return 'rust'
  return 'plaintext'
}
