export const MODEL_ID = "gemini-3.7-flash-antitruncation";
export const UPSTREAM_MODEL = "google/gemini-3.7-flash";
const MODEL_MODES = Object.freeze(["normal", "buffered", "streaming"]);

export function normalizeUpstreamModel(value) {
  if (typeof value !== "string") throw new Error("Invalid upstream Gemini model ID");
  const id = value.trim().replace(/^(?:google\/|publishers\/google\/models\/)/, "");
  if (!/^gemini-[a-z0-9][a-z0-9._-]{0,126}(?:@[a-z0-9-]{1,32})?$/.test(id) || id.includes("..")) throw new Error("Invalid upstream Gemini model ID");
  return "google/" + id;
}

// Relays name models in their own ways, so a custom upstream gets the name exactly as written.
// It only travels in the JSON body, never in a URL.
export function customUpstreamModel(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Invalid custom upstream model name");
  return name;
}

// The Gemini model a free-form name refers to, for model-specific handling only; "" when none.
export const geminiModelKey = name => /gemini-[a-z0-9][a-z0-9._-]*/i.exec(name)?.[0].toLowerCase() ?? "";

// Extracts the trailing [N] channel suffix required on custom-upstream client model IDs.
export function parseCustomModelId(value) {
  if (typeof value !== "string") return null;
  const match = /^([\p{L}\p{N}][\p{L}\p{N}._@-]{0,149})\[([1-9]\d{0,2})\]$/u.exec(value);
  return match ? { baseId: match[1], channel: Number(match[2]) } : null;
}

// Missing profiles are legacy settings, not an empty model list. Keep the old
// public ID and its selected behavior when upgrading an existing installation.
export function modelProfiles(value, legacyEnabled = true, { custom = false, channelCount = null, upstreamIds = null } = {}) {
  if (value === undefined || value === null) return [{ id: custom ? `${MODEL_ID}[1]` : MODEL_ID, upstreamModel: custom ? UPSTREAM_MODEL.replace(/^google\//, "") : UPSTREAM_MODEL,
    mode: legacyEnabled ? "streaming" : "normal" }];
  if (!Array.isArray(value) || value.length > 100) throw new Error("Model list must contain at most 100 entries");
  const ids = new Set();
  const normalizedRows = value.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(k => !["id", "upstreamModel", "mode", "enabled"].includes(k))) throw new Error("Invalid model profile");
    if (row.enabled !== undefined && typeof row.enabled !== "boolean") throw new Error("Invalid model enabled setting");
    if (typeof row.id !== "string") throw new Error("Invalid public model ID");
    if (custom) {
      const parsed = parseCustomModelId(row.id);
      if (!parsed) throw new Error("Custom upstream model ID must end with a channel suffix like [1]");
      if (channelCount != null && parsed.channel > channelCount) throw new Error("Model channel suffix exceeds configured custom upstreams");
    } else if (!/^[\p{L}\p{N}][\p{L}\p{N}._@-]{0,159}$/u.test(row.id)) {
      throw new Error("Invalid public model ID");
    }
    if (ids.has(row.id)) throw new Error("Model IDs must be unique");
    ids.add(row.id);
    if (!MODEL_MODES.includes(row.mode)) throw new Error("Invalid model mode");
    return { id: row.id, upstreamModel: custom ? customUpstreamModel(row.upstreamModel) : normalizeUpstreamModel(row.upstreamModel), mode: row.mode,
      ...(row.enabled !== undefined ? { enabled: row.enabled } : {}) };
  });
  if (custom) {
    const knownUpstreams = new Set(normalizedRows.map(r => r.upstreamModel));
    if (Array.isArray(upstreamIds)) for (const id of upstreamIds) if (typeof id === "string" && id.trim()) knownUpstreams.add(id.trim());
    for (const row of normalizedRows) {
      if (knownUpstreams.has(row.id)) throw new Error("Client model ID conflicts with an upstream model ID; please change the model alias");
    }
  }
  return normalizedRows;
}
