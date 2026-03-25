export interface SemanticScholarAuthor {
  authorId: string | null;
  name: string;
}

export interface SemanticScholarExternalIds {
  DOI?: string;
  ArXiv?: string;
  PubMed?: string;
  DBLP?: string;
  [key: string]: string | undefined;
}

export interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract: string | null;
  authors: SemanticScholarAuthor[];
  year: number | null;
  venue: string | null;
  citationCount: number;
  fieldsOfStudy: string[] | null;
  externalIds: SemanticScholarExternalIds | null;
}

interface SearchResponse {
  total: number;
  offset: number;
  next?: number;
  data: SemanticScholarPaper[];
}

const BASE_URL = "https://api.semanticscholar.org/graph/v1";
const FIELDS =
  "title,abstract,authors,year,venue,citationCount,externalIds,fieldsOfStudy";

const MAX_RETRY_ATTEMPTS = 8;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders(): HeadersInit {
  const apiKey = process.env["SEMANTIC_SCHOLAR_API_KEY"];
  return apiKey ? { "x-api-key": apiKey } : {};
}

async function fetchWithBackoff(
  url: string,
  attempt = 0,
): Promise<Response> {
  if (attempt >= MAX_RETRY_ATTEMPTS) {
    throw new Error(
      `[semantic-scholar] Exceeded max retry attempts (${MAX_RETRY_ATTEMPTS}) for URL: ${url}`,
    );
  }

  const res = await fetch(url, { headers: buildHeaders() });

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    const delay = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : Math.min(1000 * 2 ** attempt, 60_000);
    console.log(
      `[semantic-scholar] Rate limited. Waiting ${delay}ms before retry (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`,
    );
    await sleep(delay);
    return fetchWithBackoff(url, attempt + 1);
  }

  return res;
}

export async function* searchPapers(
  query: string,
  { limit = Infinity, pageSize = 10 }: { limit?: number; pageSize?: number } = {},
): AsyncGenerator<SemanticScholarPaper> {
  let offset = 0;
  let fetched = 0;

  while (fetched < limit) {
    const batchSize = Math.min(pageSize, limit - fetched);
    const url = `${BASE_URL}/paper/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=${batchSize}&fields=${FIELDS}`;

    const res = await fetchWithBackoff(url);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Semantic Scholar API error ${res.status}: ${body}`,
      );
    }

    const data: SearchResponse = (await res.json()) as SearchResponse;

    if (!data.data || data.data.length === 0) {
      break;
    }

    for (const paper of data.data) {
      yield paper;
      fetched++;
      if (fetched >= limit) break;
    }

    if (data.next === undefined || data.next >= data.total) {
      break;
    }

    offset = data.next;

    await sleep(2000);
  }
}
