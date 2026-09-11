/*
 * Integration smoke test for the Prompt Studio page.
 *
 * There is no browser in this repository, so the test runs `app.js` against a
 * minimal DOM shim and a stubbed demo server. It checks that the page wires up
 * without errors, that a pasted `logprobs` payload renders the probability
 * card, and that the distillation export is produced from the same data.
 *
 * Run from the repository root:
 *   node --test 'encoding-decoding-demo/tests/**\/*.test.cjs'
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const STATIC = path.join(__dirname, "..", "static");
const Distill = require(path.join(STATIC, "distill.js"));

/* ---------------------------------------------------------------- *
 * Minimal DOM
 * ---------------------------------------------------------------- */

class ClassList {
  constructor() { this.items = new Set(); }
  add(...names) { for (const name of names) this.items.add(name); }
  remove(...names) { for (const name of names) this.items.delete(name); }
  contains(name) { return this.items.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.items.has(name) : Boolean(force);
    if (on) this.items.add(name);
    else this.items.delete(name);
    return on;
  }
}

class TextNode {
  constructor(text) { this.nodeType = 3; this.textContent = text; }
}

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.classList = new ClassList();
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this.hidden = false;
    this.value = "";
    this.checked = false;
    this.tabIndex = 0;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this._text = "";
  }
  set className(value) {
    this._className = String(value);
    this.classList = new ClassList();
    for (const name of this._className.split(/\s+/).filter(Boolean)) this.classList.add(name);
  }
  get className() { return this._className || ""; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((child) => child.textContent ?? "").join("");
  }
  get firstChild() {
    if (this.children.length === 0) this.children.push(new TextNode(""));
    return this.children[0];
  }
  append(...nodes) {
    for (const node of nodes) this.children.push(typeof node === "string" ? new TextNode(node) : node);
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type) {
    for (const handler of this.listeners[type] || []) handler({ target: this, preventDefault() {}, clientX: 0, clientY: 0 });
  }
  focus() {}
  observe() {}
}

function createDocument() {
  const elements = new Map();
  const formatTabs = ["chat_completions", "responses", "messages"].map((format) => {
    const tab = new Element("button");
    tab.dataset.format = format;
    return tab;
  });
  const modeTabs = ["encode", "decode"].map((mode) => {
    const tab = new Element("button");
    tab.dataset.mode = mode;
    return tab;
  });
  return {
    elements,
    documentElement: new Element("html"),
    body: new Element("body"),
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => new TextNode(text),
    createDocumentFragment: () => new Element("#fragment"),
    querySelectorAll: (selector) => (selector === ".tab" ? formatTabs : selector === ".mode-tab" ? modeTabs : []),
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, new Element("div"));
      return elements.get(id);
    },
    formatTabs,
    modeTabs,
  };
}

/* ---------------------------------------------------------------- *
 * Stub demo server
 * ---------------------------------------------------------------- */
function createServer() {
  return {
    /** One token per character, so stream IDs line up with the payload. */
    "/api/tokenize": (body) => ({
      tokenizer: "v41",
      vocab_size: 129280,
      count: [...body.text].length,
      tokens: [...body.text].map((character, index) => ({ id: 1000 + index, token: character, special: false })),
    }),
    "/api/token-ids": (body) => ({
      tokenizer: "v41",
      ids: body.tokens.map((token) => ([...token].length === 1 ? 2000 + (token.codePointAt(0) % 100) : null)),
    }),
    "/api/render": () => ({ prompt: "<｜begin▁of▁sentence｜>hi", segments: [{ kind: "text", text: "hi" }] }),
    "/api/decode": () => ({
      response: { choices: [{ message: { role: "assistant", content: "Bonjour." } }] },
      segments: [{ kind: "text", text: "Bonjour." }],
    }),
  };
}

function loadStudio() {
  const document = createDocument();
  const calls = [];
  const routes = createServer();
  // The shim has no HTML parser, so seed the states the real markup declares.
  document.getElementById("prob-threshold").value = "0.9";
  document.getElementById("export-topk").value = "5";
  for (const id of ["export-reasoning", "export-ids", "export-mask", "export-prompt"]) {
    document.getElementById(id).checked = true;
  }
  const context = vm.createContext({
    document,
    window: { innerWidth: 1280, innerHeight: 800, matchMedia: () => ({ matches: false }) },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: () => null, setItem: () => {} },
    ResizeObserver: class { observe() {} },
    Distill,
    Blob,
    URL: { createObjectURL: () => "blob:stub", revokeObjectURL() {} },
    console,
    setTimeout,
    clearTimeout,
    fetch: async (url, options) => {
      const route = routes[url];
      const body = options?.body ? JSON.parse(options.body) : {};
      calls.push({ url, body });
      if (!route) throw new Error("unexpected request: " + url);
      return { ok: true, status: 200, json: async () => route(body) };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(STATIC, "app.js"), "utf8"), context, { filename: "app.js" });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const el = (id) => document.getElementById(id);
  return { document, calls, wait, el };
}

/** A payload whose single-character tokens reproduce the output exactly. */
function characterPayload() {
  const reasoning = "Bonjour means hello.";
  const content = "Bonjour.";
  const entry = (token, logprob, alternatives) => ({
    token,
    logprob,
    top_logprobs: alternatives.map(([alt, altLogprob]) => ({ token: alt, logprob: altLogprob })),
  });
  return {
    reasoning_content: [...reasoning].map((character, index) => entry(character, -0.1 - index * 0.01, [[character, -0.1], ["x", -3.0]])),
    content: [...content].map((character) => entry(character, -0.05, [[character, -0.05], ["y", -4.0]])),
  };
}

