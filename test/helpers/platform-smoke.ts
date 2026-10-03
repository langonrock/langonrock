import {
  flushFile,
  orderWrites,
  replaceFile,
  tryLock
} from '../../src/db/platform.ts'

const root = Bun.argv[2]

if (
  root === undefined ||
  !Bun.embeddedFiles.some(
    file =>
      'name' in file &&
      typeof file.name === 'string' &&
      file.name.endsWith('.node')
  )
) {
  throw new Error(
    'smoke test requires an embedded native adapter and a temporary directory'
  )
}

const release = tryLock(`${root}/lock`)

if (release === undefined || tryLock(`${root}/lock`) !== undefined) {
  throw new Error('embedded adapter failed mutual exclusion')
}

release()
await Bun.write(`${root}/candidate`, 'embedded adapter works')
orderWrites(`${root}/candidate`)
replaceFile(`${root}/candidate`, `${root}/published`)
flushFile(`${root}/published`)

if ((await Bun.file(`${root}/published`).text()) !== 'embedded adapter works') {
  throw new Error('embedded adapter failed file publication')
}

process.stdout.write('native executable smoke passed\n')
