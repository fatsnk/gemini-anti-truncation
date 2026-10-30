import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_RAW_RESPONSE_LIMIT = 10;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const SAFE_LOG_FILE = /^[0-9TZ_-]+_[0-9NA]+_[a-f0-9]{8}\.log$/i;

function sanitizeText(text, secret) {
  let out = typeof text === "string" ? text : String(text ?? "");
  if (typeof secret === "string" && secret.length >= 8) {
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

function collectHeaders(headers) {
  const result = {};
  if (!headers || typeof headers.entries !== "function") return result;
  for (const [name, value] of headers.entries()) {
    const lower = name.toLowerCase();
    if (lower === "set-cookie" || lower === "authorization" || lower === "x-goog-api-key") continue;
    result[lower] = value;
  }
  return result;
}

// Wraps an upstream fetch Response so every chunk read downstream is recorded verbatim
// without adding buffering latency to streaming responses.
export function tapUpstreamResponse(rawResponse, { url = "", attempt = 1, maxBytes = MAX_CAPTURE_BYTES, shouldDrainOnCancel = () => false } = {}) {
  const chunks = [];
  let capturedBytes = 0;
  let truncated = false;
  let completed = !rawResponse.body;
  let cancelled = false;
  let streamError = null;

  const recordChunk = value => {
    if (!value?.byteLength) return;
    if (capturedBytes < maxBytes) {
      const remaining = maxBytes - capturedBytes;
      const slice = value.byteLength <= remaining ? Buffer.from(value) : Buffer.from(value.subarray(0, remaining));
      chunks.push(slice);
      capturedBytes += slice.length;
      if (slice.length < value.byteLength) truncated = true;
    } else {
      truncated = true;
    }
  };

  const record = {
    attempt,
    url,
    status: rawResponse.status,
    statusText: rawResponse.statusText || "",
    headers: collectHeaders(rawResponse.headers),
    get capturedBytes() { return capturedBytes; },
    get truncated() { return truncated; },
    get completed() { return completed; },
    get cancelled() { return cancelled; },
    get streamError() { return streamError; },
    getRawBody() { return Buffer.concat(chunks).toString("utf8"); },
  };

  if (!rawResponse.body) return { response: rawResponse, record };

  const reader = rawResponse.body.getReader();
  const wrapped = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          completed = true;
          controller.close();
          return;
        }
        recordChunk(value);
        controller.enqueue(value);
      } catch (error) {
        streamError = error?.code || error?.message || "stream_read_error";
        throw error;
      }
    },
    async cancel(reason) {
      // When the gateway cancels an upstream error/refusal body early (e.g. after 16 KiB error
      // inspection), drain up to a bounded limit so the user can inspect the full error payload.
      if (!completed && shouldDrainOnCancel(rawResponse)) {
        const drainCap = rawResponse.ok ? Math.min(maxBytes, capturedBytes + 64 * 1024) : maxBytes;
        const timer = setTimeout(() => reader.cancel().catch(() => {}), 2000);
        try {
          while (capturedBytes < drainCap) {
            const { done, value } = await reader.read();
            if (done) { completed = true; break; }
            recordChunk(value);
          }
        } catch { /* keep partial bytes */ }
        finally { clearTimeout(timer); }
      }
      if (!completed) cancelled = true;
      return reader.cancel(reason).catch(() => {});
    },
  });

  const response = new Response(wrapped, {
    status: rawResponse.status,
    statusText: rawResponse.statusText,
    headers: rawResponse.headers,
  });
  return { response, record };
}

export function formatRawResponseLog(meta, attempts, secret) {
  const lines = [
    "=== UPSTREAM RAW RESPONSE LOG ===",
    `Time:           ${meta.at}`,
    `Request ID:     ${meta.requestId}`,
    `Client Model:   ${meta.model || "—"}`,
    `Upstream Model: ${meta.upstreamModel || "—"}`,
    `Mode:           ${meta.mode || "—"} (client stream: ${Boolean(meta.stream)})`,
    `Gateway Status: ${meta.status}${meta.code ? ` (${meta.code})` : ""}`,
    `Latency:        ${meta.latencyMs} ms`,
    "",
  ];

  if (!attempts?.length) {
    lines.push("--- No Upstream HTTP Response ---");
    lines.push(meta.code
      ? `请求在收到上游 HTTP 响应前结束，网关错误码：${meta.code}`
      : "未产生上游 HTTP 响应记录。");
    lines.push("");
    return lines.join("\n");
  }

  for (const item of attempts) {
    lines.push(`--- Upstream Attempt #${item.attempt} ---`);
    if (item.url) lines.push(`URL: ${sanitizeText(item.url, secret)}`);
    if (item.networkError) {
      lines.push(`Network Error: ${sanitizeText(item.networkError, secret)}`);
      lines.push("");
      continue;
    }
    lines.push(`HTTP Status: ${item.status}${item.statusText ? " " + item.statusText : ""}`);
    const headerEntries = Object.entries(item.headers || {});
    if (headerEntries.length) {
      lines.push("Response Headers:");
      for (const [k, v] of headerEntries) lines.push(`  ${k}: ${sanitizeText(v, secret)}`);
    }
    const stateNotes = [
      `${item.capturedBytes ?? 0} bytes`,
      item.completed ? "complete" : item.cancelled ? "cancelled/partial" : "incomplete",
      ...(item.truncated ? ["truncated at 8 MiB"] : []),
      ...(item.streamError ? [`stream error: ${sanitizeText(item.streamError, secret)}`] : []),
    ];
    lines.push(`Body State: ${stateNotes.join(" · ")}`);
    lines.push("");
    lines.push("[Raw Body]");
    const rawBody = sanitizeText(typeof item.getRawBody === "function" ? item.getRawBody() : (item.rawBody || ""), secret);
    lines.push(rawBody || "(empty body)");
    lines.push("");
  }
  return lines.join("\n");
}

