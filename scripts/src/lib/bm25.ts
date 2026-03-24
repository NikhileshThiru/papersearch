/**
 * BM25 scoring functions.
 *
 * BM25 parameters (tunable):
 *   k1 = 1.5  — term frequency saturation
 *   b  = 0.75 — document length normalization
 *
 * Field boost multipliers applied at query time (defined here for reference):
 *   title    — 2.0
 *   abstract — 1.0
 *   authors  — 0.5
 */

export const BM25_K1 = 1.5;
export const BM25_B = 0.75;

export const FIELD_BOOSTS: Record<string, number> = {
  title: 2.0,
  abstract: 1.0,
  authors: 0.5,
};

/**
 * Compute BM25 IDF for a term.
 *
 * Formula: log((N - df + 0.5) / (df + 0.5) + 1)
 *
 * @param N  — total number of documents in the corpus
 * @param df — document frequency of the term
 */
export function computeIdf(N: number, df: number): number {
  return Math.log((N - df + 0.5) / (df + 0.5) + 1);
}

/**
 * Compute normalized term frequency for a field.
 *
 * Formula: count(term in field) / total_tokens_in_field
 *
 * @param termCount       — how many times the term appears in the field
 * @param totalTokens     — total token count in the field (after stemming/stopword removal)
 */
export function computeTf(termCount: number, totalTokens: number): number {
  if (totalTokens === 0) return 0;
  return termCount / totalTokens;
}

/**
 * Compute the BM25 score contribution of a single (term, doc, field) triple.
 *
 * Formula:
 *   idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl))
 *
 * @param idf    — precomputed IDF from the terms table
 * @param tf     — normalized TF from the postings table
 * @param dl     — document length (token count) for this field
 * @param avgdl  — average document length across the corpus for this field
 */
export function bm25Score(
  idf: number,
  tf: number,
  dl: number,
  avgdl: number,
): number {
  if (avgdl === 0) return 0;
  const numerator = tf * (BM25_K1 + 1);
  const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl));
  return idf * (numerator / denominator);
}
