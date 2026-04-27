export type ApiOk<T> = { ok: true } & T
export type ApiErr = { ok: false; error: string }
export type ApiResult<T> = ApiOk<T> | ApiErr

const API_BASE = 'http://localhost:3030'

async function parseJson(res: Response) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { ok: false, error: text || `HTTP ${res.status}` }
  }
}

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const res = await fetch(url, { method: 'GET' })
  return (await parseJson(res)) as ApiResult<T>
}

export async function apiPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await parseJson(res)) as ApiResult<T>
}

export function sse(path: string) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  return new EventSource(url)
}