function fileNameFor(at, status, requestId) {
  const stamp = String(at || new Date().toISOString()).replace(/[:.]/g, "-");
  const code = Number.isInteger(status) ? String(status) : "NA";
  const shortId = String(requestId || "00000000").replace(/[^a-f0-9]/gi, "").slice(0, 8).padEnd(8, "0");
  return `${stamp}_${code}_${shortId}.log`;
}

export function createRawResponseLogStore({ directory = process.env.GATEWAY_STATE_DIR || join(homedir(), ".vertex-streaming-anti-truncation") } = {}) {
  const rawDir = join(directory, "raw-responses");
  const indexFile = join(rawDir, "index.json");
  let queue = Promise.resolve();

  const serialize = fn => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function readIndexUnlocked() {
    let raw;
    try { raw = await readFile(indexFile, "utf8"); }
    catch (error) {
      if (error.code === "ENOENT") return [];
      return [];
    }
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data?.entries)) return [];
      return data.entries.filter(item => item && typeof item.requestId === "string" && SAFE_LOG_FILE.test(item.file || ""));
    } catch {
      return [];
    }
  }

  async function writeIndexUnlocked(entries) {
    await mkdir(rawDir, { recursive: true, mode: 0o700 });
    const temp = `${indexFile}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, entries }, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await rename(temp, indexFile);
  }

  async function syncFilesUnlocked(keepEntries) {
    const keepFiles = new Set(keepEntries.map(e => e.file));
    let names = [];
    try { names = await readdir(rawDir); } catch { return; }
    for (const name of names) {
      if (name === "index.json" || name.endsWith(".tmp")) continue;
      if (SAFE_LOG_FILE.test(name) && !keepFiles.has(name)) {
        await unlink(join(rawDir, name)).catch(() => {});
      }
    }
  }

  return {
    directory: rawDir,
    async record(meta, attempts, { limit = DEFAULT_RAW_RESPONSE_LIMIT, credential = null } = {}) {
      const maxEntries = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, 100) : DEFAULT_RAW_RESPONSE_LIMIT;
      const content = formatRawResponseLog(meta, attempts, credential);
      const bytes = Buffer.byteLength(content, "utf8");
      const file = fileNameFor(meta.at, meta.status, meta.requestId);
      const lastAttempt = attempts?.length ? attempts[attempts.length - 1] : null;
      const summary = {
        requestId: meta.requestId,
        at: meta.at,
        model: meta.model || null,
        upstreamModel: meta.upstreamModel || null,
        mode: meta.mode || null,
        stream: Boolean(meta.stream),
        status: meta.status,
        code: meta.code || null,
        upstreamStatus: lastAttempt?.status ?? null,
        attempts: attempts?.length || 0,
        latencyMs: meta.latencyMs,
        bytes,
        file,
      };
      return serialize(async () => {
        await mkdir(rawDir, { recursive: true, mode: 0o700 });
        await writeFile(join(rawDir, file), content, { encoding: "utf8", mode: 0o600 });
        const existing = (await readIndexUnlocked()).filter(e => e.requestId !== meta.requestId);
        const next = [summary, ...existing].slice(0, maxEntries);
        await writeIndexUnlocked(next);
        await syncFilesUnlocked(next);
        return summary;
      });
    },
    async list() {
      const entries = await readIndexUnlocked();
      const verified = [];
      for (const item of entries) {
        const exists = await stat(join(rawDir, item.file)).then(info => info.isFile(), () => false);
        if (exists) verified.push(item);
      }
      return verified;
    },
    async get(requestId) {
      if (typeof requestId !== "string" || !requestId) return null;
      const entries = await readIndexUnlocked();
      const found = entries.find(e => e.requestId === requestId);
      if (!found || !SAFE_LOG_FILE.test(found.file)) return null;
      try {
        const content = await readFile(join(rawDir, found.file), "utf8");
        return { ...found, content };
      } catch {
        return null;
      }
    },
    async prune(limit = DEFAULT_RAW_RESPONSE_LIMIT) {
      const maxEntries = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, 100) : DEFAULT_RAW_RESPONSE_LIMIT;
      return serialize(async () => {
        const existing = await readIndexUnlocked();
        const next = existing.slice(0, maxEntries);
        if (existing.length || next.length) {
          await writeIndexUnlocked(next);
          await syncFilesUnlocked(next);
        }
        return next;
      });
    },
    async clear() {
      return serialize(async () => {
        let names = [];
        try { names = await readdir(rawDir); } catch { return; }
        for (const name of names) {
          if (name === "index.json" || SAFE_LOG_FILE.test(name)) {
            await unlink(join(rawDir, name)).catch(() => {});
          }
        }
      });
    },
  };
}