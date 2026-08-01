import { rm } from 'node:fs/promises'

import {
  buildTenantIndex,
  estimateTokens,
  openTenant,
  putTenantRoot,
  searchTenant
} from '../src/index.ts'
import {
  buildOkfIndex,
  loadBundle,
  readConcept,
  readIndex,
  searchConcepts
} from './baseline.ts'
import { average, bill, median, memory, rowIds, score } from './billing.ts'
import { PROFILES } from './profiles.ts'

import type { TenantIndex, TenantReader } from '../src/index.ts'
import type { Turn } from './billing.ts'
import type { Corpus } from './okf.ts'
import type { Question } from './questions.ts'

const HERE = import.meta.dir
const SOURCE = `${HERE}/.corpus`
const STORE = `${HERE}/.store`
const K = 8

interface Store {
  built: TenantIndex
  questions: Question[]
  manifestTokens: number
  resolve: (id: string) => string
  section: Map<string, number>
  whole: Map<string, number>
}

interface Target {
  id: string
  section: string
}

/** The question that touches the most concepts, used to time a batched read. */
function widest(questions: Question[]): Target[] {
  return questions.reduce<Target[]>(
    (best, question) =>
      question.targets.length > best.length ? question.targets : best,
    []
  )
}

async function compile(corpus: Corpus) {
  await rm(STORE, { recursive: true, force: true })

  const compileMs = await median(2, () =>
    putTenantRoot(SOURCE, { root: STORE, tenant: 'bench' })
  )
  const put = await putTenantRoot(SOURCE, { root: STORE, tenant: 'bench' })
  const openMs = await median(5, () => openTenant(STORE, 'bench'))
  const reader = await openTenant(STORE, 'bench')
  const manifest = await reader.manifest()
  const first = corpus.bundles[0] as string

  return {
    put,
    compileMs,
    openMs,
    reader,
    manifestTokens: estimateTokens(manifest),
    sliceTokens: estimateTokens(await reader.manifest(first)),
    manifestMs: await median(20, () => reader.manifest()),
    sliceMs: await median(20, () => reader.manifest(first))
  }
}

/** Section and whole-body cost of every concept the questions actually need. */
async function conceptCosts(reader: TenantReader, store: Store) {
  for (const question of store.questions) {
    for (const target of question.targets) {
      const id = store.resolve(target.id)
      const whole = await reader.get([id])
      const sliced = await reader.get([id], target.section)

      store.whole.set(id, estimateTokens(whole.get(id) ?? ''))
      store.section.set(
        `${id}#${target.section}`,
        estimateTokens(sliced.get(id) ?? whole.get(id) ?? '')
      )
    }
  }

  const targets = widest(store.questions)

  return median(20, () =>
    reader.get(
      targets.map(target => store.resolve(target.id)),
      targets[0]?.section
    )
  )
}

async function indexCosts(reader: TenantReader, probe: string) {
  const before = memory()
  const indexBuildMs = await median(2, () => buildTenantIndex(reader))
  const built = await buildTenantIndex(reader)
  const after = memory()

  return {
    built,
    indexBuildMs,
    queryMs: await median(20, async () => searchTenant(built, probe, { k: K })),
    indexMb: after.heap - before.heap,
    rssMb: after.rss
  }
}

function retrieval(store: Store) {
  const { built, questions } = store
  const wanted = questions.map(question => store.resolve(question.wanted))
  const ranked = (query: (q: Question) => string, expand: boolean) =>
    questions.map(question =>
      rowIds(searchTenant(built, query(question), { k: K, expand }))
    )

  return {
    named: score(
      ranked(q => q.named, false),
      wanted
    ),
    namedExpanded: score(
      ranked(q => q.named, true),
      wanted
    ),
    described: score(
      ranked(q => q.described, false),
      wanted
    ),
    searchCosts: questions.map(question =>
      estimateTokens(searchTenant(built, question.named, { k: K }))
    )
  }
}

function fetchTurn(store: Store, question: Question): Turn {
  return {
    parts: question.targets.map(target => {
      const key = `${store.resolve(target.id)}#${target.section}`

      return { key, tokens: store.section.get(key) ?? 0 }
    })
  }
}

/**
 * The manifest lives in the cached prompt prefix and every read is one hop off
 * it. Cheapest in round trips, and it is the whole manifest that gets re-read
 * at the cache rate on every later turn.
 */
function storeTurns(store: Store): Turn[] {
  return store.questions.flatMap((question): Turn[] => {
    const turns: Turn[] = [
      { parts: [{ key: 'manifest', tokens: store.manifestTokens }] }
    ]

    if (!question.manifestOnly) {
      turns.push(fetchTurn(store, question))
    }

    return turns
  })
}

/**
 * The strategy the MCP tool descriptions already recommend on a large tenant:
 * never read the whole manifest, rank first and fetch what ranked. Trades a
 * round trip per question for not carrying the manifest at all. Charged
 * optimistically, the same way the baseline is: the top result is assumed to
 * hold the answer.
 */
function searchTurns(store: Store, costs: number[]): Turn[] {
  return store.questions.flatMap((question, index): Turn[] => {
    const turns: Turn[] = [
      { parts: [{ key: `search:${index}`, tokens: costs[index] ?? 0 }] }
    ]

    if (!question.manifestOnly) {
      turns.push(fetchTurn(store, question))
    }

    return turns
  })
}

function okfTurns(
  questions: Question[],
  indexTokens: number,
  tokensOf: (id: string) => number
): Turn[] {
  return questions.flatMap((question): Turn[] => {
    const [head, ...rest] = question.targets
    const turns: Turn[] = [
      { parts: [{ key: 'okf:index', tokens: indexTokens }] }
    ]

    if (head !== undefined) {
      turns.push({
        parts: [{ key: `okf:${head.id}`, tokens: tokensOf(head.id) }]
      })
    }

    if (rest.length > 0) {
      turns.push({
        parts: rest.map(target => ({
          key: `okf:${target.id}`,
          tokens: tokensOf(target.id)
        }))
      })
    }

    return turns
  })
}

