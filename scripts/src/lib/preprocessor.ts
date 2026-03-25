import natural from "natural";

const { WordTokenizer, PorterStemmer, stopwords } = natural;

const tokenizer = new WordTokenizer();
const STOPWORDS = new Set(stopwords);

export interface TokenizedField {
  tokens: string[];    // stemmed forms
  originals: string[]; // unstemmed forms (parallel to tokens)
  positions: number[];
}

export interface PreprocessedDocument {
  title: TokenizedField;
  abstract: TokenizedField;
  authors: TokenizedField;
}

function tokenizeField(text: string): TokenizedField {
  const raw = tokenizer.tokenize(text.toLowerCase()) ?? [];
  const tokens: string[] = [];
  const originals: string[] = [];
  const positions: number[] = [];

  for (let i = 0; i < raw.length; i++) {
    const word = raw[i];
    if (!word || STOPWORDS.has(word)) continue;
    const stemmed = PorterStemmer.stem(word);
    if (!stemmed) continue;
    tokens.push(stemmed);
    originals.push(word);
    positions.push(i);
  }

  return { tokens, originals, positions };
}

export function preprocessDocument(
  title: string,
  abstract: string | null | undefined,
  authors: Array<{ name: string; id?: string | null }> | null | undefined,
): PreprocessedDocument {
  const authorText = (authors ?? []).map((a) => a.name).join(" ");

  return {
    title: tokenizeField(title),
    abstract: tokenizeField(abstract ?? ""),
    authors: tokenizeField(authorText),
  };
}