const OUTPUT = "<think>Bonjour means hello.</think>Bonjour.<｜end▁of▁sentence｜>";

test("every example that opens a <think> block also closes it", async () => {
  const { document, wait } = loadStudio();
  await wait(30);
  const picker = document.getElementById("example-select");
  const ids = picker.children.map((child) => child.value).filter(Boolean);
  assert.ok(ids.length >= 10, "the example gallery is populated");
  const thinking = [];
  for (const id of ids) {
    picker.value = id;
    picker.dispatch("change");
    const output = document.getElementById("model-output").value;
    if (!output.startsWith("<think>")) continue;
    thinking.push(id);
    const frame = Distill.splitOutput(output);
    assert.equal(frame.thinking, true, id);
    assert.ok(frame.reasoning.length > 0, `${id} has no reasoning content`);
    assert.ok(frame.content.length > 0, `${id} opens <think> but never closes it`);
  }
  assert.ok(thinking.includes("reasoning-on"), "reasoning examples were checked");
  assert.ok(thinking.includes("chat"), "chat example was checked");
});

test("every element app.js looks up exists in index.html", () => {
  const html = fs.readFileSync(path.join(STATIC, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(STATIC, "app.js"), "utf8");
  const ids = [...app.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
  const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], "index.html is missing ids used by app.js");
  assert.ok(html.includes('src="/distill.js"'), "index.html loads distill.js");
  assert.ok(html.includes('src="/app.js"'), "index.html loads app.js");
  for (const selector of [".tab", ".mode-tab"]) {
    assert.ok(html.includes(`class="${selector.slice(1)}"`), `index.html declares ${selector}`);
  }
});

test("studio loads, renders the prompt, and reports a real token count", async () => {
  const { document, calls, wait } = loadStudio();
  await wait(30);
  assert.ok(calls.some((call) => call.url === "/api/render"), "prompt was rendered");
  assert.ok(calls.some((call) => call.url === "/api/tokenize"), "prompt was tokenized");
  const stats = document.getElementById("stats");
  assert.equal(stats.hidden, false);
  assert.match(stats.textContent, /tokens/);
  assert.equal(document.getElementById("prob-card").hidden, true, "no probabilities loaded yet");
});

test("pasted probabilities render the heatmap and build a distillation export", async () => {
  const { document, wait, el } = loadStudio();
  await wait(30);
  document.modeTabs[1].dispatch("click");

  const payload = characterPayload();
  const expectedTokens = payload.reasoning_content.length + payload.content.length;
  el("model-output").value = OUTPUT;
  el("model-output").dispatch("input");
  el("logprobs-input").value = JSON.stringify(payload);
  el("logprobs-input").dispatch("input");
  await wait(400);

  const card = el("prob-card");
  assert.equal(card.hidden, false);
  assert.equal(el("prob-heatmap").children.length > 0, true, "heatmap rendered");
  assert.match(el("prob-metrics").textContent, /mean p/);
  assert.equal(el("logprobs-status").textContent, `${expectedTokens} tokens`);
  assert.match(el("logprobs-warning").textContent, /reproduce the model output/);

  // Clicking a token pins its top-k alternatives.
  const token = el("prob-heatmap").children.find((child) => child.className.includes("ptok"));
  token.dispatch("click");
  assert.equal(el("prob-detail").hidden, false);
  assert.ok(el("prob-detail").children.length > 0);

  // The export is JSONL with teacher probabilities and token IDs.
  const line = el("distill-preview").textContent.trim();
  const record = JSON.parse(line);
  assert.equal(record.completion, "Bonjour means hello.Bonjour.");
  assert.equal(record.target_ids.length, expectedTokens);
  assert.equal(record.logprobs.length, expectedTokens);
  assert.equal(record.topk_probs.length, expectedTokens);
  assert.equal(record.prompt, "<｜begin▁of▁sentence｜>hi");
  assert.equal(record.meta.tokens, expectedTokens);
  assert.equal(record.meta.reasoning_tokens, payload.reasoning_content.length);
  assert.equal(record.format, "chat_completions");
  assert.match(el("distill-subtitle").textContent, /token IDs/);
});

test("probabilities that do not match the output are flagged", async () => {
  const { document, wait, el } = loadStudio();
  await wait(30);
  el("model-output").value = "Something else entirely.";
  el("model-output").dispatch("input");
  el("logprobs-input").value = JSON.stringify(characterPayload());
  el("logprobs-input").dispatch("input");
  await wait(400);
  assert.match(el("prob-metrics").textContent, /mismatch/);
  assert.match(el("logprobs-warning").textContent, /differ/);
});

test("invalid probabilities show an error instead of a card", async () => {
  const { document, wait, el } = loadStudio();
  await wait(30);
  el("logprobs-input").value = "{ not json";
  el("logprobs-input").dispatch("input");
  await wait(400);
  assert.equal(el("prob-card").hidden, true);
  assert.equal(el("distill-card").hidden, true);
  assert.equal(el("logprobs-status").textContent, "invalid JSON");
  assert.match(el("logprobs-warning").textContent, /not valid JSON/);
});

test("the sample example loads probabilities and opens the source panel", async () => {
  const { document, wait } = loadStudio();
  await wait(30);
  // Select the Token probabilities example through the example picker.
  const picker = document.getElementById("example-select");
  picker.value = "logprobs";
  picker.dispatch("change");
  await wait(400);
  const parsed = Distill.parseLogprobs(JSON.parse(document.getElementById("logprobs-input").value));
  assert.equal(parsed.tokenCount, 8);
  assert.equal(document.getElementById("prob-card").hidden, false);
  assert.equal(document.getElementById("distill-card").hidden, false);
});
