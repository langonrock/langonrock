import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

export const APP = 'langonrock'
export const DATA_ENV = 'LANGONROCK_DATA'

export interface HostContext {
  platform: string
  env: Record<string, string | undefined>
  home: string
}

/**
 * Pure, and takes the host as an argument rather than reading globals, so the
 * Windows and Linux branches are testable from a Mac. The path separator is
 * pinned per platform for the same reason: `join` would otherwise follow the
 * host, and a Windows path built on Linux would come out with forward slashes.
 */
export function platformDataDir(context: HostContext): string {
  if (context.platform === 'win32') {
    const local = context.env['LOCALAPPDATA']

    return win32.join(
      local === undefined || local === ''
        ? win32.join(context.home, 'AppData', 'Local')
        : local,
      APP
    )
  }

  if (context.platform === 'darwin') {
    return posix.join(context.home, 'Library', 'Application Support', APP)
  }

  const xdg = context.env['XDG_DATA_HOME']

  return posix.join(
    xdg === undefined || xdg === ''
      ? posix.join(context.home, '.local', 'share')
      : xdg,
    APP
  )
}

/** Explicit flag beats environment beats platform default. */
export function resolveDataDir(flag?: string): string {
  if (flag !== undefined && flag !== '') {
    return flag
  }

  const override = process.env[DATA_ENV]

  if (override !== undefined && override !== '') {
    return override
  }

  return platformDataDir({
    platform: process.platform,
    env: process.env,
    home: homedir()
  })
}
