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
import { generate } from './corpus.ts'
import { buildQuestions } from './questions.ts'

import type { TenantIndex, TenantReader } from '../src/index.ts'
import type { Turn } from './billing.ts'
import type { Corpus } from './corpus.ts'
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

  const targets = store.questions[7]?.targets ?? []

  return median(20, () =>
    reader.get(
      targets.map(target => store.resolve(target.id)),
      'schema'
    )
  )
}

async function indexCosts(reader: TenantReader) {
  const before = memory()
  const indexBuildMs = await median(2, () => buildTenantIndex(reader))
  const built = await buildTenantIndex(reader)
  const after = memory()

  return {
    built,
    indexBuildMs,
    queryMs: await median(20, async () =>
      searchTenant(built, 'orders grain join refunds', { k: K })
    ),
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
    searchTokens: average(
      questions.map(question =>
        estimateTokens(searchTenant(built, question.named, { k: K }))
      )
    )
  }
}

function storeTurns(store: Store): Turn[] {
  return store.questions.flatMap((question): Turn[] => {
    const turns: Turn[] = [
      { parts: [{ key: 'manifest', tokens: store.manifestTokens }] }
    ]

    if (question.manifestOnly) {
      return turns
    }

    turns.push({
      parts: question.targets.map(target => {
        const key = `${store.resolve(target.id)}#${target.section}`

        return { key, tokens: store.section.get(key) ?? 0 }
      })
    })

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

async function okfSide(corpus: Corpus, questions: Question[]) {
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
  const targets = questions[7]?.targets ?? []
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
      searchConcepts(bundle, index, 'orders grain join refunds', K)
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

async function main(): Promise<void> {
  const bundles = Number(process.argv[2] ?? 1)
  const perBundle = Number(process.argv[3] ?? 500)
  const corpus = await generate(SOURCE, { bundles, perBundle })
  const compiled = await compile(corpus)
  const indexed = await indexCosts(compiled.reader)
  const ids = new Set(compiled.reader.ids)
  const bundleOf = new Map(
    corpus.concepts.map(concept => [concept.id, concept.bundle])
  )
  const store: Store = {
    built: indexed.built,
    questions: buildQuestions(corpus.concepts),
    manifestTokens: compiled.manifestTokens,
    resolve: id => (ids.has(id) ? id : `${bundleOf.get(id) ?? ''}/${id}`),
    section: new Map(),
    whole: new Map()
  }

  const getMs = await conceptCosts(compiled.reader, store)
  const found = retrieval(store)
  const okf = await okfSide(corpus, store.questions)
  const targets = store.questions.flatMap(question => question.targets)

  await rm(SOURCE, { recursive: true, force: true })
  await rm(STORE, { recursive: true, force: true })

  process.stdout.write(
    `${JSON.stringify({
      concepts: compiled.reader.ids.length,
      bundles,
      corpusTokens: okf.corpusTokens,
      indexTokens: okf.indexTokens,
      manifestTokens: compiled.manifestTokens,
      manifestPerConcept: compiled.manifestTokens / compiled.reader.ids.length,
      sliceTokens: compiled.sliceTokens,
      snapshotMb: compiled.put.bytes / 1024 / 1024,
      okfSession: bill(
        okfTurns(store.questions, okf.indexTokens, okf.tokensOf)
      ),
      storeSession: bill(storeTurns(store)),
      okfConceptTokens: average(targets.map(t => okf.tokensOf(t.id))),
      wholeConceptTokens: average(
        targets.map(t => store.whole.get(store.resolve(t.id)) ?? 0)
      ),
      sectionConceptTokens: average(
        targets.map(
          t => store.section.get(`${store.resolve(t.id)}#${t.section}`) ?? 0
        )
      ),
      searchTokens: found.searchTokens,
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
  )
}

await main()
