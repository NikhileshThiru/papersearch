export const BM25_K1 = 1.5;
export const BM25_B = 0.75;

export const FIELD_BOOSTS: Record<string, number> = {
  title: 2.0,
  abstract: 1.0,
  authors: 0.5,
};
