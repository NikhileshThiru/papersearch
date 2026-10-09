import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { parseQuery, stemWord, type FieldHint, type Phrase } from "./query-parser.js";
import { levenshtein } from "./levenshtein.js";
import { bm25Score, FIELD_BOOSTS } from "@workspace/db";

export interface SearchOptions {
  page?: number;
  pageSize?: number;
  yearFrom?: number;
  yearTo?: number;
  fieldOfStudy?: string;
  minCitations?: number;
  /** If true, all non-excluded tokens must match (AND). Default: false (OR). */
  requireAll?: boolean;
}

export interface SearchResult {
  id: number;
  paper_id: string;
  title: string;
  abstract: string | null;
  authors: Array<{ name: string; id?: string }> | null;
  year: number | null;
  venue: string | null;
  citation_count: number | null;
  fields_of_study: string[] | null;
  external_ids: Record<string, string> | null;
  score: number;
}

export interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  results: SearchResult[];
  suggestion?: string;
}

interface PostingRow {
  term_id: number;
  term: string;
  idf: number;
  doc_id: number;
  field: string;
  tf: number;
  positions: number[];
}

interface IndexStats {
  total_docs: number;
  avgdl_title: number;
  avgdl_abstract: number;
}

async function loadIndexStats(): Promise<IndexStats> {
  const rows = await db.execute(
    sql`SELECT key, value FROM index_stats WHERE key IN ('total_docs', 'avgdl_title', 'avgdl_abstract')`,
  );
  const map: Record<string, number> = {};
  for (const row of rows.rows as unknown as Array<{ key: string; value: number }>) {
    map[row.key] = row.value;
  }
  return {
    total_docs: Math.round(map["total_docs"] ?? 0),
    avgdl_title: map["avgdl_title"] ?? 1,
    avgdl_abstract: map["avgdl_abstract"] ?? 1,
  };
}

function avgdlForField(field: string, stats: IndexStats): number {
  if (field === "title") return stats.avgdl_title;
  if (field === "abstract") return stats.avgdl_abstract;
  return 10;
}

/**
 * Fetch all postings for the given terms (both query tokens and excluded terms).
 * Including excluded terms in the fetch allows us to identify and remove their docs.
 */
async function fetchPostings(
  allTerms: string[],
  fieldHint: FieldHint | null,
): Promise<PostingRow[]> {
  if (allTerms.length === 0) return [];

  const termList = allTerms.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");
  const fieldClause = fieldHint ? sql`AND p.field = ${fieldHint}` : sql``;

  const result = await db.execute(sql`
    SELECT t.id AS term_id, t.term, t.idf, p.doc_id, p.field, p.tf, p.positions
    FROM terms t
    JOIN postings p ON p.term_id = t.id
    WHERE t.term IN (${sql.raw(termList)})
    ${fieldClause}
  `);

  return result.rows as unknown as PostingRow[];
}

/**
 * Aggregate BM25 scores per document from posting rows for query tokens only.
 * Excluded terms are handled separately.
 */
function aggregateScores(
  postings: PostingRow[],
  queryTokens: string[],
  stats: IndexStats,
): Map<number, number> {
  const querySet = new Set(queryTokens);
  const scores = new Map<number, number>();

  for (const row of postings) {
    if (!querySet.has(row.term)) continue;

    const boost = FIELD_BOOSTS[row.field] ?? 1.0;
    const avgdl = avgdlForField(row.field, stats);
    const count = row.positions ? row.positions.length : 1;
    const dl = count > 0 && row.tf > 0 ? Math.round(count / row.tf) : avgdl;

    const bm25 = bm25Score(row.idf, row.tf, dl, avgdl) * boost;

    scores.set(row.doc_id, (scores.get(row.doc_id) ?? 0) + bm25);
  }

  return scores;
}

/**
 * Check phrase constraint: all phrase tokens must appear at their relative
 * offsets (consecutive, allowing for removed stopwords) in at least one field.
 */
