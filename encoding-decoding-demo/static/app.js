
"use strict";

/* ------------------------------------------------------------------ *
 * Example gallery
 * ------------------------------------------------------------------ */
const WEATHER_TOOL = {
  name: "get_weather",
  description: "Get the current weather and a short forecast for a location",
  parameters: {
    type: "object",
    properties: {
      location: { type: "string", description: "City name" },
      days: { type: "integer", description: "Forecast length in days" },
    },
    required: ["location"],
  },
};

// A 1x1 transparent PNG, small enough to embed inline in a request.
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const EOT = "<｜end▁of▁sentence｜>";
// The thinking START token. Its counterpart is THINK_END; using the end marker
// as the start makes the decoder read reasoning content as the answer.
const THINK = "<think>";
const THINK_END = "</think>";

// Illustrative teacher probabilities for the "Token probabilities" example.
// A real payload comes from an inference backend (`logprobs` / `top_logprobs`);
// the demo never runs inference itself.
const SAMPLE_LOGPROBS = {
  reasoning_content: [
    { token: "Bon", logprob: -0.0834, top_logprobs: [{ token: "Bon", logprob: -0.0834 }, { token: "Salut", logprob: -3.4738 }, { token: "Hello", logprob: -4.4228 }] },
    { token: "jour", logprob: -0.0121, top_logprobs: [{ token: "jour", logprob: -0.0121 }, { token: "soir", logprob: -5.116 }, { token: "midi", logprob: -5.5215 }] },
    { token: " means", logprob: -0.1508, top_logprobs: [{ token: " means", logprob: -0.1508 }, { token: " is", logprob: -2.6593 }, { token: " signifies", logprob: -3.5066 }] },
    { token: " hello", logprob: -0.4943, top_logprobs: [{ token: " hello", logprob: -0.4943 }, { token: " goodbye", logprob: -1.772 }, { token: " hi", logprob: -2.1203 }] },
    { token: ".", logprob: -0.0305, top_logprobs: [{ token: ".", logprob: -0.0305 }, { token: "!", logprob: -3.912 }, { token: ",", logprob: -4.8283 }] },
  ],
  content: [
    { token: "Bon", logprob: -0.0253, top_logprobs: [{ token: "Bon", logprob: -0.0253 }, { token: "Hello", logprob: -4.1997 }, { token: "hi", logprob: -5.116 }] },
    { token: "jour", logprob: -0.006, top_logprobs: [{ token: "jour", logprob: -0.006 }, { token: "soir", logprob: -5.5215 }] },
    { token: ".", logprob: -0.1278, top_logprobs: [{ token: ".", logprob: -0.1278 }, { token: "!", logprob: -2.4079 }, { token: "…", logprob: -4.6052 }] },
  ],
};