async function okfSide(corpus: Corpus, questions: Question[], probe: string) {
  const pathOf = new Map(
    corpus.concepts.map(concept => [
      concept.id,
      `${concept.bundle}/${concept.path}`
    ])
  )
  const loadMs = await median(1, () => loadBundle(SOURCE, [...pathOf.values()]))
  const bundle = await loadBundle(SOURCE, [...pathOf.values()])
  const buildMs = await median(1, async () => buildOkfIndex(bundle))
  const index = buildOkfIndex(bundle)
  const after = memory()
  const tokens = new Map(
    [...bundle.files].map(([path, text]) => [path, estimateTokens(text)])
  )
  const indexTokens = (
    await Promise.all(corpus.bundles.map(name => readIndex(SOURCE, name)))
  ).reduce((sum, text) => sum + estimateTokens(text), 0)
  const targets = widest(questions)
  const ranked = (query: (q: Question) => string) =>
    questions.map(
      question => searchConcepts(bundle, index, query(question), K).paths
    )
  const wanted = questions.map(question => pathOf.get(question.wanted) ?? '')

  return {
    indexTokens,
    corpusTokens: [...tokens.values()].reduce((a, b) => a + b, 0),
    tokensOf: (id: string) => tokens.get(pathOf.get(id) ?? '') ?? 0,
    loadMs,
    buildMs,
    rssMb: after.rss,
    queryMs: await median(20, async () =>
      searchConcepts(bundle, index, probe, K)
    ),
    coldMs: await median(20, async () => {
      await readIndex(SOURCE, corpus.bundles[0] as string)

      for (const target of targets) {
        await readConcept(SOURCE, pathOf.get(target.id) ?? '')
      }
    }),
    named: score(
      ranked(q => q.named),
      wanted
    ),
    described: score(
      ranked(q => q.described),
      wanted
    )
  }
}

/**
 * `bun bench/run.ts [profile] [bundles] [concepts per bundle]`. The profile is
 * optional and only the reference one reads the two sizes, so the documented
 * `1 500` form keeps working.
 */
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

interface Report {
  name: string
  corpus: Corpus
  compiled: Awaited<ReturnType<typeof compile>>
  indexed: Awaited<ReturnType<typeof indexCosts>>
  okf: Awaited<ReturnType<typeof okfSide>>
  found: ReturnType<typeof retrieval>
  store: Store
  getMs: number
}

function report(input: Report): string {
  const { name, corpus, compiled, indexed, okf, found, store, getMs } = input
  const targets = store.questions.flatMap(question => question.targets)

  return `${JSON.stringify({
    profile: name,
    concepts: compiled.reader.ids.length,
    bundles: corpus.bundles.length,
    corpusTokens: okf.corpusTokens,
    indexTokens: okf.indexTokens,
    manifestTokens: compiled.manifestTokens,
    manifestPerConcept: compiled.manifestTokens / compiled.reader.ids.length,
    sliceTokens: compiled.sliceTokens,
    snapshotMb: compiled.put.bytes / 1024 / 1024,
    okfSession: bill(okfTurns(store.questions, okf.indexTokens, okf.tokensOf)),
    storeSession: bill(storeTurns(store)),
    searchSession: bill(searchTurns(store, found.searchCosts)),
    okfConceptTokens: average(targets.map(t => okf.tokensOf(t.id))),
    wholeConceptTokens: average(
      targets.map(t => store.whole.get(store.resolve(t.id)) ?? 0)
    ),
    sectionConceptTokens: average(
      targets.map(
        t => store.section.get(`${store.resolve(t.id)}#${t.section}`) ?? 0
      )
    ),
    searchTokens: average(found.searchCosts),
    compileMs: compiled.compileMs,
    openMs: compiled.openMs,
    manifestMs: compiled.manifestMs,
    sliceMs: compiled.sliceMs,
    getMs,
    indexBuildMs: indexed.indexBuildMs,
    queryMs: indexed.queryMs,
    storeIndexMb: indexed.indexMb,
    storeRssMb: indexed.rssMb,
    okfColdMs: okf.coldMs,
    okfLoadMs: okf.loadMs,
    okfBuildMs: okf.buildMs,
    okfQueryMs: okf.queryMs,
    okfRssMb: okf.rssMb,
    okfNamed: okf.named,
    okfDescribed: okf.described,
    storeNamed: found.named,
    storeNamedExpanded: found.namedExpanded,
    storeDescribed: found.described
  })}\n`
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
  const compiled = await compile(corpus)
  const indexed = await indexCosts(compiled.reader, profile.probe)
  const ids = new Set(compiled.reader.ids)
  const bundleOf = new Map(
    corpus.concepts.map(concept => [concept.id, concept.bundle])
  )
  const store: Store = {
    built: indexed.built,
    questions,
    manifestTokens: compiled.manifestTokens,
    resolve: id => (ids.has(id) ? id : `${bundleOf.get(id) ?? ''}/${id}`),
    section: new Map(),
    whole: new Map()
  }

  const getMs = await conceptCosts(compiled.reader, store)
  const found = retrieval(store)
  const okf = await okfSide(corpus, store.questions, profile.probe)
  const line = report({
    name,
    corpus,
    compiled,
    indexed,
    okf,
    found,
    store,
    getMs
  })

  await rm(SOURCE, { recursive: true, force: true })
  await rm(STORE, { recursive: true, force: true })
  process.stdout.write(line)
}

await main()
