import { mkdir } from 'node:fs/promises'

const CACHE = `${import.meta.dir}/.cache`

const GUTENBERG_START = /^\*\*\* START OF THE PROJECT GUTENBERG EBOOK.*$/m
const GUTENBERG_END = /^\*\*\* END OF THE PROJECT GUTENBERG EBOOK.*$/m

/**
 * The real corpora are downloaded once and reused, so only the first run needs
 * a network. They are not vendored because they are larger than the repository
 * that would carry them.
 */
export async function fetchText(name: string, url: string): Promise<string> {
  const path = `${CACHE}/${name}`
  const cached = Bun.file(path)

  if (await cached.exists()) {
    return cached.text()
  }

  const response = await fetch(url).catch((cause: unknown) => {
    throw new Error(`${name} is not cached and ${url} is unreachable`, {
      cause
    })
  })

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`)
  }

  const text = await response.text()

  await mkdir(CACHE, { recursive: true })
  await Bun.write(path, text)

  return text
}

/** Everything between the two licence banners, which is the work itself. */
export function gutenbergBody(text: string): string {
  const start = GUTENBERG_START.exec(text)
  const end = GUTENBERG_END.exec(text)

  return text.slice(
    start === null ? 0 : start.index + start[0].length,
    end === null ? text.length : end.index
  )
}

/** Rewraps hard-wrapped plain text into paragraphs, blank line separated. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map(block => block.replace(/\s*\n\s*/g, ' ').trim())
    .filter(block => block !== '')
}
