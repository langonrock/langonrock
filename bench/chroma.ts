import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { estimateTokens, openTenant, putTenantRoot } from '../src/index.ts'
import { bill, score } from './billing.ts'
import { PROFILES } from './profiles.ts'

import type { Turn } from './billing.ts'
import type { Question } from './questions.ts'

const HERE = import.meta.dir
const SOURCE = `${HERE}/.corpus-chroma`
const STORE = `${HERE}/.store-chroma`
const K = 8
const CHUNK_CHARS = 1000
const CHUNK_OVERLAP = 200

/**
 * A vector database answers the retrieval half of what this store does and none
 * of the addressing half, so the comparison is drawn on the two things both
 * sides really do: rank the corpus, and put the answer in the context window.
 * Chroma is given the compiled bodies the store serves rather than the raw
 * Markdown, so neither side is billed for text the other never ships.
 *
 * `bun bench/chroma.ts [profile] [bundles] [concepts per bundle]` prints one
 * JSON line whose fields pair with the ones `bun bench/run.ts` prints for the
 * same profile.
 */
interface Hit {
  key: string
  concept: string
  chars: number
  metaChars: number
}

interface Grain {
  count: number
  buildMs: number
  queryMs: number
  diskMb: number
  named: Hit[][]
  described: Hit[][]
}

interface ChromaOutput {
  chromaVersion: string
  doc: Grain
  chunk: Grain
  rssMb: number
}

/**
 * `estimateTokens` over a length rather than a string. The Python harness
 * reports how many characters each result carried instead of shipping the text
 * back, and this keeps both sides on the one crude estimator the bench uses.
 */
function tokensOf(chars: number): number {
  return Math.ceil(chars / 4)
}

/** The ground truth and the two lookups every billing function needs. */
interface Ask {
  questions: Question[]
  wanted: string[]
  bodyTokens: (id: string) => number
  resolve: (id: string) => string
}

function conceptIds(hits: Hit[]): string[] {
  const seen: string[] = []

  for (const hit of hits) {
    if (!seen.includes(hit.concept)) {
      seen.push(hit.concept)
    }
  }

  return seen
}

/**
 * What a plain `query` costs: every result arrives with its text, so the whole
 * top-k enters the context whether or not it answered anything. No fetch turn
 * follows, and a manifest-only question still costs a query because there is no
 * corpus map to have read once. Keyed per question, which is how the other
 * harness bills a search result: the call is made and its payload appended even
 * when a previous question happened to rank the same documents.
 */
function payloadTurns(runs: Hit[][]): Turn[] {
  return runs.map((hits, index) => ({
    parts: [
      {
        key: `query:${index}`,
        tokens: hits.reduce((sum, hit) => sum + tokensOf(hit.chars), 0)
      }
    ]
  }))
}

/** The metadata-only form of the same call, ranked rows and no bodies. */
function rowTurn(hits: Hit[], index: number): Turn {
  return {
    parts: [
      {
        key: `rows:${index}`,
        tokens: hits.reduce((sum, hit) => sum + tokensOf(hit.metaChars), 0)
      }
    ]
  }
}

/**
 * The frugal usage: rank on metadata alone, then pull the bodies. Charged for
 * delivering the question's stated ground truth, the same contract the store is
 * held to, which is where Chroma pays for having no section addressing — `get`
 * returns the document or nothing.
 */
function fetchTurns(runs: Hit[][], ask: Ask): Turn[] {
  return runs.flatMap((hits, index): Turn[] => {
    const question = ask.questions[index]

    if (question === undefined) {
      return []
    }

    const turns: Turn[] = [rowTurn(hits, index)]

    if (!question.manifestOnly) {
      turns.push({
        parts: question.targets.map(target => {
          const id = ask.resolve(target.id)

          return { key: `body:${id}`, tokens: ask.bodyTokens(id) }
        })
      })
    }

    return turns
  })
}

interface ChunkFetch {
  turns: Turn[]
  fallbacks: number
}

/**
 * Chunking is Chroma's answer to sub-document addressing, so it gets the shape
 * `find` has: rank, then pull one passage. The passage charged is the best
 * ranked chunk of the concept the question actually wants; when the top-k holds
 * no chunk of it, the only recourse left is the whole document, and the count of
 * those is reported rather than hidden.
 */
function chunkFetchTurns(runs: Hit[][], ask: Ask): ChunkFetch {
  const turns: Turn[] = []
  let fallbacks = 0

  for (const [index, hits] of runs.entries()) {
    const question = ask.questions[index]

    if (question === undefined) {
      continue
    }

    turns.push(rowTurn(hits, index))

    if (question.manifestOnly) {
      continue
    }

    const wanted = ask.resolve(question.wanted)
    const passage = hits.find(hit => hit.concept === wanted)

    if (passage === undefined) {
      fallbacks++
      turns.push({
        parts: [{ key: `body:${wanted}`, tokens: ask.bodyTokens(wanted) }]
      })
    } else {
      turns.push({
        parts: [
          { key: `chunk:${passage.key}`, tokens: tokensOf(passage.chars) }
        ]
      })
    }
  }

  return { turns, fallbacks }
}

