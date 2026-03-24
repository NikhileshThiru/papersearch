import natural from "natural";

const { WordTokenizer, PorterStemmer, stopwords } = natural;

const tokenizer = new WordTokenizer();
const STOPWORDS = new Set(stopwords);

export type FieldHint = "title" | "abstract" | "authors";

export interface ParsedQuery {
  tokens: string[];
  phrases: string[][];
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
 *   -term               — exclude documents containing this term
 *   title:transformer   — restrict token to a specific field
 *   AND                 — sets requireAll=true (all tokens must appear)
 *   OR                  — default behavior, ignored explicitly
 *   bare words          — stemmed tokens
 */
export function parseQuery(raw: string): ParsedQuery {
  const phrases: string[][] = [];
  const excluded: string[] = [];
  let fieldHint: FieldHint | null = null;
  let requireAll = false;
  const tokens: string[] = [];

  let input = raw.trim();

  // Extract quoted phrases first.
  const phraseRegex = /"([^"]+)"/g;
  let phraseMatch: RegExpExecArray | null;
  while ((phraseMatch = phraseRegex.exec(input)) !== null) {
    const phraseTokens = tokenizeText(phraseMatch[1]!);
    if (phraseTokens.length > 0) {
      phrases.push(phraseTokens);
      tokens.push(...phraseTokens);
    }
  }
  input = input.replace(phraseRegex, " ");

  const words = input.split(/\s+/).filter(Boolean);

  for (const word of words) {
    if (word.toUpperCase() === "AND") {
      requireAll = true;
      continue;
    }
    if (word.toUpperCase() === "OR") {
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

    // Exclusion: -term
    if (word.startsWith("-") && word.length > 1) {
      excluded.push(...tokenizeText(word.slice(1)));
      continue;
    }

    // Regular stemmed word
    const lower = word.toLowerCase();
    if (STOPWORDS.has(lower)) continue;
    const stemmed = PorterStemmer.stem(lower);
    if (stemmed) tokens.push(stemmed);
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
