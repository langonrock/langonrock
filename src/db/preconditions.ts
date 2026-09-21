import { ConflictError } from './errors.ts'

export function assertSourceVersion(
  current: string | undefined,
  replaces: string | undefined
): void {
  if (current === replaces) {
    return
  }

  const reason =
    replaces === undefined
      ? 'concept already exists'
      : current === undefined
        ? 'concept does not exist'
        : 'concept changed since it was read'

  throw new ConflictError(
    `${reason}: re-read the concept and retry with its new hash`
  )
}