function matchesPhrase(
  docId: number,
  phrases: Phrase[],
  postings: PostingRow[],
): boolean {
  if (phrases.length === 0) return true;

  const posMap = new Map<string, number[]>();
  for (const row of postings) {
    if (row.doc_id !== docId) continue;
    const key = `${row.term}::${row.field}`;
    const existing = posMap.get(key);
    if (existing) {
      existing.push(...(row.positions ?? []));
    } else {
      posMap.set(key, [...(row.positions ?? [])]);
    }
  }

  for (const { tokens: phraseTokens, offsets } of phrases) {
    if (phraseTokens.length === 0) continue;
    let phraseMatched = false;

    for (const field of ["title", "abstract", "authors"]) {
      const firstPositions = posMap.get(`${phraseTokens[0]}::${field}`);
      if (!firstPositions?.length) continue;

      for (const startPos of firstPositions) {
        let ok = true;
        for (let i = 1; i < phraseTokens.length; i++) {
          const positions = posMap.get(`${phraseTokens[i]}::${field}`);
          if (!positions?.includes(startPos + offsets[i]!)) {
            ok = false;
            break;
          }
        }
        if (ok) { phraseMatched = true; break; }
      }
      if (phraseMatched) break;
    }

    if (!phraseMatched) return false;
  }

  return true;
}

interface DocumentRow {
  id: number;
  paper_id: string;
  title: string;
  abstract: string | null;
  authors: Array<{ name: string; id?: string }> | null;
  year: number | null;
  venue: string | null;
  citation_count: number | null;
  fields_of_study: string[] | null;
  external_ids: Record<string, string> | null;
}

async function fetchDocuments(
  docIds: number[],
  opts: SearchOptions,
): Promise<DocumentRow[]> {
  if (docIds.length === 0) return [];

  const idList = docIds.join(", ");
  const conditions: ReturnType<typeof sql>[] = [sql`d.id IN (${sql.raw(idList)})`];

  if (opts.yearFrom !== undefined) conditions.push(sql`d.year >= ${opts.yearFrom}`);
  if (opts.yearTo !== undefined) conditions.push(sql`d.year <= ${opts.yearTo}`);
  if (opts.fieldOfStudy) {
    const fields = opts.fieldOfStudy.split(",").map((f) => f.trim()).filter(Boolean);
    if (fields.length === 1) {
      conditions.push(sql`d.fields_of_study::text ILIKE ${"%" + fields[0] + "%"}`);
    } else if (fields.length > 1) {
      const orParts = fields.map((f) => sql`d.fields_of_study::text ILIKE ${"%" + f + "%"}`);
      const orClause = orParts.reduce((acc, part) => sql`${acc} OR ${part}`);
      conditions.push(sql`(${orClause})`);
    }
  }
  if (opts.minCitations !== undefined) {
    conditions.push(sql`d.citation_count >= ${opts.minCitations}`);
  }

  const whereClause = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  const result = await db.execute(sql`
    SELECT d.id, d.paper_id, d.title, d.abstract, d.authors, d.year,
           d.venue, d.citation_count, d.fields_of_study, d.external_ids
    FROM documents d
    WHERE ${whereClause}
  `);

  return result.rows as unknown as DocumentRow[];
}

/**
 * Find the closest vocabulary term (Levenshtein <= 2) for each missed token.
 * Returns a map from missed token to the correction's display (unstemmed) form.
 */
async function findCorrections(missedTokens: string[]): Promise<Map<string, string>> {
  const result = await db.execute(sql`
    SELECT term, display_term FROM terms WHERE doc_freq >= 1 ORDER BY doc_freq DESC LIMIT 10000
  `);

  const vocab = result.rows as unknown as Array<{ term: string; display_term: string | null }>;
  const corrections = new Map<string, string>();

  for (const missed of missedTokens) {
    let best: string | undefined;
    let bestDist = Infinity;
    for (const candidate of vocab) {
      const dist = levenshtein(missed, candidate.term);
      if (dist < bestDist && dist <= 2) {
        bestDist = dist;
        best = candidate.display_term ?? candidate.term;
      }
    }
    if (best) corrections.set(missed, best);
  }

  return corrections;
}

