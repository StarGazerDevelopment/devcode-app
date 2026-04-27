export type FsEntry = {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number | null
  mtimeMs: number | null
}

export type FsTree =
  | { type: 'file'; path: string }
  | { type: 'dir'; path: string; children?: FsTree[]; truncated?: boolean }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  ts: number
}

export type Chat = { id: string; messages: ChatMessage[] }
