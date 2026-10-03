import { exportFolder } from '../db/export.ts'
import { migrate } from '../db/migration.ts'
import { resolveDataDir } from '../store/datadir.ts'

interface Flags {
  data?: string | undefined
  tenant?: string | undefined
  out?: string | undefined
  bundle?: string | undefined
  'summary-width'?: string | undefined
  'dry-run'?: boolean | undefined
}

export async function interchangeCommand(
  positionals: string[],
  flags: Flags
): Promise<number> {
  const directory = positionals[1]

  if (flags.tenant === undefined || directory === undefined) {
    throw new Error('a directory and --tenant are required')
  }

  const target = { root: resolveDataDir(flags.data), tenant: flags.tenant }
  const options = {
    dryRun: flags['dry-run'] === true,
    ...(flags.bundle === undefined ? {} : { bundle: flags.bundle }),
    ...(flags['summary-width'] === undefined
      ? {}
      : { summaryWidth: Number(flags['summary-width']) })
  }

  if (
    options.summaryWidth !== undefined &&
    (!Number.isSafeInteger(options.summaryWidth) || options.summaryWidth < 1)
  ) {
    throw new Error('--summary-width must be a positive integer')
  }

  const result =
    positionals[0] === 'export'
      ? await exportFolder(target, directory)
      : await migrate(target, directory, options)

  await Bun.write(flags.out ?? Bun.stdout, `${JSON.stringify(result)}\n`)

  return 0
}