/**
 * Main search function.
 *
 * Flow: parseQuery → fetchPostings (query + excluded terms) → aggregateScores →
 *       AND filter → exclusion filter → phrase filter → fetchDocuments (with
 *       metadata filters) → paginate → typo suggestion
 *
 * Boolean semantics:
 *   - Default (OR): any doc matching at least one query token is a candidate.
 *   - requireAll=true or boolean AND in query: all query tokens must appear.
 *   - Exclusion: any doc containing an excluded term is removed.
 *   - Phrases: all phrase tokens must appear at consecutive positions
 *     (stopword gaps allowed).
 */
export async function search(
  rawQuery: string,
  opts: SearchOptions = {},
): Promise<SearchResponse> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 10));

  const parsed = parseQuery(rawQuery);

  if (parsed.tokens.length === 0) {
    return { total: 0, page, pageSize, results: [] };
  }

  // Fetch postings for query tokens AND excluded terms in one pass.
  const allTerms = [...new Set([...parsed.tokens, ...parsed.excluded])];
  const [postings, stats] = await Promise.all([
    fetchPostings(allTerms, parsed.fieldHint),
    loadIndexStats(),
  ]);

  // Typo tolerance: rewrite every query word whose stem has zero hits to its
  // closest vocabulary term, so the suggestion is a full corrected query.
  let suggestion: string | undefined;
  const foundTerms = new Set(postings.map((p) => p.term));
  const missedTokens = parsed.tokens.filter((t) => !foundTerms.has(t));
  if (missedTokens.length > 0) {
    const corrections = await findCorrections(missedTokens);
    if (corrections.size > 0) {
      suggestion = rawQuery.replace(
        /[a-z0-9]+/gi,
        (word) => corrections.get(stemWord(word)) ?? word,
      );
    }
  }

  // Score all candidate documents using only query tokens.
  const scores = aggregateScores(postings, parsed.tokens, stats);

  // Build per-doc term presence set for AND filtering.
  const docTerms = new Map<number, Set<string>>();
  for (const row of postings) {
    if (!parsed.tokens.includes(row.term)) continue;
    const existing = docTerms.get(row.doc_id);
    if (existing) {
      existing.add(row.term);
    } else {
      docTerms.set(row.doc_id, new Set([row.term]));
    }
  }

  // Collect docs that contain any excluded term.
  const excludedDocIds = new Set<number>();
  for (const row of postings) {
    if (parsed.excluded.includes(row.term)) {
      excludedDocIds.add(row.doc_id);
    }
  }

  // Apply filters: AND, exclusions, phrases.
  const requireAll = opts.requireAll ?? parsed.requireAll;
  const candidateDocIds = [...scores.keys()].filter((docId) => {
    if (excludedDocIds.has(docId)) return false;
    if (requireAll) {
      const present = docTerms.get(docId);
      if (!present) return false;
      for (const token of parsed.tokens) {
        if (!present.has(token)) return false;
      }
    }
    return matchesPhrase(docId, parsed.phrases, postings);
  });

  // Sort by BM25 score descending.
  candidateDocIds.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));

  // Fetch document metadata with optional filters. Fetch all candidates so
  // total reflects the filtered set, then paginate in memory.
  const docs = await fetchDocuments(candidateDocIds, opts);

  // Re-sort by original score order (metadata filter may have removed some docs).
  const docMap = new Map(docs.map((d) => [d.id, d]));
  const filteredSorted = candidateDocIds.filter((id) => docMap.has(id));

  const total = filteredSorted.length;
  const start = (page - 1) * pageSize;
  const pageSlice = filteredSorted.slice(start, start + pageSize);

  const results: SearchResult[] = pageSlice.map((docId) => ({
    ...docMap.get(docId)!,
    score: scores.get(docId) ?? 0,
  }));

  const response: SearchResponse = { total, page, pageSize, results };
  if (suggestion) response.suggestion = suggestion;
  return response;
}
