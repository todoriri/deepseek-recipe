/*
 * Unit tests for the Prompt Studio token-probability and distillation logic.
 *
 * Run from the repository root:
 *   node --test encoding-decoding-demo/tests/
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const Distill = require(path.join(__dirname, "..", "static", "distill.js"));

const EOS = Distill.EOS;

/** Two reasoning tokens followed by two answer tokens. */
const THINKING_OUTPUT = "<think>Bonjour means hello.</think>Bonjour." + EOS;

const CHAT_LOGPROBS = {
  content: [
    {
      token: "Bon",
      logprob: -0.010,
      top_logprobs: [
        { token: "Bon", logprob: -0.010 },
        { token: "Salut", logprob: -4.600 },
      ],
    },
    {
      token: "jour",
      logprob: -0.693,
      top_logprobs: [
        { token: "jour", logprob: -0.693 },
        { token: "soir", logprob: -1.098 },
      ],
    },
    {
      token: ".",
      logprob: -0.020,
      top_logprobs: [
        { token: ".", logprob: -0.020 },
        { token: "!", logprob: -4.500 },
      ],
    },
  ],
  reasoning_content: [
    {
      token: "Bonjour",
      logprob: -0.105,
      top_logprobs: [
        { token: "Bonjour", logprob: -0.105 },
        { token: "Hello", logprob: -2.302 },
      ],
    },
    {
      token: " means hello.",
      logprob: -0.020,
      top_logprobs: [
        { token: " means hello.", logprob: -0.020 },
        { token: " is hello.", logprob: -4.000 },
      ],
    },
  ],
};

function sortedStreamNames(parsed) {
  return parsed.streams.map((stream) => stream.name);
}

test("parseLogprobs reads reasoning before content from a Chat Completions response", () => {
  const parsed = Distill.parseLogprobs({ choices: [{ logprobs: CHAT_LOGPROBS }] });
  assert.deepEqual(sortedStreamNames(parsed), ["reasoning_content", "content"]);
  assert.equal(parsed.tokenCount, 5);
  assert.equal(parsed.tokenCountWithLogprob, 5);
  const first = parsed.streams[1].tokens[0];
  assert.equal(first.token, "Bon");
  assert.ok(Math.abs(first.probability - Math.exp(-0.010)) < 1e-9);
  assert.equal(first.top[0].token, "Bon");
  assert.equal(first.top.length, 2);
});

test("parseLogprobs accepts a bare array and computes probabilities from logprobs", () => {
  const parsed = Distill.parseLogprobs([{ token: "Hi", logprob: Math.log(0.5) }]);
  assert.equal(parsed.tokenCount, 1);
  const token = parsed.streams[0].tokens[0];
  assert.ok(Math.abs(token.probability - 0.5) < 1e-9);
  assert.deepEqual(token.top.map((item) => item.token), ["Hi"]);
});

test("parseLogprobs accepts the legacy vLLM shape", () => {
  const parsed = Distill.parseLogprobs({
    tokens: ["Bon", "jour"],
    token_logprobs: [-0.1, -0.2],
    top_logprobs: [{ Bon: -0.1, Salut: -3.0 }, { jour: -0.2, soir: -1.5 }],
  });
  assert.equal(parsed.tokenCount, 2);
  const top = parsed.streams[0].tokens[1].top.map((item) => item.token);
  assert.deepEqual(top, ["jour", "soir"]);
});

test("parseLogprobs rejects malformed JSON and reports empty payloads", () => {
  assert.throws(() => Distill.parseLogprobs("{"), /not valid JSON/);
  const parsed = Distill.parseLogprobs({ unrelated: true });
  assert.equal(parsed.tokenCount, 0);
  assert.match(parsed.warnings[0], /No token probabilities/);
});

test("parseLogprobs keeps positions whose logprob is missing", () => {
  const parsed = Distill.parseLogprobs([{ token: "Hi", logprob: -0.1 }, { token: "!" }]);
  assert.equal(parsed.tokenCount, 2);
  assert.equal(parsed.tokenCountWithLogprob, 1);
  assert.equal(parsed.streams[0].tokens[1].probability, null);
  assert.match(parsed.warnings.join(" "), /position 1 .* no logprob/);
});

test("splitOutput mirrors the decoder's framing rules", () => {
  const frame = Distill.splitOutput("<｜Assistant｜><think>Bonjour means hello.</think>Bonjour." + EOS + "ignored");
  assert.equal(frame.thinking, true);
  assert.equal(frame.truncated, true);
  assert.equal(frame.reasoning, "Bonjour means hello.");
  assert.equal(frame.content, "Bonjour.");
  assert.equal(frame.normalized, "Bonjour means hello.Bonjour.");

  const plain = Distill.splitOutput("Bonjour." + EOS);
  assert.equal(plain.thinking, false);
  assert.equal(plain.reasoning, "");
  assert.equal(plain.content, "Bonjour.");
});

test("alignment confirms probabilities that reproduce the output", () => {
  const parsed = Distill.parseLogprobs(CHAT_LOGPROBS);
  const result = Distill.alignment(parsed, THINKING_OUTPUT);
  assert.equal(result.aligned, true);
  assert.equal(result.outputText, "Bonjour means hello.Bonjour.".length);
  assert.equal(result.tokenText, result.outputText);
});

test("alignment flags probabilities that do not match the output", () => {
  const parsed = Distill.parseLogprobs(CHAT_LOGPROBS);
  const result = Distill.alignment(parsed, "<think>Bonjour means hi.</think>Bonjour." + EOS);
  assert.equal(result.aligned, false);
  assert.equal(result.streams[0].firstDiff, "Bonjour means h".length);
});

