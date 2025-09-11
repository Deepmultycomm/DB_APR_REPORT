import React from "react";
import { IconButton, Tooltip } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { formatDuration, formatTs } from "../../utils/Util";

const toInt = (x, def = 0) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
};
const safeCSV = (v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
const fmtDur = (sec) =>
  (typeof formatDuration === "function" ? formatDuration(toInt(sec, 0)) : `${toInt(sec, 0)}s`);
const fmtTs = (ts) =>
  ts == null ? "" : (typeof formatTs === "function" ? formatTs(ts) : String(ts));

// prefer state label; fall back to presence or event
const labelFromEvent = (ev) =>
  (ev?.state ?? ev?.presence ?? ev?.event ?? "").toString().trim() || "—";

// classification sets
const AVAILABLE_EVENTS = new Set(["agent_on_call", "agent_wrap_up", "agent_idle", "agent_hold"]);
const NA_STATES_THAT_ARE_AVAILABLE = new Set(["login", "outbound", "onticket"]);

/**
 * Build intervals for a given hour using the pairing rules:
 * - Available events: start when same event has state!=none, end at next same event with state==none (or hour end)
 * - agent_not_avail_state: for each non-none state, start at its ts, end at the next agent_not_avail_state with state==none (or hour end)
 * - Ignore any event where state === 'none' as a start
 */
function buildIntervalsForHour(hour) {
  const startSec = toInt(hour?.startSec, 0);
  const endSec = toInt(hour?.endSec, 0);
  const evs = Array.isArray(hour?.cdrEvents) ? hour.cdrEvents.slice() : [];
  if (!evs.length) return [];

  // sort by timestamp
  evs.sort((a, b) => toInt(a?.ts, 0) - toInt(b?.ts, 0));

  const intervals = [];

  // --- 1) Available events: track one open per event type
  const openAvail = Object.create(null); // { eventType: startTs }
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    const evt = (ev?.event || "").toString();
    const state = (ev?.state ?? ev?.presence ?? "").toString();

    if (!evt) continue;

    if (AVAILABLE_EVENTS.has(evt)) {
      if (state && state.toLowerCase() !== "none") {
        if (openAvail[evt] == null) openAvail[evt] = toInt(ev?.ts, startSec);
      } else {
        if (openAvail[evt] != null) {
          const fromTs = Math.max(startSec, toInt(openAvail[evt], startSec));
          const toTs = Math.min(endSec, toInt(ev?.ts, endSec));
          if (toTs > fromTs) {
            intervals.push({
              from: fromTs,
              to: toTs,
              duration: toTs - fromTs,
              status: "available",
              event: evt,
            });
          }
          openAvail[evt] = null;
        }
      }
    }
  }
  // Close any still open available intervals at hour end
  for (const evt of Object.keys(openAvail)) {
    const st = openAvail[evt];
    if (st != null) {
      const fromTs = Math.max(startSec, toInt(st, startSec));
      const toTs = endSec;
      if (toTs > fromTs) {
        intervals.push({
          from: fromTs,
          to: toTs,
          duration: toTs - fromTs,
          status: "available",
          event: evt,
        });
      }
    }
  }

  // --- 2) Not-available states
  let openNAStates = Object.create(null); // { stateLower: {startTs, label} }
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    const evt = (ev?.event || "").toString();
    if (evt !== "agent_not_avail_state") continue;

    const rawLabel = (ev?.state ?? ev?.presence ?? "").toString();
    const labelLower = rawLabel.toLowerCase();

    if (labelLower && labelLower !== "none") {
      openNAStates[labelLower] = {
        startTs: toInt(ev?.ts, startSec),
        label: rawLabel,
      };
    } else {
      const closeTs = Math.min(endSec, toInt(ev?.ts, endSec));
      for (const k of Object.keys(openNAStates)) {
        const { startTs, label } = openNAStates[k] || {};
        if (startTs != null) {
          const fromTs = Math.max(startSec, toInt(startTs, startSec));
          const toTs = Math.max(fromTs, closeTs);
          if (toTs > fromTs) {
            intervals.push({
              from: fromTs,
              to: toTs,
              duration: toTs - fromTs,
              status: label,
              event: "agent_not_avail_state",
            });
          }
        }
      }
      openNAStates = Object.create(null);
    }
  }
  // close any still-open NA states at hour end
  for (const k of Object.keys(openNAStates)) {
    const { startTs, label } = openNAStates[k] || {};
    if (startTs != null) {
      const fromTs = Math.max(startSec, toInt(startTs, startSec));
      const toTs = endSec;
      if (toTs > fromTs) {
        intervals.push({
          from: fromTs,
          to: toTs,
          duration: toTs - fromTs,
          status: label,
          event: "agent_not_avail_state",
        });
      }
    }
  }

  intervals.sort((a, b) => a.from - b.from);
  return intervals;
}

/** classify an interval as available/not-available for totals */
function isIntervalAvailable(seg) {
  if (!seg) return false;
  const evt = (seg.event || "").toLowerCase();
  if (AVAILABLE_EVENTS.has(evt)) return true;
  if (evt === "agent_not_avail_state") {
    const s = (seg.status || "").toLowerCase();
    return NA_STATES_THAT_ARE_AVAILABLE.has(s);
  }
  return false;
}

