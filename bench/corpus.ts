import { mkdir, rm, writeFile } from 'node:fs/promises'

/**
 * A corpus shaped like Google's OKF samples: v0.2 frontmatter, prose written
 * for people, headings the compiler can address, and links between concepts.
 *
 * Descriptions are deliberately distinctive. An earlier version gave every
 * table the same "One row per X record" sentence, which made retrieval by
 * description look far worse than it is: the queries were ambiguous, not the
 * index.
 */
function rng(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state

    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T
}

const DOMAINS = [
  'orders',
  'customers',
  'payments',
  'sessions',
  'events',
  'products',
  'shipments',
  'refunds',
  'subscriptions',
  'invoices',
  'campaigns',
  'inventory',
  'suppliers',
  'reviews',
  'carts',
  'coupons'
] as const

const QUALIFIERS = [
  'daily',
  'raw',
  'enriched',
  'staging',
  'curated',
  'archive',
  'eu',
  'us',
  'legacy',
  'v2'
] as const

const SUBJECTS: Record<string, string> = {
  orders: 'checkout that cleared payment',
  customers: 'registered shopper, churned included',
  payments: 'settled card or wallet authorisation',
  sessions: 'browsing visit, anonymous traffic stitched in',
  events: 'clickstream hit from the web and mobile SDKs',
  products: 'sellable item at its current revision',
  shipments: 'parcel handed to a carrier, with its scans',
  refunds: 'return or chargeback paid back to a shopper',
  subscriptions: 'recurring plan and its billing cycle',
  invoices: 'document issued to a business buyer',
  campaigns: 'paid marketing effort and its spend',
  inventory: 'warehouse stock level, snapshotted nightly',
  suppliers: 'vendor the company buys from',
  reviews: 'shopper rating and its moderation state',
  carts: 'basket in progress, abandoned ones included',
  coupons: 'discount code and its redemption count'
}

const FACETS = [
  'partitioned by ingest date and clustered on the surrogate key',
  'rebuilt nightly from the operational replica, never streamed',
  'soft deletes only, so an unfiltered count overstates reality',
  'timestamps are UTC apart from two legacy columns kept for finance',
  'backfilled to 2019 from the warehouse that preceded the migration',
  'deduplicated on ingest timestamp within a six hour replay window'
] as const

const COLUMN_TYPES = [
  'STRING',
  'INT64',
  'TIMESTAMP',
  'NUMERIC',
  'BOOL'
] as const

const TRUST = ['high', 'medium', 'low'] as const

const STATUS = [
  'current',
  'current',
  'current',
  'current',
  'draft',
  'deprecated'
] as const

export interface GeneratedConcept {
  id: string
  path: string
  bundle: string
  kind: 'table' | 'metric'
  grain: string
  links: string[]
  title: string
  description: string
}

