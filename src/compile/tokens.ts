const CHARS_PER_TOKEN = 4

/**
 * Deliberately crude. This exists to compare one manifest against another as
 * the compiler changes, not to predict a bill. Swapping in a real tokenizer
 * would add a dependency for precision nothing here needs.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}
