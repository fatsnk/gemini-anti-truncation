# Validation

[中文](VALIDATION.md) | English

Local fixtures, live standalone requests and historical router checks cover different parts of the system.

## Gemini 4 Argon (2026-10-14, main source update)

Verification passed 191 local tests. After the documentation update, the pre-commit check passed for 98 release files. New coverage includes thinking-level mapping, explicit config precedence, rejection before inference for numeric budgets/caches/long-decode limits, prefills, native function-call ID/signature round trips, and an Express/OAuth × transport × JSON/SSE mock matrix. The SillyTavern package was generated without installing it into the existing Tavern.

The user authorized at most eight upstream calls, each capped at 512 output tokens, using fixed short prompts and stopping on the first error. All eight passed with HTTP 200 and stop, without retries, on the existing service account, global, Standard. Three exercised this gateway: normal and buffered requests returned OK; the native tool stream restored 454 characters over seven content-bearing reads, with first content at 1.97 s and a 566 ms content span. These are single short samples, not performance or long-context quality benchmarks.

Five calls exercised the parent router through its existing smoke script against a temporary instance of the same source with retries disabled and a shared hard call limit. Its native tool stream delivered seven content-bearing reads over 739 ms and passed restoration audit checks. The daily Docker router was separately rebuilt and checked for health, ownership, loopback binding, controller readiness and the three new model IDs.

Live Express entitlement, Argon Priority/Flex, installed Tavern browser behavior, and long-form quality remain unverified. Continuation-token long decode is not implemented. Delivery is a `main` source update; the existing `sillytavern-v0.3.1` Release ZIP predates it. See the [setup and update guide](GEMINI4.en.md).

## Standalone package

### SillyTavern integration 0.3.1: Continue support, streaming fix and one-step installer (2026-10-09)

At release, `npm run verify` passes 93 release-file checks and 183 local tests. New fixtures cover explicit `type: "continue"`, both prefill and continuation-nudge request shapes, ordinary assistant prefills staying unchanged, refusal when the plugin version is not ready, retained Unicode status, and a single upstream call across streaming, buffered and image modes. Simulated replies verify unchanged suffix delivery, progressive arrival, preserved reasoning and usage, honest length endings and no retry on 429.

An additional 60 offline cases use the locally installed Tavern's actual `postProcessPrompt`, `convertGooglePrompt` and budget conversion code: three Gemini model IDs, none/merge/strict/single processing, system-prompt on/off, prefill/nudge forms, and image/Unicode paths. The original request stays unchanged, existing text remains in context, and the final user instruction requests only the continuation. All-conversation image mode does not reinsert plaintext to locate the continuation.

Six subsequent live requests used the saved Tavern service account with Gemini 3.7 Flash, global, Standard tier, and a 1024-output-token cap per request. An isolated loopback HTTP backend loaded the changed plugin and Tavern's actual converter. Each fixture supplied a Chinese passage and an existing prefix ending mid-sentence. All six returned HTTP 200 with an exact suffix, no repeated prefix, a `STOP`/`stop` ending and exactly one upstream submission.

| Request | Client response | Observed result |
| --- | --- | --- |
| Continue prefill + buffered anti-truncation | JSON | Restored, suffix only |
| Continuation nudge + buffered anti-truncation | Buffered SSE | Restored, one DONE |
| Continue prefill + streaming anti-truncation | Native stream adapted to SSE | 7 content reads; first at about 1777 ms, content span 545 ms |
| Continuation nudge + streaming anti-truncation | Native stream adapted to SSE | 7 content reads; first at about 1728 ms, content span 553 ms |
| Current-turn image + anti-truncation off | Buffered SSE | No eligible text to render; original text sent with the continuation instruction, one DONE |
| All-conversation image + buffered anti-truncation | JSON | Actual image input, restored, suffix only |

