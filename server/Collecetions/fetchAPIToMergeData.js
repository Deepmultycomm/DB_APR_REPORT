// Collecetions/fetchAPIToMergeData.js
// This file is the primary service for fetching raw data and loading it into staging tables.
import fetch from "node-fetch";
import dotenv from "dotenv";
import { getPortalToken, httpsAgent } from "../tokenService.js";
import connection from "../DB/connection.js";

/* =========================
    ENV & CONSTANTS
    ========================= */
dotenv.config();

const API_BASE = process.env.API_BASE;
const ACCOUNT_ID = process.env.ACCOUNT_ID;
const TENANT = process.env.TENANT;
const PAGE_SIZE = process.env.PAGE_SIZE || 2000;

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RANGE_SEC = 31 * 24 * 3600; // 31 days in seconds

if (!API_BASE || !ACCOUNT_ID || !TENANT) {
  throw new Error("API_BASE, ACCOUNT_ID, and TENANT must be set in your .env file");
}

/* =========================
    SMALL UTILS
    ========================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const brief = (obj, max = 500) => {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj);
  return s.length <= max ? s : s.slice(0, max) + " …";
};

// --- NEW FUNCTION: Cleans URL-encoded names ---
function cleanName(name) {
    const s = String(name ?? '');
    // The '+' in URL encoding represents a space.
    const spaceFixed = s.replace(/\+/g, ' ');
    // Handles other encodings like %0A (newline), etc.
    try {
        return decodeURIComponent(spaceFixed).trim();
    } catch (e) {
        // If decoding fails, return the string as is to prevent crashes.
        return spaceFixed.trim();
    }
}

/** Convert ms → sec if needed; always return integer seconds */
function toSecondsMaybe(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) throw new Error(`Invalid timestamp: ${ts}`);
  return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
}

/** Ensure end > start and range <= 31 days */
function assertRangeOK(startSec, endSec) {
  if (endSec <= startSec) {
    throw new Error(`endSec (${endSec}) must be > startSec (${startSec})`);
  }
  const span = endSec - startSec;
  if (span > MAX_RANGE_SEC) {
    throw new Error(
      `Time range too large: ${span}s > ${MAX_RANGE_SEC}s (31 days). Adjust your windowing.`
    );
  }
}

/** Normalize API response payloads to a consistent array format */
function normalizeToArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.records)) return payload.records;
  if (payload?.data && Array.isArray(payload.data.items)) return payload.data.items;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

/** Create a MySQL DATETIME string in a specific timezone from a seconds epoch */
function toMySQLDatetimeFromSec(sec, tz = "Asia/Dubai") {
  const d = new Date(sec * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/** Safe type conversions for database insertion */
const str = (v) => (v === undefined || v === null ? "" : String(v));
const trimStr = (v) => str(v).trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

/* =========================
    WINDOW BUILDER (Chunks large time ranges)
    ========================= */
function buildWindows(startSec, endSec) {
  if (!startSec || !endSec) throw new Error("startSec and endSec required");
  if (endSec <= startSec) return [];

  const floorToHour = (sec) => {
    const d = new Date(sec * 1000);
    d.setUTCMinutes(0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  };
  const ceilToHour = (sec) => {
    const floored = floorToHour(sec);
    return sec === floored ? sec : floored + 3600;
  };

  const span = endSec - startSec;
  const nextHour = ceilToHour(startSec);

  if (span <= 600 || endSec <= nextHour) {
    return [{ startSec, endSec }];
  }

  const out = [];
  const firstEnd = Math.min(nextHour, endSec);
  if (firstEnd > startSec) out.push({ startSec, endSec: firstEnd });

  let s = firstEnd;
  while (s < endSec) {
    const e = Math.min(s + 3600, endSec);
    out.push({ startSec: s, endSec: e });
    s = e;
  }
  return out;
}

/* =========================
    API FETCHING SERVICE
    ========================= */
async function getAuthHeader() {
    const token = await getPortalToken(TENANT);
    console.log("first",token)
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "x-account-id": ACCOUNT_ID,
    };
}

async function fetchWithRetry(url, headers, { maxRetries = MAX_RETRIES, timeout = REQUEST_TIMEOUT_MS } = {}) {
  let attempt = 0;
  let lastErr;
  while (attempt <= maxRetries) {
    try {
      const r = await fetch(url, {
        method: "GET",
        headers,
        agent: httpsAgent,
        timeout,
      });
      if (!r.ok) {
        let bodySnippet = "";
        try {
          bodySnippet = brief(await r.text(), 400);
        } catch (_) {}
        throw new Error(`HTTP ${r.status} ${r.statusText} :: ${bodySnippet}`);
      }
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("application/json")) return await r.json();
      return await r.text();
    } catch (err) {
      lastErr = err;
      attempt++;
      if (attempt > maxRetries) break;
      const backoff = 500 * attempt;
      console.warn(`[fetchWithRetry] Attempt ${attempt}/${maxRetries} failed. Retrying in ${backoff}ms → ${url}\nReason: ${err.message}`);
      await sleep(backoff);
    }
  }
  throw new Error(`Request failed after ${MAX_RETRIES} retries: ${lastErr?.message || lastErr}`);
}

export async function fetchAPRDataService(startTs, endTs) {
  const startSec = toSecondsMaybe(startTs);
  const endSec = toSecondsMaybe(endTs);
  assertRangeOK(startSec, endSec);

  const headers = await getAuthHeader();
  const url = `${API_BASE}/api/v2/reports/callcenter/agents/activity/events?startDate=${startSec}&endDate=${endSec}&pageSize=${PAGE_SIZE}`;
  return await fetchWithRetry(url, headers);
}

export async function fetchAgentStatusDataService(startTs, endTs) {
  const startSec = toSecondsMaybe(startTs);
  const endSec = toSecondsMaybe(endTs);
  assertRangeOK(startSec, endSec);

  const headers = await getAuthHeader();
  const url = `${API_BASE}/api/v2/reports/callcenter/agents/stats?startDate=${startSec}&endDate=${endSec}`;
  return await fetchWithRetry(url, headers);
}

/* =========================
    SHAPE NORMALIZERS
    ========================= */
function extractAprEvents(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.events)) return raw.events;
  if (Array.isArray(raw.data)) return raw.data;
  return [];
}

