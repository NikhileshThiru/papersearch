import { test } from "node:test";
import assert from "node:assert/strict";
import { bm25Score, computeIdf, computeTf, BM25_K1 } from "@workspace/db/bm25";

test("IDF is higher for rarer terms", () => {
  const N = 1000;
  assert.ok(computeIdf(N, 1) > computeIdf(N, 10));
  assert.ok(computeIdf(N, 10) > computeIdf(N, 500));
});

test("IDF stays positive even for a term in every document", () => {
  assert.ok(computeIdf(1000, 1000) > 0);
});

test("TF is the term's share of the field, and 0 for an empty field", () => {
  assert.equal(computeTf(3, 12), 0.25);
  assert.equal(computeTf(0, 0), 0);
});

test("score grows with TF but saturates below idf * (k1 + 1)", () => {
  const idf = 2;
  const low = bm25Score(idf, 0.1, 50, 50);
  const mid = bm25Score(idf, 0.5, 50, 50);
  const high = bm25Score(idf, 100, 50, 50);
  assert.ok(low < mid && mid < high);
  assert.ok(high < idf * (BM25_K1 + 1));
});

test("longer-than-average fields score lower for the same TF", () => {
  const short = bm25Score(2, 0.2, 20, 50);
  const average = bm25Score(2, 0.2, 50, 50);
  const long = bm25Score(2, 0.2, 200, 50);
  assert.ok(short > average && average > long);
});

test("zero average length scores 0 instead of dividing by zero", () => {
  assert.equal(bm25Score(2, 0.5, 10, 0), 0);
});
