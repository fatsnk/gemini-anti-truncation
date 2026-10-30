import { readFile, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS, SECRET_FIELDS, buildConfig, buildConnectionConfig, settingsFromEnv } from "./config.mjs";
import { modelProfiles } from "./model-profiles.mjs";

export class SettingsError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const revisionOf = text => createHash("sha256").update(text).digest("hex");
const settingNames = new Set(Object.keys(DEFAULT_SETTINGS));

export function mergeSettings(current, patch, { connectionOnly = false, channel = null, upstreamIds = null } = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(k => !settingNames.has(k))) throw new SettingsError("Invalid configuration fields");
  const next = { ...current };
  const currentUpstreams = Array.isArray(current.customUpstreams) && current.customUpstreams.length
    ? current.customUpstreams
    : (current.customBaseUrl || current.customApiKey ? [{ baseUrl: current.customBaseUrl || "", apiKey: current.customApiKey || "" }] : []);
  for (const [key, value] of Object.entries(patch)) {
    if (key === "customUpstreams") {
      if (value === null) {
        next.customUpstreams = null;
        next.customBaseUrl = "";
        next.customApiKey = "";
        continue;
      }
      if (!Array.isArray(value) || value.length > 32) throw new SettingsError("Invalid custom upstream configuration");
      next.customUpstreams = value.map((item, idx) => {
        if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(k => !["baseUrl", "apiKey", "savedIndex"].includes(k))) {
          throw new SettingsError("Invalid custom upstream configuration");
        }
        const baseUrl = typeof item.baseUrl === "string" ? item.baseUrl.trim() : "";
        const sourceIndex = item.savedIndex !== undefined
          ? (Number.isInteger(item.savedIndex) && item.savedIndex >= 0 && item.savedIndex < currentUpstreams.length ? item.savedIndex : -1)
          : idx;
        let apiKey = sourceIndex >= 0 ? (currentUpstreams[sourceIndex]?.apiKey || "") : "";
        if (item.apiKey === null) {
          apiKey = "";
        } else if (item.apiKey !== undefined) {
          if (typeof item.apiKey !== "string" || item.apiKey.length > 128 * 1024) throw new SettingsError("Invalid credential field");
          if (item.apiKey.trim()) apiKey = item.apiKey.trim().replace(/^\uFEFF/, "");
        }
        return { baseUrl, apiKey };
      });
      next.customBaseUrl = next.customUpstreams[0]?.baseUrl || "";
      next.customApiKey = next.customUpstreams[0]?.apiKey || "";
    } else if (SECRET_FIELDS.includes(key)) {
      // Blank keeps the stored secret; null removes it.
      if (value === null) { next[key] = ""; continue; }
      if (typeof value !== "string" || value.length > 128 * 1024) throw new SettingsError("Invalid credential field");
      if (value.trim()) next[key] = value.trim().replace(/^\uFEFF/, "");
    } else next[key] = value;
  }
  if (patch.customUpstreams === undefined && (patch.customBaseUrl !== undefined || patch.customApiKey !== undefined)) {
    if (patch.customApiKey === null) {
      next.customUpstreams = null;
    } else if (Array.isArray(next.customUpstreams) && next.customUpstreams.length <= 1) {
      next.customUpstreams = next.customBaseUrl || next.customApiKey ? [{ baseUrl: next.customBaseUrl, apiKey: next.customApiKey }] : null;
    }
  }
  if (next.authMode === "service-account" && !next.projectId && next.serviceAccountJson) {
    try { next.projectId = JSON.parse(next.serviceAccountJson).project_id || ""; } catch { /* Validated below. */ }
  }
  if (connectionOnly) buildConnectionConfig(next, { channel });
  else {
    const conn = buildConnectionConfig(next);
    if (next.models != null) {
      next.models = modelProfiles(next.models, true, {
        custom: next.authMode === "custom",
        channelCount: next.authMode === "custom" ? conn.customUpstreams.length : null,
        upstreamIds,
      });
    }
    buildConfig(next, { upstreamIds });
  }
  return next;
}

export function createSettingsStore({ directory = process.env.GATEWAY_STATE_DIR || join(homedir(), ".vertex-streaming-anti-truncation"), env = process.env } = {}) {
  const file = join(directory, "settings.json");
  const lock = join(directory, "settings.lock");
  const recoveryLock = lock + ".recovery";
  async function load() {
    let raw;
    try { raw = await readFile(file, "utf8"); }
    catch (error) {
      if (error.code !== "ENOENT") throw new SettingsError("Cannot read saved configuration", 500);
      // A bad environment value (for example a system-wide GOOGLE_APPLICATION_CREDENTIALS naming a
      // missing file) must not lock out the GUI that replaces .env: start from defaults and report it.
      try { return { settings: await settingsFromEnv(env), revision: "new", saved: false }; }
      catch (envError) { return { settings: { ...DEFAULT_SETTINGS }, revision: "new", saved: false, envError: envError.message }; }
    }
    try {
      const data = JSON.parse(raw);
      if (data.version !== 1 || !data.settings || Object.keys(data.settings).some(k => !settingNames.has(k))) throw new Error();
      const settings = { ...DEFAULT_SETTINGS, ...data.settings };
      buildConfig(settings, { requireAscii: false });
      return { settings, revision: revisionOf(raw), saved: true };
    } catch { throw new SettingsError("Saved configuration is invalid; the existing file was preserved", 500); }
  }
  async function acquireLock() {
    try { return await open(lock, "wx", 0o600); }
    catch (error) { if (error.code !== "EEXIST") throw new SettingsError("Cannot lock configuration", 409); }
    // A save holds the lock for milliseconds. An older lock was left by a process
    // that exited mid-save and would otherwise block every later save.
    // Serialize recovery itself: two readers of the same stale lock must not
    // unlink a fresh lock created by the other recovery attempt. Recheck its age
    // while owning the recovery marker, including when a normal save won first.
    let recovery;
    try { recovery = await open(recoveryLock, "wx", 0o600); }
    catch { throw new SettingsError("Configuration is being edited by another process", 409); }
    try {
      const age = await stat(lock).then(info => Date.now() - info.mtimeMs, error => {
        if (error.code === "ENOENT") return null;
        throw new SettingsError("Cannot lock configuration", 409);
      });
      if (age !== null) {
        if (age < 60000) throw new SettingsError("Configuration is being edited by another process", 409);
        await unlink(lock).catch(error => {
          if (error.code !== "ENOENT") throw new SettingsError("Cannot lock configuration", 409);
        });
      }
      try { return await open(lock, "wx", 0o600); }
      catch { throw new SettingsError("Configuration is being edited by another process", 409); }
    } finally {
      // Never steal an existing recovery marker by age: doing so would recreate
      // the same race. Interrupted recovery fails closed until its marker is removed.
      await recovery.close();
      await unlink(recoveryLock);
    }
  }
  async function save(settings, revision) {
    buildConfig(settings);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const held = await acquireLock();
    const temporary = file + "." + randomUUID() + ".tmp";
    try {
      if ((await load()).revision !== revision) throw new SettingsError("Configuration changed; reload before saving", 409);
      const raw = JSON.stringify({ version: 1, settings }, null, 2) + "\n";
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(raw, "utf8"); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
      return { settings, revision: revisionOf(raw), saved: true };
    } finally {
      await unlink(temporary).catch(() => {});
      await held.close(); await unlink(lock);
    }
  }
  return { load, save, directory };
}
