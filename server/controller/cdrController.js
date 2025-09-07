import fetch from "node-fetch";
import dotenv from "dotenv";
import { getPortalToken, httpsAgent } from "../tokenService.js";

dotenv.config();

const API_BASE = process.env.API_BASE;
const ACCOUNT_ID = process.env.ACCOUNT_ID;
const MAX_RETRIES = 3;

export const fetchAPRData = async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res
      .status(400)
      .json({ error: "startDate and endDate are required" });
  }

  const upstream = `${API_BASE}/api/v2/reports/callcenter/agents/activity/events?startDate=${startDate}&endDate=${endDate}&pageSize=${process.env.PAGE_SIZE}`;
 
  try {
    const ntoken = await getPortalToken(process.env.TENANT);
    const AUTH_HEADER = `Bearer ${ntoken}`;
    let attempt = 0;
    let r;

    console.log(ntoken)

    while (attempt < MAX_RETRIES) {
      try {
        r = await fetch(upstream, {
          method: "GET",
          headers: {
            Authorization: AUTH_HEADER,
            Accept: "application/json",
            "x-account-id": ACCOUNT_ID,
          },
          agent: httpsAgent,
          timeout: 30_000,
        });

        if (!r.ok) {
          throw new Error(`Upstream returned ${r.status}: ${r.statusText}`);
        }

        // success → exit retry loop
        break;
      } catch (err) {
        attempt++;
        if (attempt >= MAX_RETRIES) {
          throw err;
        }
        const backoff = 500 * attempt;
        console.warn(
          `Fetch attempt ${attempt} failed: ${err.message || err}. Retrying in ${backoff}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    const contentType = r.headers.get("content-type") || "";
    res.status(r.status);

    if (contentType.includes("application/json")) {
      const json = await r.json();
      return res.json(json);
    } else {
      const text = await r.text();
      return res.send(text);
    }
  } catch (err) {
    console.error("Proxy error:", err.message || err);
    return res
      .status(502)
      .json({ error: "Upstream fetch failed", details: err.message });
  }
};


export const fetchAgentStatusData = async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res
      .status(400)
      .json({ error: "startDate and endDate are required" });
  }

  const upstream = `${API_BASE}/api/v2/reports/callcenter/agents/stats?startDate=${startDate}&endDate=${endDate}`;

  try {
    const ntoken = await getPortalToken(process.env.TENANT);
    const AUTH_HEADER = `Bearer ${ntoken}`;

    let attempt = 0;
    let r;

    while (attempt < MAX_RETRIES) {
      try {
        r = await fetch(upstream, {
          method: "GET",
          headers: {
            Authorization: AUTH_HEADER,
            Accept: "application/json",
            "x-account-id": ACCOUNT_ID,
          },
          agent: httpsAgent,
          timeout: 30_000,
        });

        if (!r.ok) {
          throw new Error(`Upstream returned ${r.status}: ${r.statusText}`);
        }

        // success → exit retry loop
        break;
      } catch (err) {
        attempt++;
        if (attempt >= MAX_RETRIES) {
          throw err;
        }
        const backoff = 500 * attempt;
        console.warn(
          `Fetch attempt ${attempt} failed: ${err.message || err}. Retrying in ${backoff}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    const contentType = r.headers.get("content-type") || "";
    res.status(r.status);

    if (contentType.includes("application/json")) {
      const json = await r.json();
      return res.json(json);
    } else {
      const text = await r.text();
      return res.send(text);
    }
  } catch (err) {
    console.error("Proxy error:", err.message || err);
    return res
      .status(502)
      .json({ error: "Upstream fetch failed", details: err.message });
  }
};