const EXAMPLES = [
  {
    id: "chat",
    name: "Simple chat",
    desc: "The baseline template — one user turn, thinking on by default.",
    bodies: {
      chat_completions: { model: "deepseek-chat", messages: [{ role: "user", content: "In one sentence, what is a prime number?" }] },
      responses: { model: "deepseek-chat", input: "In one sentence, what is a prime number?" },
      messages: { model: "deepseek-chat", messages: [{ role: "user", content: "In one sentence, what is a prime number?" }] },
    },
    output: THINK + "A quick definition: a prime has exactly two divisors." + THINK_END + "A prime number is a whole number greater than 1 whose only positive divisors are 1 and itself." + EOT,
  },
  {
    id: "system",
    name: "System prompt",
    desc: "A system instruction followed by a user question.",
    bodies: {
      chat_completions: {
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are a concise, expert coding assistant. Give working code and brief explanations." },
          { role: "user", content: "How do I center a div with CSS?" },
        ],
      },
      responses: {
        model: "deepseek-chat",
        instructions: "You are a concise, expert coding assistant. Give working code and brief explanations.",
        input: [{ role: "user", content: "How do I center a div with CSS?" }],
      },
      messages: {
        model: "deepseek-chat",
        system: "You are a concise, expert coding assistant. Give working code and brief explanations.",
        messages: [{ role: "user", content: "How do I center a div with CSS?" }],
      },
    },
    output: THINK + "Centering needs a layout container: Flexbox or Grid." + THINK_END + "Use Flexbox on the parent: `display:flex; justify-content:center; align-items:center;`. Or CSS Grid: `place-items:center;`." + EOT,
  },
  {
    id: "reasoning-on",
    name: "Deep reasoning (on)",
    desc: "Thinking enabled at high effort. The " + THINK + " block holds the model's working.",
    bodies: {
      chat_completions: {
        model: "deepseek-chat",
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        messages: [{ role: "user", content: "If it takes 5 machines 5 minutes to make 5 widgets, how long do 100 machines take to make 100 widgets?" }],
      },
      responses: {
        model: "deepseek-chat",
        reasoning: { effort: "high" },
        input: "If it takes 5 machines 5 minutes to make 5 widgets, how long do 100 machines take to make 100 widgets?",
      },
      messages: {
        model: "deepseek-chat",
        thinking: { type: "enabled", budget_tokens: 4096 },
        output_config: { effort: "high" },
        messages: [{ role: "user", content: "If it takes 5 machines 5 minutes to make 5 widgets, how long do 100 machines take to make 100 widgets?" }],
      },
    },
    output:
      THINK +
      "This is a classic rate trap. 5 machines make 5 widgets in 5 minutes, so each machine makes 1 widget in 5 minutes. That rate is per-machine, not per-group. 100 machines each make 1 widget in 5 minutes, so 100 machines make 100 widgets in 5 minutes." +
      THINK_END +
      "5 minutes." + EOT,
  },
  {
    id: "reasoning-off",
    name: "Reasoning off",
    desc: "Thinking disabled — the model answers directly with no " + THINK + " block.",
    bodies: {
      chat_completions: { model: "deepseek-chat", thinking: { type: "disabled" }, messages: [{ role: "user", content: "Translate 'good morning' into French." }] },
      responses: { model: "deepseek-chat", reasoning: { effort: "none" }, input: "Translate 'good morning' into French." },
      messages: { model: "deepseek-chat", thinking: { type: "disabled" }, messages: [{ role: "user", content: "Translate 'good morning' into French." }] },
    },
    output: "Bonjour." + EOT,
  },
  {
    id: "logprobs",
    name: "Token probabilities",
    desc: "A teacher's top-k probabilities for a short reasoning answer. Load the sample, then inspect and export it in Decode mode.",
    bodies: {
      chat_completions: {
        model: "deepseek-chat",
        logprobs: true,
        top_logprobs: 5,
        thinking: { type: "enabled" },
        messages: [{ role: "user", content: "Translate 'good morning' into French." }],
      },
      responses: {
        model: "deepseek-chat",
        reasoning: { effort: "high" },
        input: "Translate 'good morning' into French.",
      },
      messages: {
        model: "deepseek-chat",
        thinking: { type: "enabled", budget_tokens: 1024 },
        messages: [{ role: "user", content: "Translate 'good morning' into French." }],
      },
    },
    output: THINK + "Bonjour means hello." + THINK_END + "Bonjour." + EOT,
    logprobs: SAMPLE_LOGPROBS,
  },
  {
    id: "tool-call",
    name: "Function calling",
    desc: "The model plans a tool call. The answer is DSML tool-call markup.",
    bodies: {
      chat_completions: {
        model: "deepseek-chat",
        tools: [{ type: "function", function: WEATHER_TOOL }],
        tool_choice: "auto",
        messages: [{ role: "user", content: "What's the weather in Beijing over the next 3 days?" }],
      },
      responses: {
        model: "deepseek-chat",
        tools: [{ type: "function", ...WEATHER_TOOL }],
        input: [{ role: "user", content: "What's the weather in Beijing over the next 3 days?" }],
      },
      messages: {
        model: "deepseek-chat",
        tools: [{ name: WEATHER_TOOL.name, description: WEATHER_TOOL.description, input_schema: WEATHER_TOOL.parameters }],
        messages: [{ role: "user", content: "What's the weather in Beijing over the next 3 days?" }],
      },
    },
    output:
      "<｜DSML｜ calls>" +
      "\n<｜DSML｜ invoke name=\"get_weather\">" +
      "\n<｜DSML｜ parameter name=\"location\" string=\"true\">Beijing</｜DSML｜ parameter>" +
      "\n<｜DSML｜ parameter name=\"days\" string=\"false\">3</｜DSML｜ parameter>" +
      "\n</｜DSML｜ invoke>" +
      "\n</｜DSML｜ calls>" + EOT,
  },
  {
    id: "tool-loop",
    name: "Multi-turn tool loop",
    desc: "A full round: request, tool result, and a follow-up that needs a new call.",
    bodies: {
      chat_completions: {
        model: "deepseek-chat",
        tools: [{ type: "function", function: WEATHER_TOOL }],
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "What's the weather in Beijing today?" },
          { role: "assistant", reasoning_content: "I need the weather in Beijing, so I will call get_weather.", tool_calls: [{ id: "call_1", function: { name: "get_weather", arguments: JSON.stringify({ location: "Beijing" }) } }] },
          { role: "tool", tool_call_id: "call_1", content: "Sunny, 25°C" },
          { role: "assistant", content: "It's sunny in Beijing today, 25°C." },
          { role: "user", content: "Now compare Beijing and Shanghai for the next 3 days." },
        ],
      },
      responses: {
        model: "deepseek-chat",
        instructions: "You are a helpful assistant.",
        tools: [{ type: "function", ...WEATHER_TOOL }],
        input: [
          { type: "message", role: "user", content: "What's the weather in Beijing today?" },
          { type: "function_call", call_id: "call_1", name: "get_weather", arguments: JSON.stringify({ location: "Beijing" }) },
          { type: "function_call_output", call_id: "call_1", output: "Sunny, 25°C" },
          { type: "message", role: "assistant", content: "It's sunny in Beijing today, 25°C." },
          { type: "message", role: "user", content: "Now compare Beijing and Shanghai for the next 3 days." },
        ],
      },
      messages: {
        model: "deepseek-chat",
        system: "You are a helpful assistant.",
        tools: [{ name: WEATHER_TOOL.name, description: WEATHER_TOOL.description, input_schema: WEATHER_TOOL.parameters }],
        messages: [
          { role: "user", content: "What's the weather in Beijing today?" },
          { role: "assistant", content: [{ type: "thinking", thinking: "I need the weather in Beijing, so I will call get_weather." }, { type: "tool_use", id: "toolu_1", name: "get_weather", input: { location: "Beijing" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "Sunny, 25°C" }] },
          { role: "assistant", content: [{ type: "text", text: "It's sunny in Beijing today, 25°C." }] },
          { role: "user", content: "Now compare Beijing and Shanghai for the next 3 days." },
        ],
      },
    },
    output:
      "The user wants a 3-day comparison for two cities, so I need a forecast for each." +
      "\n" +
      "<｜DSML｜ calls>" +
      "\n<｜DSML｜ invoke name=\"get_weather\">" +
      "\n<｜DSML｜ parameter name=\"location\" string=\"true\">Beijing</｜DSML｜ parameter>" +
      "\n<｜DSML｜ parameter name=\"days\" string=\"false\">3</｜DSML｜ parameter>" +
      "\n</｜DSML｜ invoke>" +
      "\n<｜DSML｜ invoke name=\"get_weather\">" +
      "\n<｜DSML｜ parameter name=\"location\" string=\"true\">Shanghai</｜DSML｜ parameter>" +
      "\n<｜DSML｜ parameter name=\"days\" string=\"false\">3</｜DSML｜ parameter>" +
      "\n</｜DSML｜ invoke>" +
      "\n</｜DSML｜ calls>" + EOT,
  },
  {
    id: "vision",
    name: "Vision (image)",
    desc: "Image input. Each image renders as a single <｜image｜> token in the prompt.",
    bodies: {
      chat_completions: {
        model: "deepseek-chat",
        messages: [{ role: "user", content: [{ type: "text", text: "What do you see in this image?" }, { type: "image_url", image_url: { url: "data:image/png;base64," + TINY_PNG, detail: "auto" } }] }],
      },
      responses: {
        model: "deepseek-chat",
        input: [{ role: "user", content: [{ type: "input_text", text: "What do you see in this image?" }, { type: "input_image", image_url: "data:image/png;base64," + TINY_PNG, detail: "auto" }] }],
      },
      messages: {
        model: "deepseek-chat",
        messages: [{ role: "user", content: [{ type: "text", text: "What do you see in this image?" }, { type: "image", source: { type: "base64", media_type: "image/png", data: TINY_PNG } }] }],
      },
    },
    output: "It looks like a small, mostly uniform square — hard to tell more from an image this size." + EOT,
  },
  {
    id: "json",
    name: "Structured output (JSON)",
    desc: "The model is instructed to answer with JSON only.",
    bodies: {
      chat_completions: {
        model: "deepseek-chat",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: "Return the weather for Beijing as JSON with keys city, weather, temperature_c." }],
      },
      responses: {
        model: "deepseek-chat",
        text: { format: { type: "json_object" } },
        input: [{ role: "user", content: "Return the weather for Beijing as JSON with keys city, weather, temperature_c." }],
      },
      messages: {
        model: "deepseek-chat",
        max_tokens: 512,
        messages: [{ role: "user", content: "Answer with JSON only. Keys: city, weather, temperature_c. City: Beijing." }],
      },
    },
    output: '{"city": "Beijing", "weather": "Sunny", "temperature_c": 25}' + EOT,
  },
  {
    id: "stop",
    name: "Stop sequences",
    desc: "A stop sequence caps the model's response.",
    bodies: {
      chat_completions: { model: "deepseek-chat", stop: ["\n"], messages: [{ role: "user", content: "Tell me a short story, but stop before the last line." }] },
      responses: { model: "deepseek-chat", input: [{ role: "user", content: "Tell me a short story, but stop before the last line." }] },
      messages: { model: "deepseek-chat", stop_sequences: ["\n"], messages: [{ role: "user", content: "Tell me a short story, but stop before the last line." }] },
    },
    output: "Once upon a time, in a quiet coastal town, a lighthouse keeper noticed a new light on the horizon." + EOT,
  },
  {
    id: "reminder",
    name: "System reminder",
    desc: "A mid-conversation reminder. Renders the <｜latest_reminder｜> token (Chat Completions) or a <system-reminder> block (Messages).",
    bodies: {
      chat_completions: {
        model: "deepseek-chat",
        messages: [
          { role: "user", content: "What day is it today?" },
          { role: "latest_reminder", content: "Today is Friday, September 11, 2026." },
        ],
      },
      responses: {
        model: "deepseek-chat",
        input: [{ role: "user", content: "What day is it today?" }, { role: "system", content: "Today is Friday, September 11, 2026." }],
      },
      messages: {
        model: "deepseek-chat",
        messages: [
          { role: "user", content: "What day is it today?" },
          { role: "system", content: "Today is Friday, September 11, 2026." },
        ],
      },
    },
    output: "It's Friday, September 11, 2026." + EOT,
  },
];

