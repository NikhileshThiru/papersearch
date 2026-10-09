import { test } from "node:test";
import assert from "node:assert/strict";
import { levenshtein } from "./levenshtein.js";

test("identical strings have distance 0", () => {
  assert.equal(levenshtein("network", "network"), 0);
});

test("distance to an empty string is the other string's length", () => {
  assert.equal(levenshtein("", "neural"), 6);
  assert.equal(levenshtein("neural", ""), 6);
  assert.equal(levenshtein("", ""), 0);
});

test("counts single insertions, deletions, and substitutions", () => {
  assert.equal(levenshtein("netwrk", "network"), 1); // insertion
  assert.equal(levenshtein("transformmer", "transformer"), 1); // deletion
  assert.equal(levenshtein("nueral", "neural"), 2); // transposition = 2 substitutions
});

test("classic example: kitten -> sitting", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
});

test("is symmetric", () => {
  assert.equal(levenshtein("atention", "attention"), levenshtein("attention", "atention"));
});
