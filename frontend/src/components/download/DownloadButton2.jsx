import React from "react";
import { Button, IconButton, Tooltip } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { formatDuration, formatTs } from "../../utils/Util";

const toInt = (x, def = 0) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
};
const safeCSV = (v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
const fmtDur = (sec) => (formatDuration ? formatDuration(toInt(sec, 0)) : `${toInt(sec, 0)}s`);
const fmtTs = (ts) => (ts == null ? "" : (formatTs ? formatTs(ts) : String(ts)));

// prefer state; fallback to presence/event
const labelFromEvent = (ev) =>
  (ev?.state ?? ev?.presence ?? ev?.event ?? "").toString().trim() || "—";

function DownloadButton2({ rows = [], filename = "apr_report.csv" }) {
  // rows: allData array
  // each item: { ext, name, hours: [{ startSec, endSec, status, cdrEvents:[{event,ts,state,presence,enabled?}] }] }

  const handleDownload = () => {
    if (!Array.isArray(rows) || rows.length === 0) return;

    const headers = [
      "Ext",
      "Name",
      "From",
      "To",
      "Duration",
      "Status",
      "Event",
      // per-hour metrics from hour.status ONLY:
    ];
    const out = [headers.join(",")];

    for (const agent of rows) {
      if (!agent) continue;

      const ext = agent?.ext ?? "";
      const name = agent?.name ?? "";
      const hours = Array.isArray(agent?.hours) ? agent.hours : [];

      let printedHeaderForAgent = false;

      for (const h of hours) {
        const startSec = toInt(h?.startSec, 0);
        const endSec = toInt(h?.endSec, 0);

        // per-hour status metrics (ONLY from hour.status)
        const hs = h?.status || {};
        const totalCalls = toInt(hs.total_calls);
        const answeredCalls = toInt(hs.answered_calls);
        const failedCalls =
          hs.failed_calls != null ? toInt(hs.failed_calls) : Math.max(0, totalCalls - answeredCalls);

        const aht = toInt(hs.avg_connect_seconds); // if not provided, stays 0
        const talked = hs.talked_time != null ? hs.talked_time : hs.duration_seconds;
        const idle = toInt(hs.idle_time);
        const wrap = toInt(hs.wrap_up_time);
        const hold = toInt(hs.hold_time);

        const evs = Array.isArray(h?.cdrEvents) ? h.cdrEvents : [];

        let fromTs = startSec;
        let toTs = endSec;
        let eventName = "";
        let statusCol = "anotherstate"; // default if hour.status is null

        if (!evs.length) {
          // No events → "No intervals", and keep full hour window
          statusCol = "No intervals";
        } else {
          // choose first enabled=true event; fallback to first
          let startIdx = evs.findIndex((e) => e?.enabled === true);
          if (startIdx === -1) startIdx = 0;

          const startEv = evs[startIdx];
          eventName = (startEv?.event || "").toString();

          // if hour.status exists, use event label; else force "anotherstate"
          statusCol = h?.status != null ? labelFromEvent(startEv) : "anotherstate";

          // match same event with enabled=false after start
          const endIdx = evs.findIndex(
            (e, i) => i > startIdx && e?.event === startEv?.event && e?.enabled === false
          );
          const endEv = endIdx !== -1 ? evs[endIdx] : null;

          fromTs = toInt(startEv?.ts, startSec);
          toTs = endEv ? toInt(endEv?.ts, endSec) : endSec;
        }

        const durationSec = Math.max(0, toTs - fromTs);

        // avoid repeating ext/name for each hour of the same agent
        const extOut = printedHeaderForAgent ? "" : ext;
        const nameOut = printedHeaderForAgent ? "" : name;
        printedHeaderForAgent = true;

        out.push(
          [
            safeCSV(extOut),
            safeCSV(nameOut),
            safeCSV(fmtTs(fromTs)),
            safeCSV(fmtTs(toTs)),
            safeCSV(fmtDur(durationSec)),
            safeCSV(statusCol),
            safeCSV(eventName),
          ].join(",")
        );
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
   <Tooltip title="Download (Hours • Events)">
      <Button
        onClick={handleDownload}
        variant="contained"
        size="small"
        color="primary"
        disableElevation
        sx={{
          borderRadius: 1.5,
          textTransform: "none",
          fontWeight: 600,
          px: 1.2,
          py: 0.5,
          letterSpacing: 0.2,
          minHeight: 32,
          boxShadow: "0 2px 6px rgba(25,118,210,0.2)",
        }}
        startIcon={<DownloadIcon sx={{ fontSize: 18 }} />}
      >
        Events
      </Button>
    </Tooltip>
  );
}

export default DownloadButton2;
