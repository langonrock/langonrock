import { estimateTokens } from '../compile/tokens.ts'

export const ADVICE_RATIO = 20

/**
 * Whether to read the whole manifest or to search first is a property of the
 * corpus, and the store can compute it instead of leaving the model to guess.
 * The cut compares the manifest against one estimated search result: across
 * the eight bench profiles, manifest-first wins every corpus where the whole
 * manifest costs up to ~10x a result and search-first wins from ~28x up, so
 * 20 sits in the gap and classifies all eight correctly. Deterministic: same
 * manifest, same advice.
 *
 * A string in, a string out, with nothing underneath but arithmetic, so a
 * client that only ever holds a manifest can reach the same conclusion the
 * MCP server states in its tool description.
 */
export function adviceFor(manifest: string): string {
  const lines = manifest.split('\n').filter(line => line !== '')
  const columns = lines.find(line => line.startsWith('id\t')) ?? ''
  const rows = lines.filter(
    line => !line.startsWith('#') && !line.startsWith('id\t')
  )
  const tokens = Number(estimateTokens(manifest).toPrecision(2))
  const label = tokens.toLocaleString('en-US')
  const whole = `This tenant's manifest measures ~${label} tokens; reading it whole is cheaper than searching.`

  if (rows.length === 0) {
    return whole
  }

  const meanRow =
    rows.reduce((sum, row) => sum + row.length + 1, 0) / rows.length
  // One result: a few header lines, the columns line, and up to k direct
  // plus k linked rows at the default k of 8.
  const resultChars = 120 + columns.length + meanRow * Math.min(16, rows.length)

  return manifest.length > ADVICE_RATIO * resultChars
    ? `This tenant's manifest measures ~${label} tokens; prefer "search" over reading it whole.`
    : whole
}