Reported usage totaled 4480 input, 1086 output-text and 1165 thinking tokens, or 6731 tokens overall. SHA-256 checks of Tavern's `config.yaml`, user `settings.json` and `secrets.json` matched before and after. No Tavern installation, restart or chat mutation occurred. These short completion fixtures establish transport compatibility, not open-ended story quality, long-context continuity or overall repetition rates. Live Tavern page interaction remains unverified.

**Streaming fix.** With streaming anti-truncation enabled in a real Tavern, replies still appeared all at once when generation finished. Tavern's global `compression()` compressed the plugin's `text/event-stream` reply and emitted output only when its buffer filled or the reply ended; the six live requests above used a temporary backend without compression, so they did not expose this. With the plugin mounted on Tavern's own `express` and `compression()`, a simulated upstream sending ten pieces over 3 seconds, and a client sending `Accept-Encoding: gzip, deflate, br, zstd`: before the fix the reply was brotli-compressed and read once at 3.2 seconds; with `Cache-Control: no-store, no-transform` on streamed replies it was not compressed and arrived in 11 reads from 26 ms to 3.1 seconds. The installed 0.3.0 copy reproduced the same failure. A regression test checks for `no-transform` on streamed replies.

**Installation and loading.** Both 0.3.1 halves were placed into the existing manual and Git copies of a local SillyTavern 1.19.0; after a restart, `/api/plugins/vertex-anti-truncation/status` reported 0.3.1 ready. A real Vertex long reply streaming in the Tavern page has not been observed yet. The one-step installer is covered by temporary-directory tests and one install-and-update run with `npm ci` against a simulated Tavern folder; it has not been run on a real Tavern.

### Unreleased fixes and refinements (2026-10-07 to 10-08)