/** Collapse repeated Status+Event inside the same hour window */
function collapseByStatusEvent(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) return [];
  const byKey = new Map();
  for (const seg of intervals) {
    const key = `${(seg.status || "").toLowerCase()}__${(seg.event || "").toLowerCase()}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        from: seg.from,
        to: seg.to,
        status: seg.status,
        event: seg.event,
      });
    } else {
      if (seg.from < cur.from) cur.from = seg.from;
      if (seg.to > cur.to) cur.to = seg.to;
    }
  }
  const out = [];
  for (const v of byKey.values()) {
    const duration = Math.max(0, toInt(v.to, 0) - toInt(v.from, 0));
    out.push({ ...v, duration });
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}

function DownloadButton({ rows = [], filename = "apr_report.csv" }) {
  const handleDownload = () => {
    if (!Array.isArray(rows) || rows.length === 0) return;

    const headers = [
      "Ext",
      "Name",
      "Hour Window",
      "From",
      "To",
      "Duration",
      "Status",
      "Event",
      "Hour Totals (Avail)",
      "Hour Totals (NotAvail)",
      "Total Calls",
      "Answered Calls",
      "Failed Calls",
      "AHT",
      "Talked Time",
      "Idle Time",
      "Wrap Up Time",
      "Hold Time",
    ];
    const out = [headers.join(",")];

    for (const agent of rows) {
      if (!agent) continue;
      const ext = agent?.ext ?? "";
      const name = agent?.name ?? "";
      const hours = Array.isArray(agent?.hours) ? agent.hours.slice() : [];
      hours.sort((a, b) => toInt(a?.startSec, 0) - toInt(b?.startSec, 0));

      let printedHeaderForAgent = false;

      for (const h of hours) {
        const startSec = toInt(h?.startSec, 0);
        const endSec = toInt(h?.endSec, 0);
        const hourWindow = `${fmtTs(startSec)} → ${fmtTs(endSec)}`;

        // Build RAW intervals
        const rawIntervals = buildIntervalsForHour(h);

        // Hour metrics from status (even if no events)
        const hs = h?.status || {};
        const totalCalls = toInt(hs.total_calls, toInt(hs.answered_calls, 0) + toInt(hs.failed_calls, 0));
        const answeredCalls = toInt(hs.answered_calls, 0);
        const failedCalls =
          hs.failed_calls != null
            ? toInt(hs.failed_calls, Math.max(0, totalCalls - answeredCalls))
            : Math.max(0, totalCalls - answeredCalls);
        const aht = toInt(hs.avg_connect_seconds, 0);
        const talked = hs.talked_time != null ? toInt(hs.talked_time, 0) : toInt(hs.duration_seconds, 0);
        const idle = toInt(hs.idle_time, 0);
        const wrap = toInt(hs.wrap_up_time, 0);
        const hold = toInt(hs.hold_time, 0);

        // If NO intervals for the hour → emit a single "No events" row with full window/duration
        if (!rawIntervals.length) {
          const extOut = printedHeaderForAgent ? "" : ext;
          const nameOut = printedHeaderForAgent ? "" : name;
          printedHeaderForAgent = true;

          const fullDur = Math.max(0, endSec - startSec);
          out.push(
            [
              safeCSV(extOut),
              safeCSV(nameOut),
              safeCSV(hourWindow),
              safeCSV(fmtTs(startSec)),
              safeCSV(fmtTs(endSec)),
              safeCSV(fmtDur(fullDur)),
              safeCSV("--"),
              safeCSV(""),
              safeCSV(fmtDur(0)),
              safeCSV(fmtDur(0)),
              safeCSV(totalCalls),
              safeCSV(answeredCalls),
              safeCSV(failedCalls),
              safeCSV(fmtDur(aht)),
              safeCSV(fmtDur(talked)),
              safeCSV(fmtDur(idle)),
              safeCSV(fmtDur(wrap)),
              safeCSV(fmtDur(hold)),
            ].join(",")
          );
          continue;
        }

        // With intervals: compute hour totals from RAW intervals
        let availSum = 0;
        let notAvailSum = 0;
        for (const seg of rawIntervals) {
          if (isIntervalAvailable(seg)) availSum += seg.duration;
          else notAvailSum += seg.duration;
        }

        // Collapse repeated Status+Event within this hour
        const intervals = collapseByStatusEvent(rawIntervals);

        // Emit collapsed rows
        for (const seg of intervals) {
          const extOut = printedHeaderForAgent ? "" : ext;
          const nameOut = printedHeaderForAgent ? "" : name;
          printedHeaderForAgent = true;

          out.push(
            [
              safeCSV(extOut),
              safeCSV(nameOut),
              safeCSV(hourWindow),
              safeCSV(fmtTs(seg.from)),
              safeCSV(fmtTs(seg.to)),
              safeCSV(fmtDur(seg.duration)),
              safeCSV(seg.status),
              safeCSV(seg.event),
              safeCSV(fmtDur(availSum)),
              safeCSV(fmtDur(notAvailSum)),
              safeCSV(totalCalls),
              safeCSV(answeredCalls),
              safeCSV(failedCalls),
              safeCSV(fmtDur(aht)),
              safeCSV(fmtDur(talked)),
              safeCSV(fmtDur(idle)),
              safeCSV(fmtDur(wrap)),
              safeCSV(fmtDur(hold)),
            ].join(",")
          );
        }
      }
    }

    const csv = "\ufeff" + out.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <Tooltip title="Download Report">
      <IconButton
        onClick={handleDownload}
        sx={{
          color: "#1976d2",
          bgcolor: "rgba(25,118,210,0.08)",
          "&:hover": { bgcolor: "rgba(25,118,210,0.15)" },
        }}
      >
        <DownloadIcon />
      </IconButton>
    </Tooltip>
  );
}

export default DownloadButton;