function extractUsersCallsMap(raw) {
  const out = {};
  if (!raw) return out;

  if (typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (!v) continue;
      out[k] = v;
    }
    return out;
  }

  const arr = normalizeToArray(raw);
  for (const rec of arr) {
    const ext = rec?.ext ?? rec?.extension ?? rec?.agent_ext;
    if (!ext) continue;
    out[String(ext)] = rec;
  }
  return out;
}

/* =========================
    DB CONNECTION HELPER
    ========================= */
async function acquirePromiseConnection() {
  const root = typeof connection?.promise === "function" ? connection.promise() : connection;

  if (typeof root?.getConnection === "function") {
    const pooled = await root.getConnection();
    return {
      conn: pooled,
      release: async () => {
        try { await pooled.release(); } catch (_) {}
      },
    };
  }

  return {
    conn: root,
    release: async () => {},
  };
}

/* =========================
    MAIN ETL LOGIC
    ========================= */
export async function fetchAndMergeData(startTime, endTime) {
  const startSec = toSecondsMaybe(startTime);
  const endSec = toSecondsMaybe(endTime);
  const windows = buildWindows(startSec, endSec);

  for (const w of windows) {
    const startDt = toMySQLDatetimeFromSec(w.startSec, "Asia/Dubai");
    const endDt = toMySQLDatetimeFromSec(w.endSec, "Asia/Dubai");

    const { conn, release } = await acquirePromiseConnection();

    try {
      if (typeof conn.beginTransaction !== "function") {
        throw new Error("MySQL connection is not promise-capable; missing beginTransaction().");
      }

      await conn.beginTransaction();

      // Fetch both endpoints for this window
      const [agent_events_raw, users_calls_raw] = await Promise.all([
        fetchAPRDataService(w.startSec, w.endSec),
        fetchAgentStatusDataService(w.startSec, w.endSec),
      ]);

      // Group events by extension
      const aprEventsArr = extractAprEvents(agent_events_raw);
      const agent_events_by_ext = {};
      for (const evt of aprEventsArr) {
        const ext = trimStr(evt?.ext);
        if (!ext) continue;
        if (!agent_events_by_ext[ext]) {
          agent_events_by_ext[ext] = { nameFromEvents: cleanName(evt?.username), events: [] };
        }
        agent_events_by_ext[ext].events.push(evt);
        if (!agent_events_by_ext[ext].nameFromEvents && cleanName(evt?.username)) {
          agent_events_by_ext[ext].nameFromEvents = cleanName(evt?.username);
        }
      }

      // Build users_calls map keyed by extension
      const users_calls_map = extractUsersCallsMap(users_calls_raw);

      // Create a complete list of all agents from both sources
      const allExts = new Set([
        ...Object.keys(agent_events_by_ext),
        ...Object.keys(users_calls_map),
      ]);

      let upsertsUsers = 0;
      let insertsEvents = 0;

      // Pass 1: Ensure a parent row exists in `users_calls` for each agent.
      for (const ext of allExts) {
        const ue = agent_events_by_ext[ext] || { nameFromEvents: "" };
        const uc = users_calls_map[ext] || null;

        // --- MODIFIED: Use cleanName function here ---
        const statsName = cleanName(uc?.name);
        const eventName = cleanName(ue?.nameFromEvents);
        const canonicalName = statsName || eventName || "";

        const sqlUsers = `
          INSERT INTO users_calls (
            ext, name, tags, total_calls, answered_calls, talked_time, talked_average, duration_seconds,
            max_connect_seconds, avg_connect_seconds, total_connect_seconds, callee_id_number, callee_id_name,
            registered_time, idle_time, wrap_up_time, hold_time, on_call_time, on_call_time_avg, not_available_time,
            not_available_detailed_report, start_timestamp, end_timestamps
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name), tags=VALUES(tags), total_calls=VALUES(total_calls), answered_calls=VALUES(answered_calls),
            talked_time=VALUES(talked_time), talked_average=VALUES(talked_average), duration_seconds=VALUES(duration_seconds),
            max_connect_seconds=VALUES(max_connect_seconds), avg_connect_seconds=VALUES(avg_connect_seconds),
            total_connect_seconds=VALUES(total_connect_seconds), callee_id_number=VALUES(callee_id_number),
            callee_id_name=VALUES(callee_id_name), registered_time=VALUES(registered_time), idle_time=VALUES(idle_time),
            wrap_up_time=VALUES(wrap_up_time), hold_time=VALUES(hold_time), on_call_time=VALUES(on_call_time),
            on_call_time_avg=VALUES(on_call_time_avg), not_available_time=VALUES(not_available_time),
            not_available_detailed_report=VALUES(not_available_detailed_report), start_timestamp=VALUES(start_timestamp),
            end_timestamps=VALUES(end_timestamps)`;

        const valuesUsers = [
          trimStr(ext), canonicalName, uc?.tags ? JSON.stringify(uc.tags) : null,
          num(uc?.total_calls), num(uc?.answered_calls), num(uc?.talked_time),
          num(uc?.talked_average), num(uc?.duration_seconds), num(uc?.max_connect_seconds),
          num(uc?.avg_connect_seconds), num(uc?.total_connect_seconds), trimStr(uc?.callee_id_number),
          trimStr(uc?.callee_id_name), num(uc?.registered_time), num(uc?.idle_time),
          num(uc?.wrap_up_time), num(uc?.hold_time), num(uc?.on_call_time),
          num(uc?.on_call_time_avg), num(uc?.not_available_time),
          uc?.not_available_detailed_report ? JSON.stringify(uc.not_available_detailed_report) : null,
          startDt, endDt,
        ];

        await conn.execute(sqlUsers, valuesUsers);
        upsertsUsers++;

        if (agent_events_by_ext[ext]) {
          agent_events_by_ext[ext].canonicalName = canonicalName;
        } else {
          agent_events_by_ext[ext] = { canonicalName, events: [] };
        }
      }

      // Pass 2: Insert the raw event data into `agent_events`.
      for (const ext of allExts) {
        const ue = agent_events_by_ext[ext] || { canonicalName: "", events: [] };
        // --- MODIFIED: Ensure canonicalName is clean here too ---
        const canonicalName = cleanName(ue.canonicalName);
        const events = Array.isArray(ue.events) ? ue.events : [];

        for (const evt of events) {
          const sqlEvt = `
            INSERT INTO agent_events (
              event, enabled, user_id, ext, username, state, ts_epoch, start_timestamp, end_timestamps
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

          const valuesEvt = [
            trimStr(evt?.event), evt?.enabled ? 1 : 0,
            evt?.user_id ? String(evt.user_id).slice(0, 32) : null,
            trimStr(ext), canonicalName,
            evt?.state == null ? null : trimStr(evt.state),
            num(evt?.Timestamp),
            startDt, endDt,
          ];

          await conn.execute(sqlEvt, valuesEvt);
          insertsEvents++;
        }
      }

      await conn.commit();
      console.log(`✓ [${startDt} → ${endDt}] users_calls upserts=${upsertsUsers}, agent_events inserts=${insertsEvents}`);
    } catch (err) {
      try { await conn.rollback(); } catch (_) {}
      console.error(`✗ [${startDt} → ${endDt}] Transaction ERROR: ${err.message}`);
      // Re-throw the error to let the scheduler know the tick failed
      throw err;
    } finally {
      await release();
    }
  }
}