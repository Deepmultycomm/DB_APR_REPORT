import dotenv from "dotenv";
import pool from "../DB/connection.js";

dotenv.config();

/* =========================
    CONSTANTS & MAPPINGS
    ========================= */
const TZ = "Asia/Dubai";
const LOOKBACK_SEC = 6 * 3600; // Look back 6 hours for context

const PRODUCTIVE_BREAK_STATES = {
    MEETING: ["meeting", "team meeting"],
    TRAINING: ["training"],
    CHAT: ["chat"],
    TICKETS: ["ticket_b2b", "ticket_b2c", "on tickets"],
    OUTBOUND: ["outbound"]
};  

const NON_PROD_BREAK_STATES = {
    LUNCH: ["lunch break", "lunch"],
    TEA: ["tea break"],
    BIO: ["bio break"],
    SHORT: ["short break"],
    OTHER: ["not available"] // Generic fallback
};

/* =========================
    UTILS
    ========================= */
const toInt = (v) => Number.isFinite(Number(v)) ? Math.floor(Number(v)) : 0;
const normStr = (v) => String(v ?? "").trim();
const normState = (v) => normStr(v).toLowerCase().trim();

function toMySQLDatetimeFromSec(sec, tz = TZ) {
    const d = new Date(sec * 1000);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value || "00";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function toMySQLHourBucketStartFromSec(sec, tz = TZ) {
    const d = new Date(sec * 1000);
    d.setMinutes(0, 0, 0);
    return toMySQLDatetimeFromSec(d.getTime() / 1000, tz);
}

function buildDubaiHourWindows(startSec, endSec) {
    if (!(endSec > startSec)) return [];
    const windows = new Set();
    const startHour = new Date(startSec * 1000);
    startHour.setMinutes(0,0,0);
    let currentHour = startHour.getTime() / 1000;
    while(currentHour < endSec) {
        windows.add(currentHour);
        currentHour += 3600;
    }
    windows.add(currentHour);
    return Array.from(windows).map(s => ({ startSec: s, endSec: s + 3600 }));
}

/* =========================
    DATA FETCHING FROM DB
    ========================= */
async function fetchEventsForWindow(conn, startSec, endSec) {
    const contextStart = startSec - LOOKBACK_SEC;
    const sql = `SELECT event, enabled, ext, username, state, ts_epoch FROM agent_events WHERE ts_epoch >= ? AND ts_epoch < ? ORDER BY ext, ts_epoch, id`;
    const [rows] = await conn.execute(sql, [contextStart, endSec]);
    // console.log("hourly events comming .....",rows)
    return rows.map(r => ({ type: normStr(r.event), enabled: toInt(r.enabled), ext: normStr(r.ext), name: normStr(r.username), state: normState(r.state), ts: toInt(r.ts_epoch) }));
}

async function fetchMetricsForWindow(conn, ext, startStr, endStr) {
    const sql = `SELECT total_calls, answered_calls FROM users_calls WHERE ext = ? AND start_timestamp >= ? AND start_timestamp < ?`;
    const [rows] = await conn.execute(sql, [ext, startStr, endStr]);
    return rows;
}

async function fetchAgentName(conn, ext) {
    const sql = `SELECT name FROM users_calls WHERE ext = ? AND name IS NOT NULL AND name != '' ORDER BY start_timestamp DESC LIMIT 1`;
    const [[row]] = await conn.execute(sql, [ext]);
    return row?.name || null;
}

async function fetchActiveAgentsForWindow(conn, startStr, endStr) {
    const eventsSql = `SELECT DISTINCT ext FROM agent_events WHERE ts_epoch >= UNIX_TIMESTAMP(?) AND ts_epoch < UNIX_TIMESTAMP(?)`;
    const callsSql = `SELECT DISTINCT ext FROM users_calls WHERE start_timestamp >= ? AND start_timestamp < ?`;

    const [eventAgentsRes, callAgentsRes] = await Promise.all([
        conn.execute(eventsSql, [startStr, endStr]),
        conn.execute(callsSql, [startStr, endStr])
    ]);

    const eventAgents = eventAgentsRes[0];
    const callAgents = callAgentsRes[0];

    const allExts = new Set([
        ...eventAgents.map(r => normStr(r.ext)),
        ...callAgents.map(r => normStr(r.ext))
    ]);

    return Array.from(allExts).filter(Boolean).sort();
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
    METRICS AGGREGATION
    ========================= */
function findLastEventAtOrBefore(events, ts) {
    let lastEvent = null;
    for (const event of events) {
        if (event.ts <= ts) {
            lastEvent = event;
        } else {
            break;
        }
    }
    return lastEvent;
}

function accumulateMetrics(metrics, event, duration) {
    if (!event || !event.enabled || duration <= 0) return;

    const eventType = event.type;
    const eventState = event.state;
    if (['agent_on_call', 'agent_wrap_up', 'agent_idle', 'agent_hold'].includes(eventType)) {
        metrics.available_status_secs += duration;
        if (eventType === 'agent_on_call') metrics.talk_time_secs += duration;
        if (eventType === 'agent_wrap_up') metrics.wrap_up_time_secs += duration;
        if (eventType === 'agent_idle') metrics.idle_time_secs += duration;
        if (eventType === 'agent_hold') metrics.hold_time_secs += duration;
    } else if (eventType === 'agent_not_avail_state') {
        if (eventState === 'login') metrics.login_secs += duration;
        else if (eventState === 'logoff') metrics.logoff_secs += duration;
        else if (eventState === 'dnd') metrics.dnd_secs += duration;
        // Productive States
        else if (PRODUCTIVE_BREAK_STATES.MEETING.some(term => eventState.includes(term))) { metrics.pt_meeting_secs += duration; metrics.productive_break_secs += duration; }
        else if (PRODUCTIVE_BREAK_STATES.TRAINING.some(term => eventState.includes(term))) { metrics.pt_training_secs += duration; metrics.productive_break_secs += duration; }
        else if (PRODUCTIVE_BREAK_STATES.CHAT.some(term => eventState.includes(term))) { metrics.pt_chat_secs += duration; metrics.productive_break_secs += duration; }
        else if (PRODUCTIVE_BREAK_STATES.TICKETS.some(term => eventState.includes(term))) { metrics.pt_tickets_secs += duration; metrics.productive_break_secs += duration; }
        else if (PRODUCTIVE_BREAK_STATES.OUTBOUND.some(term => eventState.includes(term))) { metrics.pt_outbound_secs += duration; metrics.productive_break_secs += duration; }
        // Non-Productive States
        else if (NON_PROD_BREAK_STATES.LUNCH.some(term => eventState.includes(term))) { metrics.npt_lunch_secs += duration; metrics.non_prod_break_secs += duration; }
        else if (NON_PROD_BREAK_STATES.TEA.some(term => eventState.includes(term))) { metrics.npt_tea_break_secs += duration; metrics.non_prod_break_secs += duration; }
        else if (NON_PROD_BREAK_STATES.BIO.some(term => eventState.includes(term))) { metrics.npt_bio_break_secs += duration; metrics.non_prod_break_secs += duration; }
        else if (NON_PROD_BREAK_STATES.SHORT.some(term => eventState.includes(term))) { metrics.npt_short_break_secs += duration; metrics.non_prod_break_secs += duration; }
        // Fallback to "Other" for any other "not available" state
        else { metrics.npt_other_secs += duration; metrics.non_prod_break_secs += duration; }
    }
}

function calculateHourlyMetrics(agentEvents, hourStartSec, hourEndSec) {
    const metrics = {
        available_status_secs: 0, login_secs: 0, logoff_secs: 0,
        productive_break_secs: 0, non_prod_break_secs: 0, dnd_secs: 0,
        talk_time_secs: 0, idle_time_secs: 0, wrap_up_time_secs: 0, hold_time_secs: 0,
        idle_count: 0, notavail_count: 0,
        pt_meeting_secs: 0, pt_training_secs: 0, pt_chat_secs: 0, pt_tickets_secs: 0, pt_outbound_secs: 0,
        npt_lunch_secs: 0, npt_tea_break_secs: 0, npt_bio_break_secs: 0, npt_short_break_secs: 0, npt_other_secs: 0, evets_details: []
    };

    let currentState = findLastEventAtOrBefore(agentEvents, hourStartSec) || { type: 'agent_not_avail_state', state: 'logoff', enabled: 1 };
    let lastTimestamp = hourStartSec;

    const eventsInHour = agentEvents.filter(e => e.ts > hourStartSec && e.ts < hourEndSec);

    // ⬇️ Store only the hour-window events in evets_details
    metrics.evets_details = eventsInHour;

    for (const event of eventsInHour) {
        const duration = event.ts - lastTimestamp;
        accumulateMetrics(metrics, currentState, duration);
        currentState = event;
        lastTimestamp = event.ts;
    }

    const finalDuration = hourEndSec - lastTimestamp;
    accumulateMetrics(metrics, currentState, finalDuration);

    for (const event of eventsInHour) {
        if (event.enabled) {
            if (event.type === 'agent_idle') metrics.idle_count++;
            if (event.type === 'agent_not_avail_state') metrics.notavail_count++;
        }
    }

    return metrics;
}

function aggregateCallMetrics(rows) {
    const metrics = { total_calls: 0, answered_calls: 0 };
    for (const row of rows) {
        metrics.total_calls += toInt(row.total_calls);
        metrics.answered_calls += toInt(row.answered_calls);
    }
    return metrics;
}

/* =========================
    UPSERT LOGIC
    ========================= */
async function upsertHourlyRow(conn, data) {
    const sql = `
        INSERT INTO agent_activity (
            agent_ext, agent_name, report_hour, start_time, end_time,
            available_status_secs, login_secs, logoff_secs, productive_break_secs, non_prod_break_secs, dnd_secs,
            idle_count, notavail_count, total_calls, answered_calls, failed_calls,
            talk_time_secs, idle_time_secs, wrap_up_time_secs, hold_time_secs,
            npt_lunch_secs, npt_tea_break_secs, npt_bio_break_secs, npt_short_break_secs, npt_other_secs,
            pt_meeting_secs, pt_training_secs, pt_chat_secs, pt_tickets_secs, pt_outbound_secs,
            event_details
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            agent_name=VALUES(agent_name), available_status_secs=VALUES(available_status_secs), login_secs=VALUES(login_secs),
            logoff_secs=VALUES(logoff_secs), productive_break_secs=VALUES(productive_break_secs),
            non_prod_break_secs=VALUES(non_prod_break_secs), dnd_secs=VALUES(dnd_secs), idle_count=VALUES(idle_count),
            notavail_count=VALUES(notavail_count), total_calls=VALUES(total_calls), answered_calls=VALUES(answered_calls),
            failed_calls=VALUES(failed_calls), talk_time_secs=VALUES(talk_time_secs), idle_time_secs=VALUES(idle_time_secs),
            wrap_up_time_secs=VALUES(wrap_up_time_secs), hold_time_secs=VALUES(hold_time_secs),
            npt_lunch_secs=VALUES(npt_lunch_secs), npt_tea_break_secs=VALUES(npt_tea_break_secs),
            npt_bio_break_secs=VALUES(npt_bio_break_secs), npt_short_break_secs=VALUES(npt_short_break_secs),
            npt_other_secs=VALUES(npt_other_secs), pt_meeting_secs=VALUES(pt_meeting_secs), 
            pt_training_secs=VALUES(pt_training_secs), pt_chat_secs=VALUES(pt_chat_secs),
            pt_tickets_secs=VALUES(pt_tickets_secs), pt_outbound_secs=VALUES(pt_outbound_secs),
            event_details=VALUES(event_details)
    `;

    const m = data.metrics;
    const c = data.callMetrics;

    const params = [
        data.agent_ext, data.agent_name, data.report_hour, data.start_time, data.end_time,
        m.available_status_secs, m.login_secs, m.logoff_secs, m.productive_break_secs, m.non_prod_break_secs, m.dnd_secs,
        m.idle_count, m.notavail_count, c.total_calls, c.answered_calls, (c.total_calls - c.answered_calls),
        m.talk_time_secs, m.idle_time_secs, m.wrap_up_time_secs, m.hold_time_secs,
        m.npt_lunch_secs, m.npt_tea_break_secs, m.npt_bio_break_secs, m.npt_short_break_secs, m.npt_other_secs,
        m.pt_meeting_secs, m.pt_training_secs, m.pt_chat_secs, m.pt_tickets_secs, m.pt_outbound_secs,
        JSON.stringify(m.evets_details || [])
    ];

    await conn.execute(sql, params);
}


/* =========================
    MAIN PROCESSOR
    ========================= */
async function processOneHourWindow(conn, hourStartSec) {
    const endSec = hourStartSec + 3600;
    const startStr = toMySQLDatetimeFromSec(hourStartSec, TZ);
    const endStr = toMySQLDatetimeFromSec(endSec, TZ);
    const reportHourStr = toMySQLHourBucketStartFromSec(hourStartSec, TZ);

    const allAgentExts = await fetchActiveAgentsForWindow(conn, startStr, endStr);
    const allEvents = await fetchEventsForWindow(conn, hourStartSec, endSec);
    const eventsByExt = groupByExt(allEvents);

    let processedAgents = 0;
    for (const ext of allAgentExts) {
        const agentEvents = eventsByExt.get(ext) || [];
        
        let agentName = agentEvents.find(e => e.name)?.name || await fetchAgentName(conn, ext) || 'Unknown';
        
        const metrics = calculateHourlyMetrics(agentEvents, hourStartSec, endSec);
        
        const rawCallMetricsRows = await fetchMetricsForWindow(conn, ext, startStr, endStr);
        const aggregatedCallMetrics = aggregateCallMetrics(rawCallMetricsRows);

        await upsertHourlyRow(conn, {
            agent_ext: ext, agent_name: agentName, report_hour: reportHourStr,
            start_time: startStr, end_time: endStr,
            metrics, callMetrics: aggregatedCallMetrics
        });
        processedAgents++;
    }
    console.log(`✓ [${startStr} to ${endStr}] Processed summary for ${processedAgents} agents.`);
}

/* =========================
    PUBLIC EXPORT
    ========================= */
export async function buildAgentActivity(startTs, endTs) {
    const startSec = toInt(startTs);
    const endSec = toInt(endTs);
    if (!(endSec > startSec)) {
        console.warn("buildAgentActivity skipped: endTs must be greater than startTs.");
        return;
    }

    const windows = buildDubaiHourWindows(startSec, endSec);
    if (windows.length === 0) {
        console.warn("No full hourly windows to process in the provided range.");
        return;
    }

    let conn;
    try {
        conn = await pool.getConnection();
        console.log(`Processing ${windows.length} hourly window(s)...`);
        for (const w of windows) {
            await processOneHourWindow(conn, w.startSec);
        }
    } catch (error) {
        console.error("Error during agent activity build:", error);
    } finally {
        if (conn) conn.release();
    }
}