/* ------------------------------------------------------------------ *
 * DOM + state
 * ------------------------------------------------------------------ */
const tabs = Array.from(document.querySelectorAll(".tab"));
const modeTabs = Array.from(document.querySelectorAll(".mode-tab"));
const input = document.getElementById("input");
const output = document.getElementById("output");
const outputLabel = document.getElementById("output-label");
const meta = document.getElementById("meta");
const errorBox = document.getElementById("error");
const exampleSelect = document.getElementById("example-select");
const exampleDesc = document.getElementById("example-desc");
const compareEl = document.getElementById("compare");
const compareToggle = document.getElementById("compare-toggle");
const tokenLegend = document.getElementById("token-legend");
const statsEl = document.getElementById("stats");
const tip = document.getElementById("tip");
const modelOutput = document.getElementById("model-output");
const modelOutputPreview = document.getElementById("model-output-preview");
const decodedOutput = document.getElementById("decoded-output");
const decodeMeta = document.getElementById("decode-meta");
const decodeError = document.getElementById("decode-error");
const decodeHint = document.getElementById("decode-hint");
const decodeLegend = document.getElementById("decode-legend");
const responseFormat = document.getElementById("response-format");
const themeToggle = document.getElementById("theme-toggle");
const encodeNotice = document.getElementById("encode-notice");
const probCard = document.getElementById("prob-card");
const probSubtitle = document.getElementById("prob-subtitle");
const probMetrics = document.getElementById("prob-metrics");
const probHeatmap = document.getElementById("prob-heatmap");
const probDetail = document.getElementById("prob-detail");
const probNumbers = document.getElementById("prob-numbers");
const probThreshold = document.getElementById("prob-threshold");
const probSource = document.getElementById("prob-source");
const logprobsInput = document.getElementById("logprobs-input");
const logprobsStatus = document.getElementById("logprobs-status");
const logprobsWarning = document.getElementById("logprobs-warning");
const distillCard = document.getElementById("distill-card");
const distillSubtitle = document.getElementById("distill-subtitle");
const distillSummary = document.getElementById("distill-summary");
const distillPreview = document.getElementById("distill-preview");
const exportTopK = document.getElementById("export-topk");
const exportReasoning = document.getElementById("export-reasoning");
const exportIds = document.getElementById("export-ids");
const exportMask = document.getElementById("export-mask");
const exportPrompt = document.getElementById("export-prompt");

const DEFAULT_FORMAT = "chat_completions";
const FORMATS = ["chat_completions", "responses", "messages"];
const FORMAT_LABELS = { chat_completions: "Chat Completions", responses: "Responses", messages: "Messages" };

const state = {
  mode: "encode",
  format: DEFAULT_FORMAT,
  exampleId: EXAMPLES[0].id,
  drafts: { chat_completions: "", responses: "", messages: "" },
  compare: false,
  renderId: 0,
  decodeId: 0,
  compareId: 0,
  lastPrompt: "",
  lastDecodedJson: "",
  lastSegments: [],
  // Token probabilities and distillation export.
  parsed: null,
  tokenizer: null,
  probId: 0,
  distillId: 0,
  selected: null,
  exportJsonl: "",
};

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */
function pretty(value) { return JSON.stringify(value, null, 2); }

