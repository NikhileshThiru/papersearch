import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "./query-parser.js";

test("stems words and drops stopwords", () => {
  const q = parseQuery("the neural networks");
  assert.deepEqual(q.tokens, ["neural", "network"]);
  assert.equal(q.requireAll, false);
});

test("deduplicates tokens that share a stem", () => {
  assert.deepEqual(parseQuery("network networks networking").tokens, ["network"]);
});

test("extracts quoted phrases with consecutive offsets", () => {
  const q = parseQuery('"neural networks" training');
  assert.deepEqual(q.phrases, [{ tokens: ["neural", "network"], offsets: [0, 1] }]);
  assert.deepEqual(q.tokens, ["neural", "network", "train"]);
});

test("phrase offsets keep the gaps left by stopwords", () => {
  const q = parseQuery('"foundations of machine learning"');
  assert.deepEqual(q.phrases[0], {
    tokens: ["foundat", "machin", "learn"],
    offsets: [0, 2, 3],
  });
});

test("-term and NOT term both exclude", () => {
  for (const raw of ["learning -deep", "learning NOT deep"]) {
    const q = parseQuery(raw);
    assert.deepEqual(q.tokens, ["learn"], raw);
    assert.deepEqual(q.excluded, ["deep"], raw);
  }
});

test("AND requires all terms; OR is the default", () => {
  assert.equal(parseQuery("deep AND learning").requireAll, true);
  const or = parseQuery("deep OR learning");
  assert.equal(or.requireAll, false);
  assert.deepEqual(or.tokens, ["deep", "learn"]);
});

test("field prefix sets the field hint", () => {
  const q = parseQuery("title:transformer");
  assert.equal(q.fieldHint, "title");
  assert.deepEqual(q.tokens, ["transform"]);
});

test("parentheses are stripped rather than glued to terms", () => {
  const q = parseQuery("bert AND (classification OR generation)");
  assert.deepEqual(q.tokens, ["bert", "classif", "gener"]);
  assert.equal(q.requireAll, true);
});

test("a query of only stopwords yields no tokens", () => {
  assert.deepEqual(parseQuery("the of and").tokens, []);
});
