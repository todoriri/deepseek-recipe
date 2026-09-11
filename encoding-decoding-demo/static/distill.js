/*
 * Token-probability and distillation helpers for Prompt Studio.
 *
 * This file contains only pure functions: it parses `logprobs` payloads
 * produced by an inference backend, aligns them with the model output,
 * summarises their confidence, and turns them into distillation records.
 * Nothing here runs inference; the probabilities always come from the caller.
 *
 * The module works both in the browser (as `window.Distill`) and in Node
 * (through `module.exports`), so the export format is unit tested.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Distill = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** The EOS marker the decoder treats as the end of a completion. */
  const EOS = "<｜end▁of▁sentence｜>";
  const ASSISTANT = "<｜Assistant｜>";
  const THINK_START = "<think>";
  const THINK_END = "</think>";

  /* ---------------------------------------------------------------- *
   * Small helpers
   * ---------------------------------------------------------------- */

  function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /** First argument that is a finite number, or null. */
  function firstNumber() {
    for (const value of arguments) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return null;
  }

  /** Probability that never exceeds 1 and never falls below 0. */
  function clampProbability(value) {
    if (value === null) return null;
    return Math.min(1, Math.max(0, value));
  }

  /* ---------------------------------------------------------------- *
   * Parsing logprobs payloads
   * ---------------------------------------------------------------- */

  /**
   * Normalise one token-probability entry.
   *
   * Accepts the Chat Completions shape (`token`, `logprob`, `top_logprobs`),
   * text/probability aliases, and the legacy vLLM map form for `top_logprobs`.
   */
  function normalizeEntry(raw) {
    if (!isObject(raw)) return null;
    const token = typeof raw.token === "string" ? raw.token : typeof raw.text === "string" ? raw.text : null;
    if (token === null) return null;
    const logprob = firstNumber(raw.logprob, raw.log_prob);
    const probability = clampProbability(firstNumber(raw.probability, raw.prob)) ??
      (logprob === null ? null : Math.min(1, Math.exp(logprob)));
    const entry = { token, logprob, probability };
    if (Array.isArray(raw.bytes)) entry.bytes = raw.bytes.slice();
    const id = firstNumber(raw.token_id, raw.id);
    if (id !== null && Number.isInteger(id)) entry.id = id;
    return entry;
  }

  /** Normalise the `top_logprobs` list for one position. */
  function normalizeTop(raw) {
    const list = Array.isArray(raw.top_logprobs)
      ? raw.top_logprobs
      : Array.isArray(raw.topLogprobs)
        ? raw.topLogprobs
        : Array.isArray(raw.alternatives)
          ? raw.alternatives
          : null;
    const top = [];
    if (list) {
      for (const item of list) {
        if (!isObject(item)) continue;
        if (typeof item.token === "string" || typeof item.text === "string") {
          const entry = normalizeEntry(item);
          if (entry) top.push(entry);
          continue;
        }
        // Legacy vLLM: one or more `token -> logprob` pairs in a single object.
        for (const key of Object.keys(item)) {
          const logprob = firstNumber(item[key]);
          if (logprob === null) continue;
          top.push({ token: key, logprob, probability: Math.min(1, Math.exp(logprob)) });
        }
      }
    }
    return top;
  }

  function entryWithTop(raw) {
    const entry = normalizeEntry(raw);
    if (!entry) return null;
    let top = normalizeTop(raw);
    top.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0) || (b.logprob ?? 0) - (a.logprob ?? 0));
    if (!top.length || top[0].token !== entry.token) {
      const chosen = { token: entry.token, logprob: entry.logprob, probability: entry.probability };
      if (entry.id !== undefined) chosen.id = entry.id;
      top = [chosen, ...top.filter((item) => item.token !== entry.token)];
    }
    entry.top = top;
    return entry;
  }

  function parseStream(list) {
    const tokens = [];
    const warnings = [];
    list.forEach((raw, index) => {
      const entry = entryWithTop(raw);
      if (!entry) {
        warnings.push(`position ${index} has no usable token`);
        return;
      }
      if (entry.probability === null) warnings.push(`position ${index} ("${entry.token}") has no logprob`);
      tokens.push(entry);
    });
    return { tokens, warnings };
  }

  /**
   * Parse a logprobs payload into ordered streams.
   *
   * Supported inputs:
   *   - `{ content: [...], reasoning_content: [...] }` (Chat Completions `logprobs`)
   *   - a full Chat Completions response, whose first choice carries `logprobs`
   *   - a bare array of token entries (treated as `content`)
   *   - the legacy vLLM/TGI `{ tokens, token_logprobs, top_logprobs }` shape
   *
   * Returns `{ streams, tokenCount, tokenCountWithLogprob, warnings }`, where
   * each stream is `{ name, label, tokens }`.
   */
  function parseLogprobs(input) {
    let payload = input;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (error) {
        throw new Error("Token probabilities are not valid JSON: " + error.message);
      }
    }
    if (Array.isArray(payload)) payload = { content: payload };
    if (isObject(payload) && Array.isArray(payload.choices) && payload.choices.length) {
      const choice = payload.choices[0];
      payload = isObject(choice?.logprobs) ? choice.logprobs : choice?.logprobs ?? null;
    }
    let streams = [];
    let parseWarnings = [];
    if (isObject(payload) && Array.isArray(payload.tokens) && (Array.isArray(payload.token_logprobs) || Array.isArray(payload.top_logprobs))) {
      // Legacy vLLM / TGI completion shape.
      const tokens = payload.tokens;
      const logprobs = Array.isArray(payload.token_logprobs) ? payload.token_logprobs : [];
      const tops = Array.isArray(payload.top_logprobs) ? payload.top_logprobs : [];
      const entries = tokens.map((token, index) => ({
        token,
        logprob: logprobs[index],
        top_logprobs: tops[index] !== undefined ? [tops[index]] : undefined,
      }));
      const parsed = parseStream(entries);
      parseWarnings = parseWarnings.concat(parsed.warnings);
      streams = [{ name: "content", tokens: parsed.tokens }];
    } else if (isObject(payload)) {
      for (const name of ["reasoning_content", "content"]) {
        if (Array.isArray(payload[name])) {
          const parsed = parseStream(payload[name]);
          parseWarnings = parseWarnings.concat(parsed.warnings);
          streams.push({ name, tokens: parsed.tokens });
        }
      }
    }
    streams = streams.filter((stream) => stream.tokens.length > 0);
    for (const stream of streams) stream.label = stream.name === "reasoning_content" ? "Reasoning" : "Answer";
    const tokenCount = streams.reduce((sum, stream) => sum + stream.tokens.length, 0);
    const withLogprob = streams.reduce((sum, stream) => sum + stream.tokens.filter((token) => token.probability !== null).length, 0);
    const warnings = parseWarnings;
    if (!streams.length) warnings.push("No token probabilities found. Provide `content`/`reasoning_content` arrays or an array of token entries.");
    return { streams, tokenCount, tokenCountWithLogprob: withLogprob, warnings };
  }

  /* ---------------------------------------------------------------- *
   * Output framing and alignment
   * ---------------------------------------------------------------- */

  /**
   * Split raw model output the way the demo decoder does: an optional leading
   * `<｜Assistant｜>`, then an optional `<think>` block, then the answer.
   */
  function splitOutput(raw) {
    let text = typeof raw === "string" ? raw : "";
    const eos = text.indexOf(EOS);
    const truncated = eos >= 0;
    if (truncated) text = text.slice(0, eos);
    let thinking = false;
    if (text.startsWith(ASSISTANT)) text = text.slice(ASSISTANT.length);
    if (text.startsWith(THINK_START)) {
      thinking = true;
      text = text.slice(THINK_START.length);
    } else if (text.startsWith(THINK_END)) {
      text = text.slice(THINK_END.length);
    }
    let reasoning = "";
    let content = text;
    if (thinking) {
      const end = text.indexOf(THINK_END);
      if (end >= 0) {
        reasoning = text.slice(0, end);
        content = text.slice(end + THINK_END.length);
      }
    }
    return { thinking, truncated, reasoning, content, normalized: reasoning + content };
  }

  /** Compare one probability stream against the text it should reproduce. */
  function compareStream(stream, expected) {
    const actual = stream.tokens.map((token) => token.token).join("");
    let firstDiff = -1;
    const limit = Math.min(actual.length, expected.length);
    for (let index = 0; index < limit; index += 1) {
      if (actual[index] !== expected[index]) {
        firstDiff = index;
        break;
      }
    }
    if (firstDiff === -1 && actual.length !== expected.length) firstDiff = limit;
    return {
      name: stream.name,
      label: stream.label,
      actual,
      expected,
      aligned: actual === expected,
      firstDiff: firstDiff === -1 ? null : firstDiff,
      actualLength: actual.length,
      expectedLength: expected.length,
    };
  }

  /**
   * Check whether the supplied probabilities reproduce the model output.
   * Returns per-stream comparisons plus a summary used by the UI warning.
   */
  function alignment(parsed, output) {
    const frame = splitOutput(output);
    const expected = { reasoning_content: frame.reasoning, content: frame.content };
    const streams = parsed.streams.map((stream) => compareStream(stream, expected[stream.name] ?? ""));
    const tokenText = streams.reduce((sum, stream) => sum + stream.actualLength, 0);
    const aligned = parsed.tokenCount > 0 && streams.every((stream) => stream.aligned);
    return { frame, streams, aligned, tokenText, outputText: frame.normalized.length };
  }

  /* ---------------------------------------------------------------- *
   * Confidence metrics
   * ---------------------------------------------------------------- */

  /**
   * Summarise one stream.
   *
   * `meanLogprob` and `perplexity` come from the chosen token's probability;
   * `meanEntropy` is computed over the supplied top-k alternatives, so
   * `topKMass` reports how much of the distribution those alternatives cover.
   */
  function streamMetrics(tokens, options) {
    const settings = options || {};
    const threshold = firstNumber(settings.threshold) ?? 0.5;
    const scored = tokens.filter((token) => token.probability !== null);
    const count = scored.length;
    let sumLogprob = 0;
    let lowConfidence = 0;
    let entropySum = 0;
    let massSum = 0;
    let weakest = null;
    for (const token of scored) {
      const probability = token.probability;
      const logprob = token.logprob !== null ? token.logprob : Math.log(Math.max(probability, 1e-12));
      sumLogprob += logprob;
      if (probability < threshold) lowConfidence += 1;
      if (!weakest || probability < weakest.probability) weakest = token;
      const top = token.top.length ? token.top : [token];
      const mass = top.reduce((sum, item) => sum + (item.probability ?? 0), 0);
      let entropy = 0;
      if (mass > 0) {
        for (const item of top) {
          const p = (item.probability ?? 0) / mass;
          if (p > 0) entropy -= p * Math.log(p);
        }
      }
      entropySum += entropy;
      massSum += Math.min(1, mass);
    }
    const meanLogprob = count ? sumLogprob / count : null;
    return {
      count,
      meanLogprob,
      meanProbability: count ? Math.exp(meanLogprob) : null,
      perplexity: count ? Math.exp(-meanLogprob) : null,
      lowConfidence,
      lowConfidenceShare: count ? lowConfidence / count : 0,
      meanEntropy: count ? entropySum / count : null,
      topKMass: count ? massSum / count : null,
      weakest,
      threshold,
    };
  }

  /** Metrics across every stream, plus the arithmetic mean of the streams. */
  function metrics(parsed, options) {
    const streams = parsed.streams.map((stream) => ({
      name: stream.name,
      label: stream.label,
      metrics: streamMetrics(stream.tokens, options),
    }));
    const scored = streams.filter((stream) => stream.metrics.count > 0);
    const total = scored.reduce((sum, stream) => sum + stream.metrics.count, 0);
    const combine = (pick) => {
      if (!total) return null;
      return scored.reduce((sum, stream) => sum + pick(stream.metrics) * stream.metrics.count, 0) / total;
    };
    return {
      streams,
      count: total,
      meanLogprob: combine((m) => m.meanLogprob),
      meanProbability: total ? Math.exp(combine((m) => m.meanLogprob)) : null,
      perplexity: total ? Math.exp(-combine((m) => m.meanLogprob)) : null,
      lowConfidence: scored.reduce((sum, stream) => sum + stream.metrics.lowConfidence, 0),
      meanEntropy: combine((m) => m.meanEntropy),
      topKMass: combine((m) => m.topKMass),
      threshold: firstNumber(options?.threshold) ?? 0.5,
    };
  }

  /* ---------------------------------------------------------------- *
   * Presentation helpers
   * ---------------------------------------------------------------- */

  /** Colour ramp for a token probability: red (unsure) to green (confident). */
  function confidenceColor(probability, alpha) {
    if (probability === null || probability === undefined) return "transparent";
    const t = Math.min(1, Math.max(0, probability));
    const hue = Math.round(4 + 138 * t);
    return `hsl(${hue} 72% 42% / ${alpha === undefined ? 0.32 : alpha})`;
  }

  function confidenceLevel(probability) {
    if (probability === null || probability === undefined) return "unknown";
    if (probability < 0.35) return "low";
    if (probability < 0.8) return "medium";
    return "high";
  }

  function formatProbability(probability) {
    if (probability === null || probability === undefined) return "n/a";
    if (probability >= 0.9995) return "100%";
    if (probability >= 0.001) return (probability * 100).toFixed(1) + "%";
    return probability.toExponential(1);
  }

  function formatLogprob(logprob) {
    if (logprob === null || logprob === undefined) return "n/a";
    return logprob.toFixed(3);
  }

  const BYTE_TOKEN = /\u0120/g; // Ġ marks a leading space in byte-level BPE.

  /** Human-readable rendering of a raw vocabulary token. */
  function displayToken(token) {
    if (typeof token !== "string") return "";
    return token.replace(BYTE_TOKEN, "\u00b7").replace(/\u010a/g, "\\n");
  }

  /* ---------------------------------------------------------------- *
   * Distillation records
   * ---------------------------------------------------------------- */

  function idsFor(stream, ids) {
    if (!Array.isArray(ids) || ids.length !== stream.tokens.length) return null;
    return ids.slice();
  }

  /**
   * Turn one sample into a distillation record.
   *
   * The record keeps hard targets (`target_ids`, `logprobs`) next to the
   * teacher's top-k soft targets (`topk_ids`, `topk_probs`) so a training
   * script can apply either cross-entropy or a soft-label KD loss. `loss_mask`
   * marks the positions that survive the confidence threshold.
   */
  function buildRecord(parsed, options) {
    const settings = Object.assign(
      {
        topK: 5,
        threshold: 0.5,
        includeIds: true,
        includeReasoning: true,
        maskLowConfidence: true,
        minSampleProbability: 0,
        id: null,
        model: null,
        format: null,
        finishReason: null,
        temperature: null,
        prompt: null,
        promptIds: null,
      },
      options || {},
    );
    const streams = parsed.streams.filter((stream) => settings.includeReasoning || stream.name !== "reasoning_content");
    const tokens = [];
    const logprobs = [];
    const probabilities = [];
    const targetIds = [];
    const topk = [];
    const topkIds = [];
    const topkProbs = [];
    const topkMass = [];
    const lossMask = [];
    const textParts = [];
    let idsAvailable = settings.includeIds;
    let anyAlternativeId = false;
    for (const stream of streams) {
      const ids = idsFor(stream, stream.ids);
      if (settings.includeIds && !ids) idsAvailable = false;
      for (let index = 0; index < stream.tokens.length; index += 1) {
        const token = stream.tokens[index];
        const probability = token.probability;
        tokens.push({ token: token.token, logprob: token.logprob, probability, stream: stream.name });
        logprobs.push(token.logprob);
        probabilities.push(probability);
        targetIds.push(ids ? ids[index] : null);
        const alternatives = token.top.slice(0, Math.max(1, settings.topK));
        const alternativeIds = alternatives.map((item) => (typeof item.id === "number" ? item.id : null));
        if (alternativeIds.some((id) => id !== null)) anyAlternativeId = true;
        topk.push(alternatives.map((item) => ({ token: item.token, logprob: item.logprob, probability: item.probability })));
        topkIds.push(alternativeIds);
        topkProbs.push(alternatives.map((item) => item.probability));
        topkMass.push(alternatives.reduce((sum, item) => sum + (item.probability ?? 0), 0));
        const keep = !(settings.maskLowConfidence && probability !== null && probability < settings.threshold);
        lossMask.push(keep ? 1 : 0);
      }
      textParts.push(stream.tokens.map((token) => token.token).join(""));
    }
    const completion = textParts.join("");
    const sampleMetrics = metrics({ streams }, { threshold: settings.threshold });
    const record = {
      id: settings.id,
      model: settings.model,
      format: settings.format,
      finish_reason: settings.finishReason,
      temperature: settings.temperature,
      prompt: settings.prompt,
      prompt_ids: settings.promptIds,
      completion,
      completion_ids: idsAvailable ? targetIds : null,
      target_ids: idsAvailable ? targetIds : null,
      tokens,
      logprobs,
      probabilities,
      topk,
      topk_ids: settings.includeIds && anyAlternativeId ? topkIds : null,
      topk_probs: topkProbs,
      topk_mass: topkMass,
      loss_mask: lossMask,
      meta: {
        tokens: tokens.length,
        reasoning_tokens: tokens.filter((token) => token.stream === "reasoning_content").length,
        masked_tokens: lossMask.filter((flag) => flag === 0).length,
        top_k: settings.topK,
        confidence_threshold: settings.threshold,
        mean_probability: sampleMetrics.meanProbability,
        mean_logprob: sampleMetrics.meanLogprob,
        perplexity: sampleMetrics.perplexity,
        mean_entropy: sampleMetrics.meanEntropy,
        top_k_mass: sampleMetrics.topKMass,
        tokenizer: settings.tokenizer ?? null,
      },
    };
    return { record, meanProbability: sampleMetrics.meanProbability };
  }

  /**
   * Build a JSONL distillation set from one sample.
   *
   * `options.streamIds` holds the tokenizer IDs for each stream, in stream
   * order, so targets can be emitted as IDs as well as text.
   */
  function buildExport(parsed, options) {
    const settings = Object.assign({ streamIds: null }, options || {});
    const streams = parsed.streams.map((stream, index) => {
      const ids = settings.streamIds ? settings.streamIds[index] : null;
      return { ...stream, ids: Array.isArray(ids) ? ids : null };
    });
    const withIds = { ...parsed, streams };
    const { record, meanProbability } = buildRecord(withIds, settings);
    const min = firstNumber(settings.minSampleProbability) ?? 0;
    const skipped = meanProbability !== null && meanProbability < min;
    const records = skipped ? [] : [record];
    return {
      records,
      skipped,
      jsonl: records.map((item) => JSON.stringify(item)).join("\n") + (records.length ? "\n" : ""),
      stats: {
        tokens: record.meta.tokens,
        masked: record.meta.masked_tokens,
        reasoningTokens: record.meta.reasoning_tokens,
        meanProbability: record.meta.mean_probability,
        perplexity: record.meta.perplexity,
        ids: record.target_ids !== null,
      },
    };
  }

  return {
    EOS,
    THINK_START,
    THINK_END,
    parseLogprobs,
    splitOutput,
    alignment,
    metrics,
    streamMetrics,
    confidenceColor,
    confidenceLevel,
    formatProbability,
    formatLogprob,
    displayToken,
    buildRecord,
    buildExport,
  };
});
