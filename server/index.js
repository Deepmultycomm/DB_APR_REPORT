// index.js
import express from "express";
import cors from "cors";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import { fetchAPRData, fetchAgentStatusData } from "./controller/cdrController.js";
import connection from "./DB/connection.js";
import { fetchAndMergeData } from "./Collecetions/fetchAPIToMergeData.js";

/* ---------- Load env ---------- */
dotenv.config();

/* ---------- Paths ---------- */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------- Core Setup ---------- */
const app = express();

/* ---------- CORS ---------- */
const allowedOrigins = [
  "http://localhost:9086",
  "https://localhost:9086",
  "https://reports.voicemeetme.net:9086",
  "http://reports.voicemeetme.net:9086",
  "http://reports.voicemeetme.net",
  "https://reports.voicemeetme.net",
  "https://reports.voicemeetme.net:9086",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- Routes ---------- */
app.get("/", (_req, res) => res.json({ message: "Server is running..." }));
app.get("/api/apr", fetchAPRData);
app.get("/api/agent_status", fetchAgentStatusData);

/* ---------- Error Middlewares ---------- */
app.use((_req, res) => {
  res.status(404).json({ error: "Not Found" });
});
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

/* ---------- SSL Config ---------- */
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, "ssl/privkey.pem")),
  cert: fs.readFileSync(path.join(__dirname, "ssl/fullchain.pem")),
};

/* ---------- Server Setup ---------- */
const PORT = Number(process.env.PORT || 6699);
const HOST = process.env.HOST || "0.0.0.0";

/* ---------- Feed Scheduler (every 10 minutes, lookback 10 minutes) ---------- */
// You can override via env:
//   POLL_MS=600000
//   LOOKBACK_MINUTES=10
const POLL_MS = Number(process.env.POLL_MS || 10 * 60 * 1000);
const LOOKBACK_MINUTES = Number(process.env.LOOKBACK_MINUTES || 10);

let isRunning = false;
let nextTimer = null;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

async function runFeedTick() {
  if (isRunning) {
    console.log("⏳ Previous feed still running; skipping this tick.");
    return;
  }
  isRunning = true;
  try {
    const end = nowSec();
    const start = end - LOOKBACK_MINUTES * 60;
    console.log(`▶ Feed tick: last ${LOOKBACK_MINUTES} minutes (start=${start}, end=${end})`);

    // NOTE: fetchAndMergeData will:
    // - Upsert into users_calls (no delete)
    // - Insert into agent_events (append-only)
    await fetchAndMergeData(start, end);

    console.log("✔ Feed tick complete.");
  } catch (e) {
    console.error("✗ Feed tick error:", e.message);
  } finally {
    isRunning = false;
    nextTimer = setTimeout(runFeedTick, POLL_MS);
  }
}

function startScheduler() {
  console.log(`⏱️ Scheduler: every ${Math.round(POLL_MS / 1000)}s, lookback=${LOOKBACK_MINUTES} minutes.`);
  runFeedTick(); // kick immediately on server start
}

function stopScheduler() {
  if (nextTimer) {
    clearTimeout(nextTimer);
    nextTimer = null;
  }
}

/* ---------- Start HTTPS Server then start scheduler ---------- */
const server = https.createServer(sslOptions, app);

server.listen(PORT, HOST, () => {
  console.log(`[Srv] HTTPS server listening on https://reports.voicemeetme.net:${PORT}`);
  startScheduler();
});

server.on("error", (err) => {
  console.error("[Srv] Server error:", err);
  if (err.code === "EADDRINUSE") {
    console.error(`[Srv] Port ${PORT} is already in use.`);
  } else if (err.code === "EACCES") {
    console.error(`[Srv] Permission denied. Port ${PORT} may require sudo/admin privileges.`);
  }
  stopScheduler();
  process.exit(1);
});

/* ---------- Global Error Handlers ---------- */
process.on("uncaughtException", (err) => {
  console.error("[Srv] Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Srv] Unhandled Rejection:", reason);
});

/* ---------- Graceful Shutdown ---------- */
async function shutdown(sig) {
  console.log(`\n${sig} received. Shutting down…`);
  stopScheduler();

  try {
    server.close(() => console.log("[Srv] Server closed."));
  } catch (_) {}

  try {
    if (typeof connection?.end === "function") {
      await connection.end();
      console.log("[DB] Connection ended.");
    } else if (typeof connection?.promise === "function" && typeof connection.promise().end === "function") {
      await connection.promise().end();
      console.log("[DB] Promise pool ended.");
    }
  } catch (e) {
    console.warn("[DB] Close error:", e.message);
  }

  process.exit(0);
}

["SIGINT", "SIGTERM"].forEach((sig) => process.on(sig, () => shutdown(sig)));