At the time of writing, the working tree passes 176 local tests with `node --test test/*.test.mjs` and 88 release-file checks with `node scripts/check.mjs`. Every test uses port 0, a temporary state directory, dummy credentials and a simulated upstream; no real Google, proxy, browser or SillyTavern call was made. New fixtures cover the fields and redaction of provider error details (including the request's own credential, and stream error events from both the compatible and native endpoints), a stalled error body returning the provider status after about 5 seconds with prompt retry on or off, the first save signing out other sessions opened with the setup link, line wrapping that stays inside the page, and WebP page output. In a scratch copy, removing the two error-body timers made the stalled-body fixture time out, and restoring the earlier summed-width line wrapping let ink reach x=1023, past the 988px text edge, so the line-wrapping fixture failed.

Not yet verified: live WebP image requests on the compatible and native endpoints; a real connection through a proxy with `NODE_USE_ENV_PROXY` (the test covers only the `NO_PROXY` direct path); Google's real error envelopes and ErrorInfo reasons, and whether the 240-character cap is useful; what the compatible endpoint sends for stream usage when the request does not set `include_usage`; `MALFORMED_FUNCTION_CALL` on real Flex, Express or streaming traffic; an actual run of the new CI matrix (macOS, Node.js 22.9.0); the console with a screen reader, at narrow widths and in the dark theme; the Tavern panel's new messages, and a WebP image passing through Tavern's own `convertGooglePrompt` to Vertex.

### 0.6.0 Unicode and image input, SillyTavern integration 0.3.0 (2026-10-02 to 10-04)

At the 0.6.0 commit, `npm run verify` passes 85 release-file checks and 135 local tests (rerun on a clean export of that commit). Live evidence is small and shows only deployment and basic request/response compatibility. Unicode input passed short requests with extension UI v0.2.0 (then a separate checkbox): a temporary gateway instance in normal, buffered and streaming anti-truncation modes, and the installed Tavern in off, buffered and streaming modes. Image input had a single PNG-encoded streaming request through a local OpenAI-compatible relay to Vertex (200, stop and DONE, exact transcription), not through this gateway's own authentication path.

These checks do not establish long-context comprehension, fewer truncations, progressive delivery for image requests or reduced filtering, and live import and persistence of the UI 0.3.0 selector remain unverified. See [image input validation](IMAGE-INPUT-VALIDATION.md), the [Unicode input acceptance record](UNICODE-INPUT-AUDIT.md) and the [2026-09-30 review (Chinese)](AUDIT-2026-09-30.md).

### 0.5.2 settings lock, probe tier and code cleanup (2026-09-26)

`npm run verify` passes syntax/credential/private-path checks for 58 release files and 85 local tests. A new fixture covers stale locks: a fresh lock still returns 409, and a lock older than a minute is cleared so the save succeeds. Reverting the fix in a scratch copy made the fixture fail. Local runs confirmed that with an upstream sending a chunk every 300 ms and a 1-second timeout, the stream is cut off after about 1.1 s and logged as `504 upstream_timeout`, and that a console on port 80 answered 403 before the fix and 200 after it. In a browser against a local simulated upstream, the connection test showed `ON_DEMAND_PRIORITY` for streaming and nonstream requests, and a lock conflict showed the Chinese message.

The cleanup was checked old against new. The same SSE inputs (plain streams, partial arguments, comment lines, `\r\n` and `\r` line endings, error events, truncation, malformed JSON, data after DONE, invalid UTF-8) were fed whole, byte by byte and at random split points through every stream stage and the full gateway chain of both implementations. All 768 comparisons matched events, error codes and log metadata, and native request bodies and support decisions matched for six request shapes. The completion check now decodes invalid UTF-8 to U+FFFD like the other stages instead of failing on its own; inside the gateway it only receives text re-encoded by an earlier stage, so request outcomes are unchanged.

Twelve live Gemini 3.7 Flash requests (Standard tier, 512-token cap each) ran through an isolated loopback gateway with credentials held only in memory. Eight, before the cleanup, checked suspected problems: Vertex accepts `stopSequences: [null]` and empty text parts, so neither was changed; the four streamed replies that reached the tool call all started with it, with no plain text first; the compatible endpoint reports the tier only in `usage.extra_properties.google.traffic_type`; and three requests spent all 512 tokens on thinking and ended with `length` and no text. Four, after the cleanup, covered streaming anti-truncation (10 native partial reads), a normal stream, a normal nonstream reply and buffered anti-truncation delivered as SSE. All returned 200 with stop and logged `ON_DEMAND`, and both anti-truncation replies were restored. Express, Flex, Priority and native real-tool streams were not exercised live; the last relies on the comparison above.

### 0.5.1 Priority on the compatible endpoint (2026-09-25)

`npm run verify` passes syntax/credential/private-path checks for 57 release files and 84 local tests. A new fixture covers full-mode Priority: nonstream anti-truncation and normal-mode streams reach the compatible `/chat/completions` endpoint with both Priority headers, "streaming" mode's progressive output still reaches native `streamGenerateContent`, and the log reads the actual tier from `usage.extra_properties.google.traffic_type`. Reverting the tier-reading change in a scratch copy made the new fixture fail.

Two live Gemini 3.7 Flash requests (512-token cap) ran at the Priority tier through an isolated loopback gateway with credentials held only in memory. Nonstream anti-truncation returned 200 with stop and restored text; a normal-mode stream returned 200 with stop and DONE. Both logs recorded `ON_DEMAND_PRIORITY` with integrity outcome `complete`. Express Priority was not exercised live.

### 0.5.0 retry rules, unsupported parameters and timeout (2026-09-25)

`npm run verify` passes syntax/credential/private-path checks for 57 release files and 83 local tests. New fixtures cover refusal rejections in JSON and SSE, custom rules replacing the default, native `promptFeedback` matching, rule validation and environment parsing, documented field removal on both the compatible and native request paths, and a local server showing the dispatcher's header timeout follows its setting (100 ms fails, 5 s succeeds). Reverting each change in a scratch copy made its new tests fail.

One live Gemini 3.7 Flash streaming request (512-token cap) ran through an isolated loopback gateway with existing credentials held only in memory. It sent temperature, top_p, both penalties and SillyTavern's disabled-thinking field: the gateway removed the four documented fields up front, used native progressive streaming (7 reads), returned 200 with stop and DONE, restored the text and logged `ON_DEMAND`. No retry rule was exercised live, and no call longer than 300 s was attempted; those paths rely on the fixtures above.

### 0.4.1 completion diagnostics (2026-09-23)

All 77 local tests pass, with syntax/credential/private-path checks for 56 release files. Regression fixtures failed before the fix and now cover missing/null/wrong-type messages, delta-only non-streaming replies, the failing choice in a multi-candidate response, malformed tool arguments and unknown finish-reason redaction. Normal and buffered gateway requests preserve failure metadata in both client errors and events. Empty/reasoning-only completions retain their empty outcome. No malformed response is accepted as successful, restored or eligible for custom-text recovery.

An independent fixture confirms byte-for-byte preservation of unmatched compatible replies with recovery enabled, including fragmented Unicode, a valid answer quoting the trigger phrase and a response larger than 64 KiB. Each case makes one simulated upstream submission. No live Google inference was performed in this standalone checkout and no daily configuration or credentials were changed. Historical raw failure bodies were not retained; this update does not establish the exact upstream cause of an old `invalid_choice` event or recover absent output.

### 0.4.0 roleplay compatibility (2026-09-23)

`npm run verify` passed syntax/credential/private-path checks for 55 release files and all 74 local tests. Added coverage includes disabled profiles and upstream-401 visibility, transient failures, configuration recovery, protected 3.7/3.8 Flash prefills, JSON/SSE recovery in all three modes over compatible/native protocols, HTTP-200 error objects, fragmented SSE errors, bounded retry/cancellation/body limits, progressive output without late replay, and console persistence of 192000-byte text with JSON escape expansion.

An isolated real console with a mocked upstream verified sign-in, default toggles, a 27625-character save and page reload, disabled-profile hiding, successful recovery and its log indicator. Empty enabled-retry text displayed a validation error. Layout checks at 1280 and 390 pixels and in both themes showed no horizontal overflow; the browser reported no console errors. All credentials and replies were fixtures.

No live Google inference was performed and no daily credentials or runtime configuration were changed. Mock recovery does not establish that long custom text solves real upstream rejection or that prefill conversion preserves roleplay continuation behavior. The 0.3.x live results below are historical.

`npm run verify` runs syntax, credential and local-path checks, followed by local tests covering:

- Split JSON, escapes, Unicode, byte boundaries and parser bounds.
- Native `partialArgs` conversion, plain-text fallback, genuine tools and usage.
- HTTP authentication, model listing, field validation, Google host restrictions and request limits.
- HTTP delivery of text before the simulated upstream is allowed to finish.
- Field-preserving fallback and wrapper bypass for existing tools or structured output.
- Client cancellation, interrupted streams, upstream errors, length endings and no retries after output starts.
- Request-ID correlation and logs that exclude replies, prompts, random tool names and credentials.
- Console session, Host/Origin/CSRF boundaries, write-only credentials, revision conflicts, occupied ports, persistence and key rotation.
- Projectless Express endpoints, full service accounts with explicit target projects, Flex/Priority headers, native regular/streaming responses and actual tier logs.
- Native-only rejection of unsupported fields before inference, without automatic tier fallback.

Version 0.3.1 passes 53 local tests, adding empty/reasoning-only completions, terminal reasons for each candidate, missing DONE, invalid tool arguments, HTTP-200 error wrappers, Schema preflight and structured-output validation. Validation does not repair output; logs contain only fixed states and booleans. A desktop browser preview using the actual event-rendering functions and CSS checked seven integrity outcomes and request IDs. This was a component fixture, not a repeat of the full sign-in/configuration workflow.

Version 0.3.0 adds local tests for catalog authentication/pagination/errors, legacy migration, model persistence, alias routing, and normal/buffered/streaming modes with both JSON and SSE clients. Browser checks used a simulated catalog and upstream to save six profiles for two models, reject duplicate names, discard edits, reload saved profiles and select each mode for testing. Buffered replies arrived together; streaming replies arrived progressively. These checks do not verify real catalog permissions or model access.

The 0.2.0 browser check used isolated fixture credentials and a simulated upstream: Express/Flex save/apply, progressive text restoration, light/dark themes and narrow layouts. This does not prove live credentials, Gemini 3.7 availability or a particular account's Express/Flex/Priority entitlement.

These tests use local fixtures and make no Vertex calls. CI is configured for Node.js 22 and 24 on Linux, Windows and macOS, plus the minimum supported Node.js 22.9.0 on Linux; each job has a 15-minute limit. See [Actions](https://github.com/ken050210/vertex-streaming-anti-truncation/actions) for actual run results.

The standalone CLI was also checked on Windows with Node.js 24.16.0: health returned 200, an unauthenticated model request returned 401, and the authenticated model list was correct. The service bound to loopback. This check used dummy credentials and sent no model requests.

## Live standalone 0.3.1 requests

On 2026-09-22, an isolated loopback instance on Windows / Node.js 24.16.0 used service-account credentials held only in memory for three fixed-text Gemini 3.8 Flash requests, each capped at 512 output tokens:

- Standard normal non-streaming: HTTP 200, nonempty text and `stop`.
- Standard streaming anti-truncation: HTTP 200 and native argument streaming; 454 characters arrived in 7 content-bearing reads over 610 ms, with `restored: true`, `stop`, `[DONE]` and actual tier `ON_DEMAND`.
- Flex native strict Schema: HTTP 200 and a matching closed object. An array without `items` retained both `null` and a nested array; the response ended with `stop` and reported `ON_DEMAND_FLEX`.

All three request IDs matched their log events, with `responseIntegrity.outcome` set to `complete`. No daily settings were written and the temporary listener was closed. Live Express, Priority, other models, Google catalog permissions and SillyTavern UI behavior were outside this check.

## Live requests before extraction

On 2026-09-20, the original router integration tested the same streaming transport core with two fixed-text requests, each capped at 512 output tokens. Both the non-streaming and streaming requests returned HTTP 200, restored text and `stop`. The stream delivered content in 7 reads over 911 ms and ended with `[DONE]`. This shows that the Vertex reply arrived progressively in that run.

Those historical results belong to the original router integration and do not replace standalone checks; see the preceding section for 0.3.1 live standalone results. The default `npm run verify` continues to use only local fixtures. A health check only shows that the process is reachable.

## Check your own setup

After following the README and starting the service, run:

```sh
npm run smoke -- --live
```

This sends two client requests, each capped at 512 output tokens. With prompt recovery enabled, this can make up to four upstream submissions, and retries include the custom input text. It checks restoration for the normal reply, then checks nonempty text, `stop`, `[DONE]` and restoration for the stream. It also requires at least two content-bearing reads spanning at least 100 ms. Finally, it matches the response's `x-request-id` to `/admin/events`. With image input enabled, the command stops before sending any request, because image requests use the buffered fallback and cannot pass the streaming check.

The receipt contains metadata only. Read counts and timing depend on the model, network and buffering; one run cannot guarantee the same delivery pattern for every reply.

## What these checks do not establish

Short requests and simulated streams do not prove that long replies will avoid truncation. The gateway cannot restore content the model never generated or the network never delivered. A model may also return ordinary text directly, in which case the log reports `restored: false`.

Multiple Gemini models can now be configured; this does not establish live compatibility for every model. Compatibility with other providers, public remote deployment and other clients has not been established.
