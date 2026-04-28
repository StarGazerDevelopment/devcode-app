export {}

declare global {
  interface Window {
    devcode?: {
      selectFolder: () => Promise<string | null>
      getState: () => Promise<Record<string, unknown>>
      setState: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>
      getVersion: () => Promise<string>
      downloadAndInstall: (url: string) => Promise<boolean>
    }
  }
}
