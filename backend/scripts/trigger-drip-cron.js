/**
 * Railway Cron Job — Trigger Automated Staking Drip Run
 * 
 * This script is executed by Railway's cron service on schedule (5:12 AM UTC daily).
 * It calls the backend API endpoint to process all overdue staking programs.
 * 
 * Environment Variables Required:
 *   DRIP_SECRET  — Authorization secret (must match backend's DRIP_SECRET)
 *   BACKEND_URL  — Backend API URL (optional, defaults to production)
 * 
 * Exit Codes:
 *   0 — Success (drip triggered and completed)
 *   1 — Failure (missing env vars, network error, or API error)
 */

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'https://hedera-nft-toolkit-production.up.railway.app';
const DRIP_SECRET = process.env.DRIP_SECRET;

// Validation
if (!DRIP_SECRET) {
  console.error('[CRON ERROR] DRIP_SECRET environment variable is not set');
  console.error('[CRON ERROR] Cannot trigger drip without authorization secret');
  process.exit(1);
}

// Build request URL
const url = `${BACKEND_URL}/api/staking-programs/run-all-drips`;

// Log execution details
console.log('═══════════════════════════════════════════════════════════');
console.log('[CRON] Hedera Staking Drip — Automated Trigger');
console.log('═══════════════════════════════════════════════════════════');
console.log(`[CRON] Timestamp: ${new Date().toISOString()}`);
console.log(`[CRON] Target URL: ${url}`);
console.log(`[CRON] Auth: Bearer ${DRIP_SECRET.substring(0, 8)}...`);
console.log('───────────────────────────────────────────────────────────');

// Execute request
fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${DRIP_SECRET}`,
    'Content-Type': 'application/json'
  }
})
.then(response => {
  console.log(`[CRON] HTTP Response: ${response.status}`);
  console.log('───────────────────────────────────────────────────────────');

  if (!response.ok) {
    console.error(`[CRON ERROR] API returned error status: ${response.status}`);
    return response.text().then(text => {
      console.error(`[CRON ERROR] Response body: ${text}`);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    });
  }

  // Backend confirmed it received the request and started processing
  console.log('[CRON] ✓ Drip Triggered Successfully');
  console.log('[CRON] Backend is now processing distributions...');
  console.log('═══════════════════════════════════════════════════════════');

  // Exit immediately - don't wait for response body
  // Backend will continue processing independently
  process.exit(0);
})
.catch(error => {
  console.error('═══════════════════════════════════════════════════════════');
  console.error('[CRON ERROR] Failed to Trigger Drip');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('[CRON ERROR] Error Type:', error.name);
  console.error('[CRON ERROR] Error Message:', error.message);
  console.error('[CRON ERROR] Stack Trace:');
  console.error(error.stack);
  console.error('═══════════════════════════════════════════════════════════');

  // Exit with failure
  process.exit(1);
});

