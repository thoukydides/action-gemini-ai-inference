# `action-gemini-ai-inference`

This action implements similar functionality to [actions/ai-inference](https://github.com/actions/ai-inference), except that it is optimised for **Gemini 3** models accessed via native Google AI Studio APIs.

The following additional features are implemented:
- Full model input and output are logged
- JSON-like template variables are supported without requiring extra encoding
- Thinking level defaults to `high`, but can be overridden
- Model thought summaries are captured, logged, and returned as outputs
- If structured output is used then the response is validated against the provided schema
- Some failures are retried a limited number of times

The following features of `actions/ai-inference` are not supported:
- Use of OpenAI compatible APIs (only native AI Studio Gemini APIs are used)
- Custom endpoints (use of `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` is hardcoded)
- Model Context Protocol or any other tool use (only simple inference)
- Prompt provision via action input or plain text file (the `prompt-file` a `.prompt.yml` file must always be used)
- Token selection parameters (`temperature` and `top-p` are not passed to the API)
- Custom headers (the `x-goog-api-key` header is set automatically)

> [!WARNING]
> `actions/ai-inference` mixes use of hyphens and underscores in inputs and outputs, but this action standardises on using underscores.

> [!CAUTION]
> This action is provided for my own use and published in case it is useful to others. If you rely on it, fork and maintain your own copy. No support or stability guarantees are offered.

## Prerequisites

Before using this workflow, ensure:
- You have created a [Gemini API key](https://ai.google.dev/gemini-api/docs/api-key) and placed it in a repository secret (e.g. `GEMINI_API_KEY`).
- You understand the [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) for your chosen model and usage tier.

## Inputs

Various inputs are defined in the action to configure its operation:

| Name | Description | Default
| --- | --- | ---
| `gemini_api_key` | The Google AI Studio Gemini API key | *required*
| `prompt_file` | Path to a file containing the YAML format prompt | *required*
| `input` | Template variables in YAML format | `""`
| `file_input` | Template variables in YAML where values are file paths | `""`
| `max_tokens` | The maximum number of tokens to generate (includes dynamic thinking and thought summary) | `65536`
| `max_retries` | The maximum number of attempts to obtain a valid inference result | `5`

## Outputs

The action provides the following outputs:

| Name | Description
| --- | ---
| `response` | The response from the model
| `response_file` | The file path where the response is saved
| `thoughts` | Any thought summaries returned by the model

## Prompt File

The YAML prompt file accepts the following scalars:

| Name | Description | Default
| --- | --- | ---
| `model` | The model to use | `gemini-3-flash-preview`
| `thinkingLevel` | Model reasoning behaviour: `minimal`, `low`, `medium`, or `high` | `high`
| `messages` | A list of input context messages (`role` and `content`); an optional `system` message followed by one or more `user` messages | *required*
| `responseFormat` | Omit for a plain text response or set to `json_schema` for structured output | `""`
| `jsonSchema` | If `responseFormat` is `json_schema` then a JSON schema to validate the response against | `""`

## ISC License (ISC)

<details>
<summary>Copyright © 2026 Alexander Thoukydides</summary>

> Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
</details>