test("metrics reports perplexity, entropy, and low-confidence tokens", () => {
  const parsed = Distill.parseLogprobs(CHAT_LOGPROBS);
  const summary = Distill.metrics(parsed, { threshold: 0.95 });
  // Probabilities e^-0.01, e^-0.693, e^-0.105, e^-0.02; two fall below 0.95.
  assert.equal(summary.count, 5);
  assert.equal(summary.lowConfidence, 2);
  assert.ok(summary.meanLogprob < 0);
  assert.ok(Math.abs(summary.perplexity - Math.exp(-summary.meanLogprob)) < 1e-9);
  assert.ok(summary.meanEntropy > 0 && summary.meanEntropy < Math.log(2));
  assert.ok(summary.topKMass <= 1);
  const reasoning = summary.streams.find((stream) => stream.name === "reasoning_content");
  assert.equal(reasoning.metrics.count, 2);
});

test("metrics ignores streams without probabilities", () => {
  const parsed = Distill.parseLogprobs([1, 2, 3]);
  const summary = Distill.metrics(parsed, {});
  assert.equal(summary.count, 0);
  assert.equal(summary.perplexity, null);
  assert.equal(summary.meanProbability, null);
});

test("confidence helpers map probabilities to a stable ramp", () => {
  assert.equal(Distill.confidenceLevel(0.1), "low");
  assert.equal(Distill.confidenceLevel(0.5), "medium");
  assert.equal(Distill.confidenceLevel(0.99), "high");
  assert.equal(Distill.confidenceLevel(null), "unknown");
  assert.match(Distill.confidenceColor(1, 0.4), /^hsl\(142 72% 42% \/ 0.4\)$/);
  assert.match(Distill.confidenceColor(0, 0.4), /^hsl\(4 72% 42% \/ 0.4\)$/);
  assert.equal(Distill.confidenceColor(null, 0.4), "transparent");
  assert.equal(Distill.formatProbability(0.9876), "98.8%");
  assert.equal(Distill.formatProbability(null), "n/a");
  assert.equal(Distill.displayToken("Ġhello"), "·hello");
});

test("buildExport writes a distillation record with soft targets and a loss mask", () => {
  const parsed = Distill.parseLogprobs(CHAT_LOGPROBS);
  const streamIds = [
    [100, 101],
    [200, 201, 202],
  ];
  const exported = Distill.buildExport(parsed, {
    topK: 2,
    threshold: 0.95,
    includeIds: true,
    streamIds,
    prompt: "Translate 'good morning' into French.",
    promptIds: [1, 2, 3],
    model: "deepseek-chat",
    format: "chat_completions",
    temperature: 0.7,
    tokenizer: "v41",
  });
  assert.equal(exported.records.length, 1);
  assert.equal(exported.jsonl.split("\n").filter(Boolean).length, 1);
  const record = exported.records[0];
  assert.equal(record.prompt_ids.length, 3);
  assert.equal(record.completion, "Bonjour means hello.Bonjour.");
  assert.deepEqual(record.target_ids, [100, 101, 200, 201, 202]);
  assert.deepEqual(record.completion_ids, [100, 101, 200, 201, 202]);
  assert.deepEqual(record.loss_mask, [0, 1, 1, 0, 1]);
  assert.equal(record.topk_ids, null);
  assert.equal(record.topk_probs[0].length, 2);
  assert.ok(Math.abs(record.topk_mass[0] - (Math.exp(-0.105) + Math.exp(-2.302))) < 1e-9);
  assert.equal(record.meta.tokens, 5);
  assert.equal(record.meta.reasoning_tokens, 2);
  assert.equal(record.meta.masked_tokens, 2);
  assert.equal(record.meta.tokenizer, "v41");
  assert.deepEqual(JSON.parse(exported.jsonl.trim()).target_ids, [100, 101, 200, 201, 202]);
});

test("buildExport emits top-k IDs that the caller resolved from the vocabulary", () => {
  const parsed = Distill.parseLogprobs(CHAT_LOGPROBS);
  const [reasoning] = parsed.streams;
  reasoning.tokens[0].top[0].id = 42;
  reasoning.tokens[0].top[1].id = 77;
  const exported = Distill.buildExport(parsed, { topK: 2, includeIds: true, streamIds: [[100, 101], [200, 201]] });
  const record = exported.records[0];
  assert.deepEqual(record.topk_ids[0], [42, 77]);
  assert.deepEqual(record.topk_ids[1], [null, null]);
});

test("buildExport omits IDs when the tokenizer counts disagree", () => {
  const parsed = Distill.parseLogprobs(CHAT_LOGPROBS);
  const exported = Distill.buildExport(parsed, { streamIds: [[1], [2]], includeIds: true });
  assert.equal(exported.records[0].target_ids, null);
  assert.equal(exported.records[0].completion_ids, null);
  assert.equal(exported.stats.ids, false);
});

test("buildExport can drop a whole sample below the confidence floor", () => {
  const parsed = Distill.parseLogprobs(CHAT_LOGPROBS);
  const exported = Distill.buildExport(parsed, { minSampleProbability: 0.99 });
  assert.equal(exported.skipped, true);
  assert.equal(exported.records.length, 0);
  assert.equal(exported.jsonl, "");
});

test("buildExport can exclude reasoning tokens", () => {
  const parsed = Distill.parseLogprobs(CHAT_LOGPROBS);
  const exported = Distill.buildExport(parsed, { includeReasoning: false });
  const record = exported.records[0];
  assert.equal(record.completion, "Bonjour.");
  assert.equal(record.meta.reasoning_tokens, 0);
  assert.deepEqual([...new Set(record.tokens.map((token) => token.stream))], ["content"]);
});
