export {}

declare global {
  interface Window {
    devcode?: {
      selectFolder: () => Promise<string | null>
      getState: () => Promise<Record<string, unknown>>
      setState: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>
      getVersion: () => Promise<string>
      downloadAndInstall: (url: string, version?: string) => Promise<boolean>
      
      fsTree: (root: string, dir?: string) => Promise<import('./lib/types').FsTree>
      fsRead: (root: string, path: string) => Promise<string>
      fsWrite: (root: string, path: string, content: string) => Promise<boolean>
      fsWatch: (root: string, callback: (data: { event: string, path: string }) => void) => Promise<boolean>
    }
  }
}
