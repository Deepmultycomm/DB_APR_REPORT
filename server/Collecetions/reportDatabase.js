// agent_activity_aggregator.js
import dotenv from "dotenv";
import pool from "../DB/connection.js";

dotenv.config();

/* =========================
   CONSTANTS
   ========================= */
const TZ = "Asia/Dubai";
const LOOKBACK_SEC = 6 * 3600;
const DUBAI_OFFSET_SEC = 4 * 3600;

/* =========================
   UTILS
   ========================= */
const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
};
const normStr = (v) => String(v ?? "").trim();
const normState = (v) => normStr(v).toLowerCase();

function toMySQLDatetimeFromSec(sec, tz = TZ) {
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
function toMySQLHourBucketStartFromSec(sec, tz = TZ) {
  const d = new Date(sec * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:00:00`;
}

/* =========================
   DUBAI-HOUR WINDOWS
   ========================= */
export function dubaiFloorToHour(sec) {
  return Math.floor((sec + DUBAI_OFFSET_SEC) / 3600) * 3600 - DUBAI_OFFSET_SEC;
}
function buildDubaiHourWindows(startSec, endSec) {
  if (!(endSec > startSec)) return [];
  const windows = [];
  let s = dubaiFloorToHour(startSec);
  while (s + 3600 <= endSec) {
    const e = s + 3600;
    if (s >= startSec && e <= endSec) {
      windows.push({ startSec: s, endSec: e });
    }
    s = e;
  }
  return windows;
}

/* =========================
   FETCH EVENTS
   ========================= */
async function fetchEventsForWindow(conn, startSec, endSec) {
  const ctxStart = startSec - LOOKBACK_SEC;
  const sql = `
    SELECT id, event AS event_type, enabled,
           ext AS agent_ext, username AS agent_name,
           state AS event_state, ts_epoch AS ts
    FROM agent_events
    WHERE ts_epoch >= ? AND ts_epoch < ?
    ORDER BY agent_ext, ts_epoch, id
  `;
  const [rows] = await conn.execute(sql, [ctxStart, endSec]);
  return rows.map(r => ({
    id: r.id,
    type: normStr(r.event_type),
    enabled: toInt(r.enabled),
    ext: normStr(r.agent_ext),
    name: normStr(r.agent_name),
    state: normState(r.event_state),
    ts: toInt(r.ts),
  }));
}
function groupByExt(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.ext) continue;
    if (!map.has(r.ext)) map.set(r.ext, []);
    map.get(r.ext).push(r);
  }
  return map;
}

/* =========================
   PRESENCE CLASSIFICATION
   ========================= */
function lastEventAtOrBefore(events, ts) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].ts <= ts) return events[i];
  }
  return null;
}
function resolveEffectiveLabelForTime(events, ts) {
  const cur = lastEventAtOrBefore(events, ts);
  if (!cur) return { type: "agent_not_avail_state", state: "logoff" };
  if (cur.enabled === 1) return { type: cur.type, state: cur.state || "none" };
  if (cur.state === "none") {
    const lookFrom = ts - LOOKBACK_SEC;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.ts > ts) continue;
      if (e.ts < lookFrom) break;
      if (e.enabled === 1) return { type: e.type, state: e.state || "none" };
    }
    return { type: "agent_not_avail_state", state: "logoff" };
  }
  return { type: cur.type, state: cur.state || "none" };
}

/* =========================
   METRICS (cut-time based)
   ========================= */
function accumulatePresenceMetricsForAgent(allEvents, startSec, endSec) {
  const cutTimes = [startSec];
  for (const e of allEvents) {
    if (e.ts >= startSec && e.ts < endSec) cutTimes.push(e.ts);
  }
  cutTimes.push(endSec);
  cutTimes.sort((a, b) => a - b);

  const m = { available_status_secs: 0, login_secs: 0, logoff_secs: 0,
              productive_break_secs: 0, non_prod_break_secs: 0, dnd_secs: 0 };

  for (let i = 0; i < cutTimes.length - 1; i++) {
    const a = cutTimes[i], b = cutTimes[i + 1];
    if (b <= a) continue;
    const eff = resolveEffectiveLabelForTime(allEvents, a);
    const sec = b - a;
    if (eff.type === "agent_idle" && eff.state === "available") m.available_status_secs += sec;
    else if (eff.type === "agent_not_avail_state") {
      if (eff.state === "login") m.login_secs += sec;
      else if (eff.state === "logoff") m.logoff_secs += sec;
      else if (eff.state === "dnd") m.dnd_secs += sec;
      else if (["team meeting","training","on tickets","outbound"].includes(eff.state)) m.productive_break_secs += sec;
      else if (["lunch","tea break","not available","break"].includes(eff.state)) m.non_prod_break_secs += sec;
    } else if (eff.type === "agent_dnd") m.dnd_secs += sec;
  }
  return m;
}

/* =========================
   METRICS (pair-based duration)
   ========================= */
function accumulateDurationsFromPairs(events) {
  const m = { talk_time_secs: 0, wrap_up_time_secs: 0, idle_time_secs: 0, hold_time_secs: 0,
              productive_break_secs: 0, non_prod_break_secs: 0 };

  const openMap = {};

  for (const e of events) {
    const key = e.type + "|" + (e.state || "");

    if (["agent_on_call","agent_wrap_up","agent_idle","agent_hold"].includes(e.type)) {
      if (e.enabled === 1) {
        openMap[key] = e.ts;
      } else if (e.enabled === 0 && openMap[key]) {
        const dur = e.ts - openMap[key];
        if (e.type === "agent_on_call") m.talk_time_secs += dur;
        else if (e.type === "agent_wrap_up") m.wrap_up_time_secs += dur;
        else if (e.type === "agent_idle") m.idle_time_secs += dur;
        else if (e.type === "agent_hold") m.hold_time_secs += dur;
        delete openMap[key];
      }
    } else if (e.type === "agent_not_avail_state") {
      if (e.enabled === 1) {
        openMap[key] = e.ts;
      } else if (e.enabled === 0 && openMap[key]) {
        const dur = e.ts - openMap[key];
        if (["login","outbound","onticket","training","onchat"].includes(e.state)) {
          m.productive_break_secs += dur;
        } else if (["lunch","tea break","not available","break"].includes(e.state)) {
          m.non_prod_break_secs += dur;
        }
        delete openMap[key];
      }
    }
  }

  return m;
}

/* =========================
   COUNTS
   ========================= */
function countStartsForAgent(winEvents) {
  let idleCount = 0, notAvailCount = 0;
  for (const e of winEvents) {
    if (e.enabled !== 1) continue;
    if (e.type === "agent_idle") idleCount++;
    if (e.type === "agent_not_avail_state") notAvailCount++;
  }
  return { idleCount, notAvailCount };
}
function combineMetrics(presence) {
  return {
    available_status_secs: toInt(presence.available_status_secs),
    login_secs: toInt(presence.login_secs),
    logoff_secs: toInt(presence.logoff_secs),
    productive_break_secs: toInt(presence.productive_break_secs),
    non_prod_break_secs: toInt(presence.non_prod_break_secs),
    dnd_secs: toInt(presence.dnd_secs),
    talk_time_secs: 0,
    idle_time_secs: 0,
    wrap_up_time_secs: 0,
    hold_time_secs: 0,
    total_calls: 0,
    answered_calls: 0,
    failed_calls: 0,
  };
}

/* =========================
   UPSERT INTO agent_activity
   ========================= */
async function upsertHourlyRow(conn, agent_ext, agent_name, reportHourStr, startStr, endStr, counts, metrics) {
  const [rows] = await conn.execute(
    `SELECT id FROM agent_activity WHERE row_kind='hourly' AND agent_ext=? AND report_hour=? LIMIT 1`,
    [agent_ext, reportHourStr]
  );

  if (rows.length > 0) {
    const id = rows[0].id;
    const sqlUpd = `
      UPDATE agent_activity
         SET agent_name=?, start_time=?, end_time=?,
             available_status_secs=?, login_secs=?, logoff_secs=?,
             productive_break_secs=?, non_prod_break_secs=?, dnd_secs=?,
             idle_count=?, notavail_count=?,
             total_calls=?, answered_calls=?, failed_calls=?,
             talk_time_secs=?, idle_time_secs=?, wrap_up_time_secs=?, hold_time_secs=?
       WHERE id=?`;
    const paramsUpd = [
      agent_name || "", startStr, endStr,
      metrics.available_status_secs, metrics.login_secs, metrics.logoff_secs,
      metrics.productive_break_secs, metrics.non_prod_break_secs, metrics.dnd_secs,
      counts.idleCount, counts.notAvailCount,
      metrics.total_calls, metrics.answered_calls, metrics.failed_calls,
      metrics.talk_time_secs, metrics.idle_time_secs, metrics.wrap_up_time_secs, metrics.hold_time_secs,
      id,
    ];
    await conn.execute(sqlUpd, paramsUpd);
    return;
  }

  const INS_COLS = [
    "row_kind","agent_ext","agent_name","report_hour","start_time","end_time",
    "available_status_secs","login_secs","logoff_secs","productive_break_secs","non_prod_break_secs","dnd_secs",
    "idle_count","notavail_count","total_calls","answered_calls","failed_calls",
    "talk_time_secs","idle_time_secs","wrap_up_time_secs","hold_time_secs"
  ];
  const INS_SQL = `INSERT INTO agent_activity (${INS_COLS.join(", ")}) VALUES (${INS_COLS.map(() => "?").join(", ")})`;
  const paramsIns = [
    "hourly", agent_ext, agent_name || "", reportHourStr, startStr, endStr,
    metrics.available_status_secs, metrics.login_secs, metrics.logoff_secs,
    metrics.productive_break_secs, metrics.non_prod_break_secs, metrics.dnd_secs,
    counts.idleCount, counts.notAvailCount,
    metrics.total_calls, metrics.answered_calls, metrics.failed_calls,
    metrics.talk_time_secs, metrics.idle_time_secs, metrics.wrap_up_time_secs, metrics.hold_time_secs
  ];

  await conn.execute(INS_SQL, paramsIns);

  const [verify] = await conn.execute(
    "SELECT COUNT(*) AS cnt FROM agent_activity WHERE agent_ext=? AND report_hour=?",
    [agent_ext, reportHourStr]
  );
  console.log("Verified insert:", agent_ext, reportHourStr, verify[0].cnt);
}

/* =========================
   PROCESS ONE HOUR
   ========================= */
async function processOneHourWindow(conn, hourStartSec) {
  const startSec = hourStartSec;
  const endSec   = hourStartSec + 3600;

  const startStr = toMySQLDatetimeFromSec(startSec, TZ);
  const endStr   = toMySQLDatetimeFromSec(endSec, TZ);
  const reportHourStr = toMySQLHourBucketStartFromSec(startSec, TZ);

  const allRows = await fetchEventsForWindow(conn, startSec, endSec);
  const byExt = groupByExt(allRows);

  let processedAgents = 0;
  for (const [ext, list] of byExt.entries()) {
    if (!ext) continue;
    const pre=[], win=[];
    for (const e of list) {
      if (e.ts < startSec) pre.push(e); else if (e.ts < endSec) win.push(e);
    }
    const all = [...pre, ...win];
    const name = (all.find(e => !!e.name)?.name) || "";

    const presence = accumulatePresenceMetricsForAgent(all, startSec, endSec);
    let metrics  = combineMetrics(presence);

    // add pair-based durations
    const pairDur = accumulateDurationsFromPairs(all);
    metrics.talk_time_secs += pairDur.talk_time_secs;
    metrics.wrap_up_time_secs += pairDur.wrap_up_time_secs;
    metrics.idle_time_secs += pairDur.idle_time_secs;
    metrics.hold_time_secs += pairDur.hold_time_secs;
    metrics.productive_break_secs += pairDur.productive_break_secs;
    metrics.non_prod_break_secs += pairDur.non_prod_break_secs;

    const counts   = countStartsForAgent(win);

    await upsertHourlyRow(conn, ext, name, reportHourStr, startStr, endStr, counts, metrics);
    processedAgents++;
  }

  console.log(`✓ [${startStr} → ${endStr}] agent_activity upserts=${processedAgents}`);
}

/* =========================
   PUBLIC
   ========================= */
export async function buildAgentActivity(startTs, endTs) {
  const startSec = toInt(startTs), endSec = toInt(endTs);
  if (!(endSec > startSec)) throw new Error("endTs must be > startTs");

  const windows = buildDubaiHourWindows(startSec, endSec);
  if (windows.length === 0) {
    console.warn("No full Dubai-hour windows inside the provided range.");
    return;
  }

  const conn = await pool.getConnection();
  try {
    for (const w of windows) {
      await processOneHourWindow(conn, w.startSec);
    }
  } finally {
    conn.release();
  }
}

// example run
buildAgentActivity(1753992000,1756584000);
export default buildAgentActivity;
