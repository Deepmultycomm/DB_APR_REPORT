import express from "express";
import cors from "cors";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import { 
    fetchAPRDataController, 
    fetchAgentStatusDataController,
    generateReportController // <-- New import
} from "./controller/cdrController.js";
import connection from "./DB/connection.js";
import { fetchAndMergeData } from "./Collecetions/fetchAPIToMergeData.js";
import { buildAgentActivity } from "./Collecetions/reportDatabase.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const allowedOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Routes ---
app.get("/", (_req, res) => res.json({ message: "Server is running..." }));
app.get("/api/apr", fetchAPRDataController);
app.get("/api/agent_status", fetchAgentStatusDataController);
app.get("/api/report", generateReportController); // <-- New route for generating reports

// --- Error Middlewares ---
app.use((_req, res) => res.status(404).json({ error: "Not Found" }));
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

// --- SSL Config ---
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, "ssl/privkey.pem")),
  cert: fs.readFileSync(path.join(__dirname, "ssl/fullchain.pem")),
};

// --- Server & Scheduler Config ---
const PORT = Number(process.env.PORT || 9005);
const HOST = process.env.HOST || "0.0.0.0";
const POLL_MS = Number(process.env.POLL_MS);
const LOOKBACK_MINUTES = Number(process.env.LOOKBACK_MINUTES);

let isRunning = false;
let nextTimer = null;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// --- Main Application Logic ---
async function runFeedTick() {
  if (isRunning) {
    console.log("⏳ Previous feed still running; skipping this tick.");
    return;
  }
  isRunning = true;
  try {
    const end = nowSec();
    const start = end - LOOKBACK_MINUTES * 60;
    console.log(`▶ Feed tick started: processing last ${LOOKBACK_MINUTES} minutes (from ${start} to ${end}).`);

    // STEP 1: Fetch raw data from APIs and load into staging tables.
    console.log("  - Step 1: Fetching and loading raw data...");
    await fetchAndMergeData(start, end);
    console.log("  - Step 1: Raw data loaded successfully.");

    // STEP 2: Aggregate the raw data into the final hourly report table.
    console.log("  - Step 2: Building hourly activity summary...");
    await buildAgentActivity(start, end);
    console.log("  - Step 2: Hourly summary updated.");

    console.log("✔ Feed tick complete.");
  } catch (e) {
    console.error("✗ Feed tick failed:", e.message, e.stack);
  } finally {
    isRunning = false;
    nextTimer = setTimeout(runFeedTick, POLL_MS);
  }
}

function startScheduler() {
  console.log(`⏱️  Scheduler starting: Polls every ${Math.round(POLL_MS / 1000)}s, with a ${LOOKBACK_MINUTES} minute lookback.`);
  runFeedTick(); // Run immediately on server start
}

function stopScheduler() {
  if (nextTimer) {
    clearTimeout(nextTimer);
    nextTimer = null;
  }
}

// --- Server Lifecycle ---
const server = https.createServer(sslOptions, app);

server.listen(PORT, HOST, () => {
  console.log(`[Srv] HTTPS server listening on https://${HOST}:${PORT}`);
  startScheduler();
});

server.on("error", (err) => {
  console.error("[Srv] Server error:", err);
  stopScheduler();
  process.exit(1);
});

// --- Graceful Shutdown ---
async function shutdown(sig) {
  console.log(`\n${sig} received. Shutting down gracefully...`);
  stopScheduler();

  server.close(() => {
    console.log("[Srv] Server closed.");
    connection.end(err => {
      if (err) {
        console.error("[DB] Error closing connection:", err.message);
      } else {
        console.log("[DB] Connection closed.");
      }
      process.exit(0);
    });
  });
}

["SIGINT", "SIGTERM"].forEach((sig) => process.on(sig, () => shutdown(sig)));