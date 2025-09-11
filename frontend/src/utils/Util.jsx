// export function formatTs(ts) {
//   const n = Number(ts);
//   if (!n) return "-";
//   return new Date(n * 1000).toLocaleString("en-GB", {
//     timeZone: "Asia/Dubai",
//     year: "numeric",
//     month: "2-digit",
//     day: "2-digit",
//     hour: "2-digit",
//     minute: "2-digit",
//     second: "2-digit",
//   });
// }
export function formatTs(ts) {
  const n = Number(ts);
  if (!n) return "-";
  return new Date(n * 1000).toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
export function formatDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const days = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");

  if (days > 0) {
    return `${days}d ${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}:${ss}`;
}

export function inputToDubaiIso(val) {
  if (!val) return "";
  const [datePart, timePart = "00:00"] = val.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const utcMillis = Date.UTC(year, month - 1, day, hour - 4, minute);
  return new Date(utcMillis).toISOString();
}

export function mergeAgentData(cdrData = []) {
  // Removed ALLOWED filter so ALL events are included

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const numTs = (x, fallbackNaN = NaN) => {
    const n = Number(
      x?.Timestamp ??
        x?.timestamp ??
        x?.ts ??
        x?.time ??
        x?.event_ts ??
        x?.created_at ??
        x
    );
    return Number.isFinite(n) ? n : fallbackNaN;
  };

  const normalizeAgentStatusObject = (agentStatus) => {
    if (!agentStatus) return {};
    if (Array.isArray(agentStatus)) {
      if (agentStatus.length === 1 && isObj(agentStatus[0]))
        return agentStatus[0];
      const out = {};
      for (const row of agentStatus) {
        const ext = String(
          row?.ext ?? row?.extension ?? row?.agent_ext ?? row?.key ?? ""
        ).trim();
        if (!ext) continue;
        const name = row?.name ?? row?.username ?? row?.agent_name ?? "";
        const clone = { ...row };
        delete clone.ext;
        delete clone.extension;
        delete clone.agent_ext;
        delete clone.key;
        out[ext] = { name, ...clone };
      }
      return out;
    }
    if (isObj(agentStatus)) return agentStatus;
    return {};
  };

  const out = [];

  for (const hour of cdrData || []) {
    const { label, startSec, endSec } = hour || {};
    const apr = Array.isArray(hour?.apr) ? hour.apr : [];

    const statusByExt = normalizeAgentStatusObject(hour?.agent_status);

    const eventsByExt = {};
    for (const ev of apr) {
      // 🔻 Removed: if (!ALLOWED.has(ev?.event)) continue;

      const ext = String(
        ev?.ext ?? ev?.extension ?? ev?.agent_ext ?? ev?.user_ext ?? ""
      ).trim();
      if (!ext) continue;

      const name =
        ev?.username ??
        ev?.name ??
        ev?.agent_name ??
        statusByExt?.[ext]?.name ??
        ext;

      if (!eventsByExt[ext]) eventsByExt[ext] = { ext, name, events: [] };
      eventsByExt[ext].events.push({
        event: ev.event,
        ts: numTs(ev),
        state: ev?.state ?? ev?.presence ?? null,
        presence: ev?.presence ?? null,
      });
    }

    // ✅ NEW: also include extensions that exist ONLY in agent_status for this hour
    for (const ext of Object.keys(statusByExt)) {
      if (!eventsByExt[ext]) {
        const name = statusByExt[ext]?.name || ext;
        eventsByExt[ext] = { ext, name, events: [] };
      }
    }

    for (const ext of Object.keys(eventsByExt)) {
      const bucket = eventsByExt[ext];
      bucket.events.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

      const statusData = isObj(statusByExt[ext])
        ? statusByExt[ext]
        : { name: bucket.name };

      out.push({
        label,
        startSec,
        endSec,
        ext,
        name: bucket.name,
        statusData,          // <-- status for THIS hour window
        cdrEvents: bucket.events,
      });
    }
  }
  // return grouped by ext, WITH per-hour status inside hours[]
  return groupByExtensionReduce(out, cdrData);
}

export function groupByExtensionReduce(rows = [], cdrData = []) {
  // build hour buckets from original hourly data (for padding)
  const hourBuckets = (cdrData || [])
    .map((h) => ({
      label: String(h?.label ?? ""),
      startSec: Number(h?.startSec ?? 0),
      endSec: Number(h?.endSec ?? 0),
    }))
    .filter((h) => h.label);

  // ⬇️ CHANGED: make mergeStatus an *aggregator* across hours
  const mergeStatus = (a = {}, b = {}) => {
    const out = { ...a };

    const addNum = (key, val) => {
      const cur = Number.isFinite(Number(out[key])) ? Number(out[key]) : 0;
      const add = Number.isFinite(Number(val)) ? Number(val) : 0;
      out[key] = cur + add;
    };

    for (const [k, v] of Object.entries(b || {})) {
      if (v === undefined || v === null) continue;

      // sum detailed NA report
      if (k === "not_available_detailed_report" && v && typeof v === "object") {
        const tgt = out.not_available_detailed_report || {};
        for (const [sk, sv] of Object.entries(v)) {
          tgt[sk] = (Number(tgt[sk]) || 0) + (Number(sv) || 0);
        }
        out.not_available_detailed_report = tgt;
        continue;
      }

      // numeric keys we should SUM across hours
      if (
        typeof v === "number" ||
        (typeof v === "string" && v !== "" && !Number.isNaN(Number(v)))
      ) {
        // don't sum per-hour averages; recompute later
        if (k === "avg_connect_seconds" || k === "talked_average") {
          // keep first non-zero as a placeholder; final value is recomputed below
          if (!out[k]) out[k] = Number(v) || 0;
        } else {
          addNum(k, v);
        }
        continue;
      }

      // keep first non-empty for names/tags/etc.
      if ((k === "name" || k === "tags" || k === "callee_id_name" || k === "callee_id_number")) {
        if (!out[k] && v !== "") out[k] = v;
        continue;
      }

      // default: keep first non-empty value
      if (out[k] == null || out[k] === "") out[k] = v;
    }

    return out;
  };

  const acc = rows.reduce((map, row) => {
    const ext = String(row?.ext ?? "").trim();
    if (!ext) return map;

    const name = row?.name ?? ext;
    const cdrEvents = Array.isArray(row?.cdrEvents) ? row.cdrEvents : [];
    const statusForThisHour = row?.statusData || null; // per-hour status

    if (!map[ext]) {
      map[ext] = {
        ext,
        name,
        statusLatest: {},
        counts: { idle: 0, notAvailable: 0, total: 0 },
        hours: [], // [{label,startSec,endSec,status,cdrEvents}]
        events: [],
      };
    }

    map[ext].statusLatest = mergeStatus(map[ext].statusLatest, statusForThisHour || {});
    if (!map[ext].name && name) map[ext].name = name;

    map[ext].hours.push({
      label: row?.label,
      startSec: row?.startSec,
      endSec: row?.endSec,
      status: statusForThisHour,
      cdrEvents,
    });

    for (const ev of cdrEvents) {
      if (!ev) continue;
      map[ext].events.push(ev);
      map[ext].counts.total += 1;
      if (ev.event === "agent_idle") map[ext].counts.idle += 1;
      else if (ev.event === "agent_not_avail_state") map[ext].counts.notAvailable += 1;
    }

    return map;
  }, {});

  // pad missing hours so each ext shows every interval (status:null, cdrEvents:[])
  for (const ext of Object.keys(acc)) {
    const seen = new Set(acc[ext].hours.map((h) => h.label));
    for (const hb of hourBuckets) {
      if (!seen.has(hb.label)) {
        acc[ext].hours.push({
          label: hb.label,
          startSec: hb.startSec,
          endSec: hb.endSec,
          status: null,
          cdrEvents: [],
        });
      }
    }
    // sort
    acc[ext].hours.sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
    acc[ext].events.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  }

  // ⬇️ NEW: finalize derived metrics on the aggregated statusLatest
  for (const ext of Object.keys(acc)) {
    const s = acc[ext].statusLatest || {};
    const totalCalls = Number(s.total_calls) || 0;
    const answered = Number(s.answered_calls) || 0;

    // if failed_calls not present, derive
    if (s.failed_calls == null) {
      s.failed_calls = Math.max(0, totalCalls - answered);
    }

    // prefer recomputing avg from totals when possible
    const totalConnect = Number(s.total_connect_seconds) || 0;
    if (totalConnect > 0 && answered > 0) {
      s.avg_connect_seconds = Math.floor(totalConnect / answered);
    } else if (!(Number(s.avg_connect_seconds) > 0) && totalCalls > 0) {
      // fallback: keep 0 or existing placeholder
      s.avg_connect_seconds = Number(s.avg_connect_seconds) || 0;
    }

    acc[ext].statusLatest = s;
  }

  return acc;
}