function titleCase(value: string): string {
  return value
    .split('_')
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function names(random: () => number, count: number, tag: string): string[] {
  const shared = Math.min(Math.round(count * 0.2), DOMAINS.length)
  const taken = new Set<string>()
  const out: string[] = []

  for (let index = 0; index < shared; index++) {
    const name = DOMAINS[index % DOMAINS.length] as string

    taken.add(name)
    out.push(name)
  }

  let index = 0

  while (out.length < count) {
    const base = DOMAINS[index % DOMAINS.length] as string
    const round = Math.floor(index / DOMAINS.length)
    const name = `${base}_${tag}_${pick(random, QUALIFIERS)}${round === 0 ? '' : `_${round}`}`

    if (!taken.has(name)) {
      taken.add(name)
      out.push(name)
    }

    index++
  }

  return out
}

function frontmatter(concept: GeneratedConcept, random: () => number): string {
  const type = concept.kind === 'metric' ? 'Metric' : 'BigQuery Table'
  const lines = [
    '---',
    `type: ${type}`,
    `title: ${concept.title}`,
    `description: ${concept.description}`,
    `resource: https://console.cloud.google.com/bigquery?p=${concept.bundle}&d=warehouse&t=${concept.id}`,
    `tags: [${concept.bundle}, ${concept.kind}, ${concept.id.split('_')[0]}]`,
    `timestamp: 2026-0${1 + Math.floor(random() * 6)}-1${Math.floor(random() * 9)}T14:30:00Z`,
    'sources:',
    `  - url: https://wiki.acme.test/data/${concept.id}`,
    `    trust: ${pick(random, TRUST)}`,
    `  - url: https://github.com/acme/warehouse/blob/main/models/${concept.id}.sql`,
    `    trust: ${pick(random, TRUST)}`,
    'generated: 2026-05-20T09:00:00Z',
    `verified: 2026-0${1 + Math.floor(random() * 6)}-01`,
    `status: ${pick(random, STATUS)}`,
    'stale_after: 2026-12-01'
  ]

  if (concept.grain !== '-') {
    lines.push(`grain: ${concept.grain}`)
  }

  lines.push('---')

  return lines.join('\n')
}

function schemaTable(id: string, random: () => number): string {
  const rows = 6 + Math.floor(random() * 8)
  const lines = [
    '| column | type | description |',
    '| --- | --- | --- |',
    `| ${id.split('_')[0]}_id | STRING | Primary key, surrogate, generated at ingest time. |`
  ]

  for (let index = 0; index < rows; index++) {
    const column = `${pick(random, DOMAINS)}_${pick(random, ['at', 'code', 'amount', 'status', 'count', 'ref'])}`

    lines.push(
      `| ${column} | ${pick(random, COLUMN_TYPES)} | Populated by the nightly load; null before the 2024 backfill. |`
    )
  }

  return lines.join('\n')
}

function tableBody(
  concept: GeneratedConcept,
  random: () => number,
  facet: string
): string {
  const [first, second] = concept.links
  const linkTo = (target: string | undefined): string =>
    target === undefined
      ? 'the warehouse catalogue'
      : `[${titleCase(target)}](../tables/${target}.md)`

  return [
    `${concept.description} It is ${facet}, and it is the table people mean when they talk about ${concept.id.split('_')[0]} in the ${concept.bundle} domain.`,
    '',
    '# Schema',
    '',
    schemaTable(concept.id, random),
    '',
    `The grain is ${concept.grain}, meaning one row per ${concept.grain.replace(/_id$/, '')}.`,
    '',
    '# Common query patterns',
    '',
    '```sql',
    '-- # daily volume, partition pruned',
    'SELECT DATE(created_at) AS day, COUNT(*) AS n',
    `FROM \`acme.warehouse.${concept.id}\``,
    'GROUP BY day',
    '```',
    '',
    'Always filter on the partition column first; a full scan is expensive.',
    '',
    '# Joins',
    '',
    `Joined with ${linkTo(first)} on the shared surrogate key, and with ${linkTo(second)} when you need the monetary side of the record.`,
    '',
    '# Caveats',
    '',
    `Rows are soft deleted rather than removed. ${facet[0]?.toUpperCase()}${facet.slice(1)}.`
  ].join('\n')
}

function metricBody(concept: GeneratedConcept): string {
  const [source] = concept.links

  return [
    `${concept.description} This is the definition the weekly business review uses.`,
    '',
    '# Definition',
    '',
    `Computed over the reporting window, net of refunds and tax, sourced from ${source === undefined ? 'the warehouse' : `[${titleCase(source)}](../tables/${source}.md)`}.`,
    '',
    '# Owner',
    '',
    'Owned by the analytics guild; changes need review because dashboards pin it.',
    '',
    '# Caveats',
    '',
    'Not comparable across regions before the currency normalisation landed.'
  ].join('\n')
}

const SLICES: Record<string, string> = {
  daily: 'rolled up per day',
  raw: 'straight off the ingest topic',
  enriched: 'with dimensions joined in',
  staging: 'pre validation, do not report from it',
  curated: 'the reviewed serving copy',
  archive: 'closed periods only',
  eu: 'EU region',
  us: 'US region',
  legacy: 'from the pre migration warehouse',
  v2: 'second generation model'
}

/**
 * Distinctive but short. Bloating the summary to make concepts distinguishable
 * would inflate the manifest, which is the very thing being measured.
 */
function describe(kind: 'table' | 'metric', name: string): string {
  const [root, , qualifier] = name.split('_')
  const subject = SUBJECTS[root ?? ''] ?? `a ${root} record`
  const slice =
    qualifier === undefined ? '' : `, ${SLICES[qualifier] ?? qualifier}`

  if (kind === 'metric') {
    return `Net ${root} recognised in the reporting window${slice}.`
  }

  return `One row per ${subject}${slice}.`
}

function build(
  bundle: string,
  tag: string,
  count: number,
  random: () => number
): { concepts: GeneratedConcept[]; facets: Map<string, string> } {
  const pool = names(random, count, tag)
  const tables = pool.filter((_, index) => index % 4 !== 3)
  const concepts: GeneratedConcept[] = []
  const facets = new Map<string, string>()

  for (const [index, name] of pool.entries()) {
    const isMetric = index % 4 === 3
    const links: string[] = []

    for (let offset = 1; offset <= (isMetric ? 1 : 2); offset++) {
      const target = tables[(index + offset * 3) % tables.length]

      if (target !== undefined && target !== name && !links.includes(target)) {
        links.push(target)
      }
    }

    const facet = FACETS[index % FACETS.length] as string

    facets.set(name, facet)
    concepts.push({
      id: name,
      path: `${isMetric ? 'metrics' : 'tables'}/${name}.md`,
      bundle,
      kind: isMetric ? 'metric' : 'table',
      grain: isMetric ? '-' : `${name.split('_')[0]}_id`,
      links,
      title: titleCase(name),
      description: describe(isMetric ? 'metric' : 'table', name)
    })
  }

  return { concepts, facets }
}

function indexFile(bundle: string, items: GeneratedConcept[]): string {
  return [
    '---',
    'type: Index',
    `title: ${titleCase(bundle)}`,
    '---',
    '',
    `# ${titleCase(bundle)}`,
    '',
    'Every concept in this bundle, with a one line summary.',
    '',
    ...items.map(
      item => `- [${item.title}](./${item.path}) — ${item.description}`
    )
  ].join('\n')
}

export interface Corpus {
  root: string
  concepts: GeneratedConcept[]
  bundles: string[]
}

export async function generate(
  root: string,
  options: { bundles: number; perBundle: number; seed?: number }
): Promise<Corpus> {
  await rm(root, { recursive: true, force: true })

  const random = rng(options.seed ?? 7)
  const concepts: GeneratedConcept[] = []
  const bundles: string[] = []

  for (let index = 0; index < options.bundles; index++) {
    const name = options.bundles === 1 ? 'warehouse' : `domain${index + 1}`
    const { concepts: items, facets } = build(
      name,
      `b${index + 1}`,
      options.perBundle,
      random
    )

    bundles.push(name)

    await mkdir(`${root}/${name}/tables`, { recursive: true })
    await mkdir(`${root}/${name}/metrics`, { recursive: true })
    await writeFile(`${root}/${name}/index.md`, indexFile(name, items))
    await Promise.all(
      items.map(item =>
        writeFile(
          `${root}/${name}/${item.path}`,
          `${frontmatter(item, random)}\n\n${
            item.kind === 'metric'
              ? metricBody(item)
              : tableBody(item, random, facets.get(item.id) ?? '')
          }\n`
        )
      )
    )

    concepts.push(...items)
  }

  return { root, concepts, bundles }
}
