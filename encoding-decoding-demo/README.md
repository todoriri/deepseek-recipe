# Prompt Studio

A local web interface for rendering DeepSeek V4.1 prompts, inspecting special
tokens, decoding complete model output into Chat Completions, Responses, and
Messages API formats, and turning a teacher model's token probabilities into
distillation data.

## Usage

Use the Rust toolchain pinned in the repository and a C/C++ compiler. This
example does not require OpenCV, model weights, or an API key. From the
repository root:

```sh
cargo run -p encoding-decoding-demo --locked
```

Open [http://127.0.0.1:7778](http://127.0.0.1:7778). Set `DEMO_ADDR` to change the
listening address.

## Modes

Use the Encode / Decode buttons to switch between modes; only the selected
mode's editor and result are shown. Both modes share the API format tabs, the
example gallery, and the Compare formats view.

In **Encode** mode, select an API format, edit its request JSON, and render the
request to inspect the model prompt. The stats line reports the prompt's real
token count, measured with the bundled V4.1 tokenizer. If the request asks for
`logprobs`, a note explains that this library renders prompts and forwards
sampling settings but does not run inference.

In **Decode** mode, edit the complete assistant output and decode it. Model
output is rendered with the same special-token highlights as the prompt.
Switching modes or formats keeps each request draft and reuses the same model
output.

The example output includes `<think>…</think>` reasoning, answer text, two DSML
weather tool calls (Beijing and Shanghai, each with string and numeric
arguments), and the end-of-turn marker `<｜end▁of▁sentence｜>`. Each protocol's
sample request declares the weather tool and includes the preceding tool
result and follow-up question.

The decoded JSON view shows only response content, reasoning, and tool calls.
It omits finish status and server-generated metadata such as response
and tool-call IDs, model names, timestamps, token usage, and thinking
signatures. Tool inputs and arguments remain intact, including payload fields
with those names. The HTTP endpoint still returns the complete protocol
response.

The decoder accepts complete assistant content, including the opening
`<think>` when reasoning is present, and an optional leading `<｜Assistant｜>`.
It consumes these frame markers before passing the content to the library's
stream parser. Output without an opening `<think>` is answer content; a
leading `</think>` from a non-thinking assistant prefix is also accepted.
Parsing starts outside tool-call markup because the complete output includes
its DSML opening block. Tool declarations, JSON output mode, and stop sequences
come from the selected protocol request.

Edit the model output, then use the adjacent decode button or Cmd/Ctrl+Enter. The UI
uses the default `stop` finish reason without displaying protocol status. If
the pasted output contains `<｜end▁of▁sentence｜>`, the demo treats its first
occurrence as EOS and discards that marker and everything after it.

## Token probabilities

DeepSeek inference belongs to a backend, so this example cannot produce token
probabilities itself: paste the `logprobs` your backend returned into
**Decode → Token probabilities (JSON)**. Nothing leaves the page; payloads are
parsed in the browser. The gallery includes a *Token probabilities* example with
an illustrative payload.

Accepted shapes:

- a Chat Completions `logprobs` object: `{ "content": [ … ], "reasoning_content": [ … ] }`
- a complete Chat Completions response; the first choice's `logprobs` is used
- a bare array of `{ "token": …, "logprob": …, "top_logprobs": [ … ] }`
- the legacy vLLM/TGI shape: `{ "tokens": […], "token_logprobs": […], "top_logprobs": [ … ] }`

Each token entry needs `token` and `logprob`; `top_logprobs` is optional and
falls back to the chosen token alone.

The **Token probabilities** card colors every token by its probability, shows
the top-k alternatives on hover, and pins one distribution on click. Its metrics
cover the mean probability, perplexity (`exp(-mean logprob)`), mean entropy over
the supplied top-k, how much probability mass the top-k covers, how many tokens
fall below the confidence threshold, and whether the payload's tokens reproduce
the model output character for character. A mismatch warning appears when the
output and the payload describe different completions.

## Distillation export

The **Distillation export** card writes one JSONL record per sample. Options
control the top-k width, whether reasoning tokens are included, whether token
IDs are attached, whether low-confidence tokens are masked, and whether the
rendered prompt is included.

| Field | Meaning |
| --- | --- |
| `prompt`, `prompt_ids` | Rendered prompt text and its token IDs from the bundled V4.1 tokenizer. |
| `completion` | Reasoning followed by answer, exactly as the payload spells it. |
| `target_ids` | Token IDs of the sampled tokens, in order. |
| `tokens`, `logprobs`, `probabilities` | Per-position hard targets and their confidence. |
| `topk`, `topk_ids`, `topk_probs`, `topk_mass` | The teacher's soft targets per position. |
| `loss_mask` | `1` for positions to train on, `0` for masked low-confidence tokens. |
| `meta` | Token counts, masking, top-k width, threshold, and confidence summaries. |

`target_ids` and `completion_ids` are `null` when the payload's token strings do
not tokenize back to the same number of tokens; the card then reports
"text only". Top-k IDs resolve against the vocabulary, and an alternative that
is not a single token in that vocabulary is exported as `null`.

A training script can therefore apply either hard cross-entropy on `target_ids`
or a soft-label KD loss over `topk_ids`/`topk_probs`, skipping masked positions:

```python
def iter_soft_targets(path):
    """Yield (hard_target_id, topk_ids, topk_probs) for each trained position."""
    with open(path) as handle:
        for line in handle:
            record = json.loads(line)
            if not record["topk_ids"]:
                continue  # the export fell back to text only
            for index, keep in enumerate(record["loss_mask"]):
                if keep:
                    yield record["target_ids"][index], record["topk_ids"][index], record["topk_probs"][index]
```

## HTTP endpoints

`POST /api/render` accepts `{ "format": "…", "body": { … } }` and returns the
prompt with highlighted segments.

`POST /api/decode` accepts the same request plus `output` and an optional
`finish_reason` (default: `stop`). The formats are `chat_completions`,
`responses`, and `messages`. For example:

```sh
curl http://127.0.0.1:7778/api/decode \
  -H 'content-type: application/json' \
  -d '{
    "format": "chat_completions",
    "body": {"messages": [{"role": "user", "content": "Hello"}]},
    "output": "<think>Respond in English.</think>Hello!<｜end▁of▁sentence｜>",
    "finish_reason": "stop"
  }'
```

The result is `{ "response": { … }, "segments": [ … ] }`. `segments` preserves
the complete supplied model output for highlighting, including its frame
markers. `response` is the complete protocol response, even when the input
request sets `stream: true`. The demo
uses the supplied model name or `encoding-decoding-demo`, a demonstration response ID,
and zero token usage because no tokenizer or backend usage data is supplied.
Decoding uses the library's stream parser and protocol response accumulators.
API callers can supply `length` or `content_filter` as the backend finish
reason. EOS uses `stop` instead, and matched request stop sequences take
precedence.

`POST /api/tokenize` accepts `{ "text": "…" }` and encodes it with the bundled
V4.1 tokenizer. It returns `{ "tokenizer": "v41", "vocab_size": …, "count": …,
"tokens": [ { "id": …, "token": "Ġmeans", "special": false } ] }`. The raw
vocabulary spelling is returned, so a leading space appears as `Ġ`.

`POST /api/token-ids` accepts `{ "tokens": [" bonus", "Ġbonus"] }` and resolves
decoded token text back to vocabulary IDs. The lookup tries the raw spelling,
the byte-level spelling, and a one-token encode, and returns `null` for entries
that are not a single token in the vocabulary. The response is
`{ "tokenizer": "v41", "ids": [ … ] }`.

## Tests

The probability, alignment, metrics, and export logic is pure JavaScript and
covered by unit tests; a DOM shim drives the page against a stubbed server:

```sh
node --test 'encoding-decoding-demo/tests/**/*.test.cjs'
```

This example has no authentication. Keep the default loopback address for local
use. It renders prompts and decodes supplied text; it does not execute
inference, run tools, or fetch image URLs.
