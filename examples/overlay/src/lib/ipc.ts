// Typed wrapper around window.coordinator (exposed via contextBridge in preload.ts)

export interface AgenticAPI {
  // Auth
  getAuthStatus: () => Promise<{ hasPinSet: boolean }>
  verifyPin: (pin: string) => Promise<{ success: boolean; isFirstTime?: boolean }>
  setPin: (pin: string) => Promise<{ success: boolean; error?: string }>
  // Screen
  captureScreen: () => Promise<{ success: boolean; dataUrl?: string; error?: string }>
  // FS
  readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>
  writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
  appendFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
  listDir: (path: string) => Promise<{ success: boolean; items?: { name: string; isDir: boolean }[]; error?: string }>
  // Exec
  runExec: (exe: string, args: string[]) => Promise<{ success: boolean; output?: string; error?: string }>
  // Window
  expandSidebar: () => void
  collapseBubble: () => void
  pinScreenOpen: () => void
  pinScreenClose: () => void
  // Events
  onToggleSidebar: (cb: () => void) => () => void
}

export const coordinator = (window as any).coordinator as AgenticAPI