function byId(id) { return EXAMPLES.find((ex) => ex.id === id) || null; }

function pick(value, keys) {
  return Object.fromEntries(keys.filter((key) => value?.[key] != null).map((key) => [key, value[key]]));
}

function decodedContent(format, response) {
  switch (format) {
    case "chat_completions":
      return {
        choices: response.choices.map((choice) => {
          const message = pick(choice.message, ["content", "reasoning_content"]);
          for (const key of ["content", "reasoning_content"]) if (message[key] === "") delete message[key];
          if (choice.message.tool_calls?.length) {
            message.tool_calls = choice.message.tool_calls.map((tool) => ({ type: tool.type, function: pick(tool.function, ["name", "arguments"]) }));
          }
          return { message };
        }),
      };
    case "responses":
      return { output: response.output.map((item) => {
        const content = pick(item, ["type", "name", "namespace", "arguments", "input"]);
        if (item.content) content.content = item.content.map((part) => pick(part, ["type", "text"]));
        return content;
      }) };
    case "messages":
      return { content: response.content.map((block) => pick(block, ["type", "text", "thinking", "name", "input"])) };
    default:
      throw new Error("Unknown API format: " + format);
  }
}

async function post(url, body) {
  let response, payload;
  try {
    response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    payload = await response.json();
  } catch (err) { throw new Error("Demo server request failed: " + err.message); }
  if (!response.ok) throw new Error(payload?.error?.message ?? "HTTP " + response.status);
  return payload;
}

function debounce(fn, delay) {
  let handle;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), delay);
  };
}

function setNotice(el, message, ok) {
  if (!message) { el.hidden = true; el.textContent = ""; return; }
  el.textContent = message;
  el.classList.toggle("ok", Boolean(ok));
  el.hidden = false;
}

/* ------------------------------------------------------------------ *
 * Tokenizer-backed helpers
 * ------------------------------------------------------------------ */
const tokenCache = new Map();
const tokenIdCache = new Map();

/** Token IDs for `text`, cached per session. */
async function tokenizeText(text) {
  if (tokenCache.has(text)) return tokenCache.get(text);
  const payload = await post("/api/tokenize", { text });
  state.tokenizer = { name: payload.tokenizer, vocabSize: payload.vocab_size };
  const ids = payload.tokens.map((token) => token.id);
  if (tokenCache.size > 32) tokenCache.clear();
  tokenCache.set(text, ids);
  return ids;
}

/** Vocabulary IDs for decoded token text. Unresolvable entries map to null. */
async function resolveTokenIds(tokens) {
  const resolved = new Map();
  const missing = [];
  for (const token of tokens) {
    if (tokenIdCache.has(token)) resolved.set(token, tokenIdCache.get(token));
    else missing.push(token);
  }
  if (missing.length) {
    const payload = await post("/api/token-ids", { tokens: missing });
    missing.forEach((token, index) => {
      const id = payload.ids[index];
      tokenIdCache.set(token, id ?? null);
      resolved.set(token, id ?? null);
    });
    if (tokenIdCache.size > 4096) tokenIdCache.clear();
  }
  return resolved;
}

const promptCache = { key: "", text: null, ids: null };

/** Render the current request once and tokenize the prompt. */
async function renderedPrompt() {
  const key = state.format + "\n" + input.value;
  if (promptCache.key === key && promptCache.text !== null) return promptCache;
  const payload = await post("/api/render", { format: state.format, body: requestBody() });
  let ids = null;
  try { ids = await tokenizeText(payload.prompt); } catch { ids = null; }
  promptCache.key = key;
  promptCache.text = payload.prompt;
  promptCache.ids = ids;
  return promptCache;
}

