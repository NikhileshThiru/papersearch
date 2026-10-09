import natural from "natural";

const { WordTokenizer, PorterStemmer, stopwords } = natural;

const tokenizer = new WordTokenizer();
const STOPWORDS = new Set(stopwords);

export type FieldHint = "title" | "abstract" | "authors";

/**
 * A quoted phrase: stemmed tokens plus each token's position relative to the
 * first one. Offsets keep the gaps left by removed stopwords, matching how the
 * indexer records positions.
 */
export interface Phrase {
  tokens: string[];
  offsets: number[];
}

export interface ParsedQuery {
  tokens: string[];
  phrases: Phrase[];
  excluded: string[];
  fieldHint: FieldHint | null;
  requireAll: boolean;
  raw: string;
}

function tokenizeText(text: string): string[] {
  const raw = tokenizer.tokenize(text.toLowerCase()) ?? [];
  return raw
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => PorterStemmer.stem(w))
    .filter(Boolean);
}

function tokenizePhrase(text: string): Phrase {
  const raw = tokenizer.tokenize(text.toLowerCase()) ?? [];
  const tokens: string[] = [];
  const positions: number[] = [];
  raw.forEach((w, i) => {
    if (!w || STOPWORDS.has(w)) return;
    const stemmed = PorterStemmer.stem(w);
    if (!stemmed) return;
    tokens.push(stemmed);
    positions.push(i);
  });
  return { tokens, offsets: positions.map((p) => p - positions[0]!) };
}

/** Stem a single word the same way query and index tokens are stemmed. */
export function stemWord(word: string): string {
  return PorterStemmer.stem(word.toLowerCase());
}

const FIELD_ALIASES: Record<string, FieldHint> = {
  title: "title",
  t: "title",
  abstract: "abstract",
  abs: "abstract",
  authors: "authors",
  author: "authors",
  au: "authors",
};

/**
 * Parse a raw query string into a structured query.
 *
 * Supported syntax:
 *   "neural networks"   — phrase (position-consecutive match required)
 *   -term / NOT term    — exclude documents containing this term
 *   title:transformer   — restrict token to a specific field
 *   AND                 — sets requireAll=true (all tokens must appear)
 *   OR                  — default behavior, ignored explicitly
 *   ( )                 — ignored; grouping is not supported
 *   bare words          — stemmed tokens
 */
export function parseQuery(raw: string): ParsedQuery {
  const phrases: Phrase[] = [];
  const excluded: string[] = [];
  let fieldHint: FieldHint | null = null;
  let requireAll = false;
  const tokens: string[] = [];

  let input = raw.trim();

  // Extract quoted phrases first.
  const phraseRegex = /"([^"]+)"/g;
  let phraseMatch: RegExpExecArray | null;
  while ((phraseMatch = phraseRegex.exec(input)) !== null) {
    const phrase = tokenizePhrase(phraseMatch[1]!);
    if (phrase.tokens.length > 0) {
      phrases.push(phrase);
      tokens.push(...phrase.tokens);
    }
  }
  input = input.replace(phraseRegex, " ");

  const words = input
    .split(/\s+/)
    .map((w) => w.replace(/^\(+|\)+$/g, ""))
    .filter(Boolean);

  let negateNext = false;
  for (const word of words) {
    const upper = word.toUpperCase();
    if (upper === "AND") {
      requireAll = true;
      continue;
    }
    if (upper === "OR") {
      continue;
    }
    if (upper === "NOT") {
      negateNext = true;
      continue;
    }

    // Exclusion: -term or NOT term
    if (negateNext || (word.startsWith("-") && word.length > 1)) {
      excluded.push(...tokenizeText(word.replace(/^-/, "")));
      negateNext = false;
      continue;
    }

    // Field-scoped: field:term
    const fieldMatch = /^(\w+):(.+)$/i.exec(word);
    if (fieldMatch) {
      const alias = fieldMatch[1]!.toLowerCase();
      const value = fieldMatch[2]!;
      if (alias in FIELD_ALIASES) {
        fieldHint = FIELD_ALIASES[alias]!;
        tokens.push(...tokenizeText(value));
        continue;
      }
    }

    // Regular word — tokenized like the indexer, so stray punctuation is dropped.
    tokens.push(...tokenizeText(word));
  }

  // Deduplicate tokens preserving order.
  const seen = new Set<string>();
  const uniqueTokens = tokens.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });

  return { tokens: uniqueTokens, phrases, excluded, fieldHint, requireAll, raw };
}
