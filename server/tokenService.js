// tokenService.js
import axios from 'axios';
import ms from 'ms';
import https from 'https';

// CRITICAL FIX: The agent should NOT disable SSL verification.
// If the target server uses a self-signed certificate, the proper solution
// is to add its Certificate Authority (CA) to the Node.js trust store.
// For now, we remove the insecure setting.
const httpsAgent = new https.Agent({
  // rejectUnauthorized: false, // <-- REMOVED: This was a major security risk.
});

const cache = new Map();
const MAX_RETRIES = 3;

// This function seems unused but is left here for reference.
export async function getToken(tenant) {
  // ... (Can be updated similarly if needed)
}

export async function getPortalToken(tenant) {
  console.log("Token acquisition process starting....");
  const now = Date.now();
  const cached = cache.get(`portal:${tenant}`);
  if (cached && now < cached.expiresAt - ms('2m')) {
    return cached.access;
  }

  // REFACTORED: Load credentials and URLs from environment variables
  const base = process.env.API_BASE;
  const username = process.env.API_USERNAME;
  const password = process.env.API_PASSWORD;

  const candidates = [
    { url: `${base}/api/v2/config/login/oauth`, body: { domain: tenant, username, password } },
    { url: `${base}/api/v2/login`, body: { domain: tenant, username, password } },
    { url: `${base}/api/login`, body: { domain: tenant, username, password } },
  ];

  for (const { url, body } of candidates) {
    for (let attempt = 0, delay = 1000; attempt < MAX_RETRIES; attempt++, delay *= 2) {
      try {
        const { data } = await axios.post(url, body, {
          timeout: 5000,
          httpsAgent,
          headers: { Accept: 'application/json' }
        });

        const access = data.accessToken || data.access_token;
        if (!access) throw new Error('No access token in response');

        const refresh = data.refreshToken || data.refresh_token;
        const expiresAt = data.expiresIn ? Date.now() + data.expiresIn * 1000 : Date.now() + ms('1h');

        cache.set(`portal:${tenant}`, { access, refresh, expiresAt });
        console.log(`✅ Portal login succeeded at ${url}`);
        return access;
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) {
          console.warn(`Login failed at ${url}: ${err.response?.status || err.message}`);
        } else {
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
  }
  throw new Error('All portal login attempts failed – check credentials/endpoints in your .env file.');
}

export { httpsAgent };