/** Read a top-level field from the request body, or null. */
function requestField(name) {
  try {
    const body = JSON.parse(input.value);
    return body?.[name] ?? null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ *
 * Rendering helpers
 * ------------------------------------------------------------------ */
function renderSegment(segment) {
  const span = document.createElement("span");
  if (segment.kind === "token") {
    span.className = "sp";
    span.textContent = segment.token;
    span.dataset.name = segment.name;
    span.dataset.tip = segment.description;
  } else {
    span.className = "tx";
    span.textContent = segment.text;
  }
  return span;
}

// Inventory of special tokens present in a set of segments (name -> {count, token, description}).
function tokenInventory(segments) {
  const map = new Map();
  for (const seg of segments || []) {
    if (seg.kind !== "token") continue;
    const entry = map.get(seg.name) || { count: 0, token: seg.token, description: seg.description };
    entry.count += 1;
    map.set(seg.name, entry);
  }
  return Array.from(map.entries()).map(([name, v]) => ({ name, count: v.count, token: v.token, description: v.description }));
}

function renderLegend(el, segments) {
  const items = tokenInventory(segments);
  el.replaceChildren();
  el.hidden = items.length === 0;
  for (const item of items) {
    const chip = document.createElement("span");
    chip.className = "token-chip sp";
    chip.dataset.name = item.name;
    chip.dataset.tip = item.description;
    chip.append(item.token, document.createTextNode(" ×" + item.count));
    el.append(chip);
  }
}

function computeStats(prompt, segments) {
  const chars = prompt.length;
  const kinds = tokenInventory(segments).length;
  let totalTokens = 0, images = 0;
  for (const seg of segments || []) if (seg.kind === "token") { totalTokens += 1; if (seg.name === "image") images += 1; }
  const toolCalls = (prompt.match(/<｜DSML｜ invoke/g) || []).length;
  return { chars, kinds, totalTokens, images, toolCalls };
}

function renderStats(el, stats, tokens) {
  el.replaceChildren();
  const parts = [];
  if (typeof tokens === "number") parts.push(tokens.toLocaleString() + " tokens");
  parts.push(stats.chars.toLocaleString() + " chars");
  parts.push(stats.totalTokens + " special-token occurrences");
  if (stats.kinds) parts.push(stats.kinds + " types");
  if (stats.images) parts.push(stats.images + " image" + (stats.images > 1 ? "s" : ""));
  if (stats.toolCalls) parts.push(stats.toolCalls + " tool call" + (stats.toolCalls > 1 ? "s" : ""));
  el.append(parts.join("  ·  "));
  el.hidden = false;
}

/** Fill in the real token count once `/api/tokenize` answers. */
async function updatePromptTokens(prompt, renderId) {
  let tokens = null;
  try { tokens = (await tokenizeText(prompt)).length; } catch { return; }
  if (renderId !== state.renderId || prompt !== state.lastPrompt) return;
  renderStats(statsEl, computeStats(prompt, state.lastSegments), tokens);
}

/* ------------------------------------------------------------------ *
 * Encode (single format)
 * ------------------------------------------------------------------ */
function clearPrompt() {
  output.replaceChildren();
  output.setAttribute("aria-busy", "false");
  tokenLegend.hidden = true;
  statsEl.hidden = true;
  state.lastPrompt = "";
}

function render(payload) {
  const fragment = document.createDocumentFragment();
  for (const segment of payload.segments) fragment.append(renderSegment(segment));
  output.replaceChildren(fragment);
  state.lastPrompt = payload.prompt;
  state.lastSegments = payload.segments;
  meta.textContent = "";
  renderLegend(tokenLegend, payload.segments);
  renderStats(statsEl, computeStats(payload.prompt, payload.segments));
  updatePromptTokens(payload.prompt, state.renderId);
}

function requestBody() {
  try { return JSON.parse(input.value); }
  catch (err) { throw new Error("Failed to parse request JSON: " + err.message); }
}

/** Tell the reader that the library forwards `logprobs` to the backend. */
function checkLogprobsRequest(body) {
  const wants = body && ["logprobs", "top_logprobs"].some((key) => body[key] !== undefined && body[key] !== null && body[key] !== false);
  setNotice(
    encodeNotice,
    wants
      ? "This request asks for `logprobs`. deepseek-recipe renders prompts and forwards sampling settings; it does not run inference. Paste the backend's token probabilities under Decode → Token probabilities to inspect and export them."
      : "",
  );
}

async function renderPrompt() {
  const id = ++state.renderId;
  const format = state.format;
  clearPrompt();
  hideError();
  setNotice(encodeNotice, "");
  outputLabel.textContent = "Encoded prompt";
  meta.textContent = "Rendering…";
  output.setAttribute("aria-busy", "true");
  try {
    const body = requestBody();
    const payload = await post("/api/render", { format, body });
    if (id !== state.renderId) return;
    render(payload);
    checkLogprobsRequest(body);
  } catch (err) {
    if (id !== state.renderId) return;
    clearPrompt();
    showError(err.message);
  } finally {
    if (id === state.renderId) output.setAttribute("aria-busy", "false");
  }
}

/* ------------------------------------------------------------------ *
 * Compare all formats
 * ------------------------------------------------------------------ */
async function renderCompare(compareId) {
  const results = await Promise.all(FORMATS.map(async (format) => {
    const col = { format, label: FORMAT_LABELS[format] };
    try {
      const body = JSON.parse(state.drafts[format]);
      col.payload = await post("/api/render", { format, body });
    } catch (err) {
      col.error = err.message;
    }
    return col;
  }));
  if (compareId !== state.compareId) return;
  compareEl.replaceChildren();
  for (const col of results) {
    const wrap = document.createElement("div");
    wrap.className = "compare-col";
    const head = document.createElement("div");
    head.className = "compare-head";
    head.textContent = col.label;
    wrap.append(head);
    if (col.error) {
      const pre = document.createElement("pre");
      pre.className = "prompt col-err";
      pre.textContent = col.error;
      wrap.append(pre);
    } else {
      const pre = document.createElement("pre");
      pre.className = "prompt";
      const frag = document.createDocumentFragment();
      for (const seg of col.payload.segments) frag.append(renderSegment(seg));
      pre.append(frag);
      const n = document.createElement("div");
      n.className = "col-meta";
      n.textContent = col.payload.prompt.length.toLocaleString() + " chars";
      wrap.append(pre, n);
      tokenizeText(col.payload.prompt)
        .then((ids) => { n.textContent = ids.length.toLocaleString() + " tokens  ·  " + n.textContent; })
        .catch(() => {});
    }
    compareEl.append(wrap);
  }
  // legend + stats from the active format if present, else first
  const active = results.find((r) => r.format === state.format) || results[0];
  if (active && active.payload) {
    renderLegend(tokenLegend, active.payload.segments);
    renderStats(statsEl, computeStats(active.payload.prompt, active.payload.segments));
    updatePromptTokens(active.payload.prompt, state.renderId);
  }
}

async function runEncode() {
  if (state.compare) {
    const compareId = ++state.compareId;
    clearPrompt();
    output.hidden = true;
    compareEl.hidden = false;
    compareEl.setAttribute("aria-busy", "true");
    await renderCompare(compareId);
    if (compareId !== state.compareId) return;
    compareEl.setAttribute("aria-busy", "false");
  } else {
    output.hidden = false;
    compareEl.hidden = true;
    await renderPrompt();
  }
}

/* ------------------------------------------------------------------ *
 * Decode
 * ------------------------------------------------------------------ */
function clearDecoded() {
  decodedOutput.textContent = "";
  decodedOutput.setAttribute("aria-busy", "false");
  decodeMeta.textContent = "";
  decodeLegend.hidden = true;
  decodeError.hidden = true;
  state.lastDecodedJson = "";
}

function syncModelOutputScroll() {
  modelOutputPreview.scrollTop = modelOutput.scrollTop;
  modelOutputPreview.scrollLeft = modelOutput.scrollLeft;
}

function renderModelOutput(segments) {
  if (segments) {
    const fragment = document.createDocumentFragment();
    for (const segment of segments) fragment.append(renderSegment(segment));
    modelOutputPreview.replaceChildren(fragment);
  } else {
    modelOutputPreview.textContent = modelOutput.value;
  }
  if (modelOutput.value.endsWith("\n")) modelOutputPreview.append(document.createTextNode("\u200b"));
  syncModelOutputScroll();
}

async function decodeOutput() {
  const id = ++state.decodeId;
  const format = state.format;
  clearDecoded();
  decodeMeta.textContent = "Decoding…";
  decodedOutput.setAttribute("aria-busy", "true");
  try {
    const payload = await post("/api/decode", { format, body: requestBody(), output: modelOutput.value });
    if (id !== state.decodeId) return;
    renderModelOutput(payload.segments);
    const content = decodedContent(format, payload.response);
    state.lastDecodedJson = pretty(content);
    decodedOutput.textContent = state.lastDecodedJson;
    renderLegend(decodeLegend, payload.segments);
    decodeMeta.textContent = "";
  } catch (err) {
    if (id !== state.decodeId) return;
    clearDecoded();
    decodeError.textContent = err.message;
    decodeError.hidden = false;
  } finally {
    if (id === state.decodeId) decodedOutput.setAttribute("aria-busy", "false");
  }
}

/* ------------------------------------------------------------------ *
 * Token probabilities
 * ------------------------------------------------------------------ */
function thresholdValue() {
  const raw = probThreshold.value;
  if (raw === "" || raw === null) return 0.9;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.9;
}

function renderMetrics(el, entries) {
  el.replaceChildren();
  for (const [label, value, level] of entries) {
    const chip = document.createElement("span");
    chip.className = "metric" + (level ? " " + level : "");
    const strong = document.createElement("b");
    strong.textContent = value;
    chip.append(strong, document.createTextNode(label));
    el.append(chip);
  }
  el.hidden = false;
}

function probabilityTip(token) {
  const lines = [
    `"${token.token}"   p ${Distill.formatProbability(token.probability)}   logprob ${Distill.formatLogprob(token.logprob)}`,
  ];
  const top = token.top.slice(0, 8);
  if (top.length > 1) {
    lines.push(`top ${top.length}:`);
    top.forEach((item, index) => {
      lines.push(`  ${index + 1}. "${item.token}"   ${Distill.formatProbability(item.probability)}   ${Distill.formatLogprob(item.logprob)}`);
    });
  }
  lines.push("click to pin");
  return lines.join("\n");
}

function renderHeatmap() {
  probHeatmap.replaceChildren();
  const parsed = state.parsed;
  if (!parsed) return;
  const multiple = parsed.streams.length > 1;
  for (const stream of parsed.streams) {
    if (multiple) {
      const label = document.createElement("span");
      label.className = "stream-label";
      label.textContent = `${stream.label} · ${stream.tokens.length} tokens`;
      probHeatmap.append(label);
    }
    stream.tokens.forEach((token, index) => {
      const selected = state.selected && state.selected.stream === stream.name && state.selected.index === index;
      const span = document.createElement("span");
      span.className = "ptok" + (selected ? " selected" : "");
      span.textContent = token.token;
      span.style.background = Distill.confidenceColor(token.probability, 0.32);
      span.dataset.tip = probabilityTip(token);
      if (probNumbers.checked) {
        const small = document.createElement("small");
        small.textContent = Distill.formatProbability(token.probability);
        span.append(small);
      }
      span.addEventListener("click", () => {
        state.selected = selected ? null : { stream: stream.name, index };
        renderHeatmap();
        renderDetail();
      });
      probHeatmap.append(span);
    });
  }
}

function renderDetail() {
  probDetail.replaceChildren();
  const selected = state.selected;
  const stream = selected && state.parsed ? state.parsed.streams.find((item) => item.name === selected.stream) : null;
  const token = stream ? stream.tokens[selected.index] : null;
  if (!token) {
    probDetail.hidden = true;
    return;
  }
  const head = document.createElement("div");
  head.className = "detail-head";
  head.textContent = `${stream.label} token ${selected.index + 1} of ${stream.tokens.length} · "${token.token}" · p ${Distill.formatProbability(token.probability)} · logprob ${Distill.formatLogprob(token.logprob)}`;
  const table = document.createElement("table");
  const header = document.createElement("tr");
  for (const [label, align] of [["#", ""], ["token", ""], ["probability", "num"], ["logprob", "num"]]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    if (align) cell.className = align;
    header.append(cell);
  }
  table.append(header);
  token.top.forEach((item, index) => {
    const row = document.createElement("tr");
    if (index === 0) row.className = "chosen";
    const cells = [
      index + 1,
      item.id === undefined ? item.token : `${item.token}   #${item.id}`,
      Distill.formatProbability(item.probability),
      Distill.formatLogprob(item.logprob),
    ];
    cells.forEach((value, cellIndex) => {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      if (cellIndex >= 2) cell.className = "num";
      row.append(cell);
    });
    table.append(row);
  });
  probDetail.append(head, table);
  probDetail.hidden = false;
}

function renderProbabilityCard() {
  const parsed = state.parsed;
  if (!parsed) {
    probCard.hidden = true;
    return;
  }
  const summary = Distill.metrics(parsed, { threshold: thresholdValue() });
  const align = Distill.alignment(parsed, modelOutput.value);
  probCard.hidden = false;
  probSubtitle.textContent = `${parsed.tokenCount} tokens · ${state.tokenizer?.name ?? "v41"}`;
  renderMetrics(probMetrics, [
    ["mean p", Distill.formatProbability(summary.meanProbability), ""],
    ["perplexity", summary.perplexity === null ? "n/a" : summary.perplexity.toFixed(2), ""],
    ["low confidence", `${summary.lowConfidence}/${summary.count}`, summary.lowConfidence ? "warn" : ""],
    ["entropy", summary.meanEntropy === null ? "n/a" : summary.meanEntropy.toFixed(2) + " nats", ""],
    ["top-k mass", summary.topKMass === null ? "n/a" : (summary.topKMass * 100).toFixed(0) + "%", ""],
    ["alignment", align.aligned ? "matches output" : "mismatch", align.aligned ? "" : "bad"],
  ]);
  const warnings = parsed.warnings.slice(0, 3);
  if (!align.aligned) {
    const stream = align.streams.find((item) => !item.aligned);
    warnings.push(
      "Probabilities and model output differ" +
      (stream && stream.firstDiff !== null ? ` at character ${stream.firstDiff}` : "") +
      ". Edit the output or payload so both describe the same completion before exporting.",
    );
  }
  if (warnings.length) setNotice(logprobsWarning, warnings.join("\n"), false);
  else setNotice(logprobsWarning, "Probabilities reproduce the model output.", true);
  renderHeatmap();
  renderDetail();
}

/** Attach vocabulary IDs to top-k alternatives so exports can carry them. */
async function attachAlternativeIds(parsed) {
  const wanted = new Set();
  for (const stream of parsed.streams) for (const token of stream.tokens) for (const item of token.top) wanted.add(item.token);
  if (!wanted.size) return;
  const ids = await resolveTokenIds(Array.from(wanted));
  for (const stream of parsed.streams) for (const token of stream.tokens) for (const item of token.top) {
    const value = ids.get(item.token);
    if (typeof value === "number") item.id = value;
  }
}

async function refreshProbabilities() {
  const id = ++state.probId;
  const text = logprobsInput.value.trim();
  if (!text) {
    state.parsed = null;
    state.selected = null;
    probCard.hidden = true;
    distillCard.hidden = true;
    state.exportJsonl = "";
    logprobsStatus.textContent = "none loaded";
    setNotice(logprobsWarning, "");
    return;
  }
  let parsed;
  try {
    parsed = Distill.parseLogprobs(text);
  } catch (error) {
    state.parsed = null;
    probCard.hidden = true;
    distillCard.hidden = true;
    state.exportJsonl = "";
    logprobsStatus.textContent = "invalid JSON";
    setNotice(logprobsWarning, error.message, false);
    return;
  }
  if (!parsed.tokenCount) {
    state.parsed = null;
    probCard.hidden = true;
    distillCard.hidden = true;
    state.exportJsonl = "";
    logprobsStatus.textContent = "no tokens";
    setNotice(logprobsWarning, parsed.warnings.join("\n"), false);
    return;
  }
  state.parsed = parsed;
  state.selected = null;
  logprobsStatus.textContent = `${parsed.tokenCount} tokens`;
  try { await attachAlternativeIds(parsed); } catch { /* IDs are optional */ }
  if (id !== state.probId) return;
  renderProbabilityCard();
  await refreshDistill();
}

/* ------------------------------------------------------------------ *
 * Distillation export
 * ------------------------------------------------------------------ */
function readExportOptions() {
  const raw = exportTopK.value;
  return {
    topK: Math.min(20, Math.max(1, Math.round(raw === "" ? 5 : Number(raw) || 5))),
    threshold: thresholdValue(),
    includeIds: exportIds.checked,
    includeReasoning: exportReasoning.checked,
    maskLowConfidence: exportMask.checked,
    includePrompt: exportPrompt.checked,
  };
}

async function refreshDistill() {
  const id = ++state.distillId;
  const parsed = state.parsed;
  if (!parsed) {
    distillCard.hidden = true;
    state.exportJsonl = "";
    return;
  }
  const options = readExportOptions();
  distillCard.hidden = false;
  distillPreview.textContent = "Building export…";
  let streamIds = null;
  if (options.includeIds) {
    streamIds = [];
    for (const stream of parsed.streams) {
      const text = stream.tokens.map((token) => token.token).join("");
      try { streamIds.push(await tokenizeText(text)); } catch { streamIds.push(null); }
    }
  }
  let prompt = null;
  let promptIds = null;
  if (options.includePrompt) {
    try {
      const rendered = await renderedPrompt();
      prompt = rendered.text;
      promptIds = rendered.ids;
    } catch { /* the request body may be invalid; export without the prompt */ }
  }
  if (id !== state.distillId) return;
  let exported;
  try {
    exported = Distill.buildExport(parsed, {
      topK: options.topK,
      threshold: options.threshold,
      includeIds: options.includeIds,
      includeReasoning: options.includeReasoning,
      maskLowConfidence: options.maskLowConfidence,
      streamIds,
      prompt,
      promptIds,
      id: `${state.format}-${state.exampleId}`,
      model: requestField("model"),
      format: state.format,
      finishReason: "stop",
      temperature: requestField("temperature"),
      tokenizer: state.tokenizer?.name ?? "v41",
    });
  } catch (error) {
    distillPreview.textContent = "// export failed: " + error.message;
    state.exportJsonl = "";
    return;
  }
  state.exportJsonl = exported.jsonl;
  distillSubtitle.textContent = exported.stats.ids ? "with token IDs" : "text only";
  renderMetrics(distillSummary, [
    ["positions", String(exported.stats.tokens), ""],
    ["reasoning", String(exported.stats.reasoningTokens), ""],
    ["masked", String(exported.stats.masked), exported.stats.masked ? "warn" : ""],
    ["token IDs", exported.stats.ids ? "resolved" : "unavailable", exported.stats.ids ? "" : "warn"],
  ]);
  distillPreview.textContent = exported.jsonl || "// no record produced";
}

function downloadExport() {
  if (!state.exportJsonl) return;
  const blob = new Blob([state.exportJsonl], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `distill-${state.exampleId || "sample"}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ *
 * Examples / format / mode
 * ------------------------------------------------------------------ */
function loadExample(exampleId) {
  const ex = byId(exampleId);
  if (!ex) return;
  state.exampleId = ex.id;
  exampleSelect.value = ex.id;
  for (const format of FORMATS) state.drafts[format] = pretty(ex.bodies[format]);
  input.value = state.drafts[state.format];
  modelOutput.value = ex.output;
  exampleDesc.textContent = ex.desc;
  decodeHint.textContent = ex.desc;
  renderModelOutput();
  promptCache.key = "";
  state.renderId++;
  state.decodeId++;
  clearPrompt();
  clearDecoded();
  hideError();
  if (ex.logprobs) {
    logprobsInput.value = pretty(ex.logprobs);
    probSource.open = true;
  } else {
    logprobsInput.value = "";
    probSource.open = false;
  }
  refreshProbabilities();
  runMode();
}

function setFormat(format) {
  state.drafts[state.format] = input.value;
  state.format = format;
  for (const tab of tabs) {
    const selected = tab.dataset.format === format;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) responseFormat.textContent = FORMAT_LABELS[format];
  }
  input.value = state.drafts[format];
  state.renderId++;
  state.decodeId++;
  clearPrompt();
  clearDecoded();
  hideError();
  runMode();
}

function setMode(mode) {
  state.mode = mode;
  for (const tab of modeTabs) {
    const selected = tab.dataset.mode === mode;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  document.getElementById("encode-panel").hidden = mode !== "encode";
  document.getElementById("decode-panel").hidden = mode !== "decode";
  tip.hidden = true;
  runMode();
}

function runMode() { state.mode === "encode" ? runEncode() : decodeOutput(); }

function resetExample() {
  const ex = byId(state.exampleId);
  if (ex) loadExample(ex.id);
}

function toggleCompare() {
  state.compare = !state.compare;
  compareToggle.classList.toggle("active", state.compare);
  compareToggle.setAttribute("aria-pressed", String(state.compare));
  if (state.mode === "encode") runEncode();
}

/* ------------------------------------------------------------------ *
 * Copy + theme
 * ------------------------------------------------------------------ */
async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  if (button) {
    const old = button.textContent;
    button.textContent = "Copied!";
    button.classList.add("copied");
    setTimeout(() => { button.textContent = old; button.classList.remove("copied"); }, 1200);
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  try { localStorage.setItem("dsr-theme", theme); } catch {}
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(cur === "dark" ? "light" : "dark");
}

function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
function hideError() { errorBox.hidden = true; }

/* ------------------------------------------------------------------ *
 * Tooltip
 * ------------------------------------------------------------------ */
function positionTip(event) {
  const margin = 12;
  tip.style.left = "0px"; tip.style.top = "0px";
  const rect = tip.getBoundingClientRect();
  let x = event.clientX + margin;
  let y = event.clientY + margin;
  if (x + rect.width > window.innerWidth - margin) x = Math.max(margin, window.innerWidth - margin - rect.width);
  if (y + rect.height > window.innerHeight - margin) y = Math.max(margin, event.clientY - margin - rect.height);
  tip.style.left = x + "px"; tip.style.top = y + "px";
}

function bindTooltipHover(root) {
  const find = (event) => event.target.closest("[data-tip]");
  root.addEventListener("mouseover", (e) => { const t = find(e); if (!t) return; tip.textContent = t.dataset.tip; tip.hidden = false; positionTip(e); });
  root.addEventListener("mousemove", (e) => { if (!tip.hidden) positionTip(e); });
  root.addEventListener("mouseout", (e) => { if (find(e)) tip.hidden = true; });
}

/* ------------------------------------------------------------------ *
 * Tabs (with arrow-key navigation)
 * ------------------------------------------------------------------ */
function bindTabs(buttons, select) {
  for (const tab of buttons) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const index = buttons.indexOf(tab);
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
      if (event.key === "ArrowLeft") next = (index + buttons.length - 1) % buttons.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = buttons.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      buttons[next].focus();
      select(buttons[next]);
    });
  }
}

/* ------------------------------------------------------------------ *
 * Wire-up
 * ------------------------------------------------------------------ */
// Theme (before first paint where possible)
(function initTheme() {
  let saved = "light";
  try { saved = localStorage.getItem("dsr-theme") || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); } catch {}
  applyTheme(saved);
})();

// Example select
(function initExamples() {
  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent = "Custom (your input)";
  exampleSelect.append(custom);
  for (const ex of EXAMPLES) {
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = ex.name;
    exampleSelect.append(opt);
  }
  exampleSelect.value = state.exampleId;
  exampleSelect.addEventListener("change", () => {
    if (!exampleSelect.value) return; // custom: keep current drafts
    loadExample(exampleSelect.value);
  });
})();

bindTabs(tabs, (tab) => setFormat(tab.dataset.format));
bindTabs(modeTabs, (tab) => setMode(tab.dataset.mode));

bindTooltipHover(output);
bindTooltipHover(modelOutputPreview);
bindTooltipHover(compareEl);
bindTooltipHover(tokenLegend);
bindTooltipHover(decodeLegend);
bindTooltipHover(probHeatmap);

document.getElementById("render-prompt").addEventListener("click", renderPrompt);
document.getElementById("decode-output").addEventListener("click", decodeOutput);
document.getElementById("copy-prompt").addEventListener("click", (e) => copyText(state.lastPrompt, e.currentTarget));
document.getElementById("copy-json").addEventListener("click", (e) => copyText(state.lastDecodedJson, e.currentTarget));
document.getElementById("reset-example").addEventListener("click", resetExample);
compareToggle.addEventListener("click", toggleCompare);
themeToggle.addEventListener("click", toggleTheme);

// Token probabilities: parse as the reader types, refresh the export with them.
const scheduleProbabilityRefresh = debounce(refreshProbabilities, 250);
logprobsInput.addEventListener("input", scheduleProbabilityRefresh);
probNumbers.addEventListener("change", renderHeatmap);
probThreshold.addEventListener("change", () => { renderProbabilityCard(); refreshDistill(); });
document.getElementById("logprobs-sample").addEventListener("click", () => loadExample("logprobs"));
document.getElementById("logprobs-clear").addEventListener("click", () => {
  logprobsInput.value = "";
  refreshProbabilities();
  logprobsInput.focus();
});

for (const control of [exportTopK, exportReasoning, exportIds, exportMask, exportPrompt]) {
  control.addEventListener("change", () => refreshDistill());
}
document.getElementById("distill-copy").addEventListener("click", (e) => copyText(state.exportJsonl, e.currentTarget));
document.getElementById("distill-download").addEventListener("click", downloadExport);

input.addEventListener("input", () => {
  state.drafts[state.format] = input.value;
  state.renderId++;
  promptCache.key = "";
  if (exampleSelect.value) exampleSelect.value = ""; // drafts no longer match the example
  clearPrompt();
  hideError();
  setNotice(encodeNotice, "");
  meta.textContent = "Request changed, ready to render";
});

modelOutput.addEventListener("input", () => {
  renderModelOutput();
  state.decodeId++;
  clearDecoded();
  decodeMeta.textContent = "Output changed, ready to decode";
  scheduleProbabilityRefresh();
});
modelOutput.addEventListener("scroll", syncModelOutputScroll);
new ResizeObserver(syncModelOutputScroll).observe(modelOutput);

modelOutput.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); decodeOutput(); } });
input.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runEncode(); } });

// Initial load: first example, render it.
loadExample(EXAMPLES[0].id);