async function runChroma(payload: unknown): Promise<ChromaOutput> {
  const dir = await mkdtemp(`${tmpdir()}/langonrock-chroma-io-`)
  const input = `${dir}/in.json`
  const output = `${dir}/out.json`

  await Bun.write(input, JSON.stringify(payload))

  const proc = Bun.spawn(
    [
      'uv',
      'run',
      '--quiet',
      '--with',
      'chromadb',
      '--python',
      '3.12',
      'python',
      `${HERE}/chroma.py`,
      input,
      output
    ],
    { stdout: 'inherit', stderr: 'inherit' }
  )

  if ((await proc.exited) !== 0) {
    throw new Error('the Chroma harness failed')
  }

  const parsed = (await Bun.file(output).json()) as ChromaOutput

  await rm(dir, { recursive: true, force: true })

  return parsed
}

function parseArgs(argv: string[]): {
  name: string
  bundles: number
  perBundle: number
} {
  const named = argv[0] !== undefined && argv[0] in PROFILES
  const sizes = named ? argv.slice(1) : argv

  return {
    name: named ? (argv[0] as string) : 'reference',
    bundles: Number(sizes[0] ?? 1),
    perBundle: Number(sizes[1] ?? 500)
  }
}

function grainReport(grain: Grain, ask: Ask) {
  return {
    count: grain.count,
    buildMs: grain.buildMs,
    queryMs: grain.queryMs,
    diskMb: grain.diskMb,
    named: score(grain.named.map(conceptIds), ask.wanted),
    described: score(grain.described.map(conceptIds), ask.wanted),
    payloadSession: bill(payloadTurns(grain.named)),
    fetchSession: bill(fetchTurns(grain.named, ask)),
    resultTokens: Math.round(
      grain.named.reduce(
        (sum, hits) =>
          sum + hits.reduce((inner, hit) => inner + tokensOf(hit.chars), 0),
        0
      ) / grain.named.length
    ),
    rowTokens: Math.round(
      grain.named.reduce(
        (sum, hits) =>
          sum + hits.reduce((inner, hit) => inner + tokensOf(hit.metaChars), 0),
        0
      ) / grain.named.length
    )
  }
}

async function main(): Promise<void> {
  const { name, bundles, perBundle } = parseArgs(process.argv.slice(2))
  const profile = PROFILES[name]

  if (profile === undefined) {
    throw new Error(`unknown profile "${name}"`)
  }

  const { corpus, questions } = await profile.build(SOURCE, {
    bundles,
    perBundle
  })

  await rm(STORE, { recursive: true, force: true })
  await putTenantRoot(SOURCE, { root: STORE, tenant: 'bench' })

  const reader = await openTenant(STORE, 'bench')
  const bodies = new Map(await reader.bodies())
  const ids = new Set(reader.ids)
  const bundleOf = new Map(
    corpus.concepts.map(concept => [concept.id, concept.bundle])
  )
  const resolve = (id: string): string =>
    ids.has(id) ? id : `${bundleOf.get(id) ?? ''}/${id}`
  const summaryOf = new Map(
    corpus.concepts.map(concept => [resolve(concept.id), concept.description])
  )
  const bodyTokens = (id: string): number =>
    estimateTokens(bodies.get(id) ?? '')
  const chroma = await runChroma({
    profile: name,
    k: K,
    chunkChars: CHUNK_CHARS,
    chunkOverlap: CHUNK_OVERLAP,
    concepts: reader.ids.map(id => ({
      id,
      title: reader.titles.get(id) ?? '',
      summary: summaryOf.get(id) ?? '',
      body: bodies.get(id) ?? ''
    })),
    questions: questions.map(question => ({
      named: question.named,
      described: question.described
    }))
  })

  const ask: Ask = {
    questions,
    wanted: questions.map(question => resolve(question.wanted)),
    bodyTokens,
    resolve
  }
  const chunkFetch = chunkFetchTurns(chroma.chunk.named, ask)

  process.stdout.write(
    `${JSON.stringify({
      profile: name,
      chromaVersion: chroma.chromaVersion,
      concepts: reader.ids.length,
      chunkChars: CHUNK_CHARS,
      chunkOverlap: CHUNK_OVERLAP,
      doc: grainReport(chroma.doc, ask),
      chunk: grainReport(chroma.chunk, ask),
      chunkPassageSession: bill(chunkFetch.turns),
      chunkPassageFallbacks: chunkFetch.fallbacks,
      rssMb: chroma.rssMb
    })}\n`
  )

  await rm(SOURCE, { recursive: true, force: true })
  await rm(STORE, { recursive: true, force: true })
}

await main()
