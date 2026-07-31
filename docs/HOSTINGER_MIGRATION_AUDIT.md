# Hostinger Migration Audit Report

## Executive Summary

The application was built for Vercel's serverless platform and migrated to Hostinger. While file storage has been adapted (`HOSTINGER_FILE_STORAGE_ROOT`), several critical infrastructure dependencies remain broken. The main issues are:

1. **Missing `output: "standalone"` in next.config.mjs** — the app cannot run self-hosted without this
2. **No cron jobs configured** — 4 background workers never fire, causing notifications, compliance alerts, and file cleanup to fail silently
3. **Chatbot streaming (SSE) likely times out** behind Hostinger's reverse proxy
4. **No `CRON_SECRET` or Hostinger-specific env vars set** in `.env.local`
5. **`vercel.json` crons are ignored** on Hostinger

---

## Critical Issues (App-Breaking)

### 1. Missing `output: "standalone"` in Next.js Config

**File:** `next.config.mjs`
**Impact:** The app CANNOT be self-hosted properly without standalone output mode.

Without `output: "standalone"`, `next build` produces output that expects Vercel's infrastructure (edge network, serverless functions, etc.). On Hostinger VPS, you must use standalone mode to get a self-contained Node.js server.

**Fix Required:**
```js
const nextConfig = {
  output: "standalone",
  // ... existing config
};
```

---

### 2. Outbox Worker Never Triggered — Notifications Don't Work

**Files:**
- `src/app/api/internal/outbox/route.ts`
- `src/lib/server/outbox-worker.ts`
- `vercel.json` (Vercel-only cron)

**Impact:** All notifications, accounting auto-posting, identity sync, and 70+ event handlers never execute.

The system uses a transactional outbox pattern where database triggers insert events into `event_outbox`, and a worker processes them into notifications. The worker at `/api/internal/outbox` requires an external HTTP call (POST with Bearer token). The `vercel.json` cron config is **ignored on Hostinger**.

**Fix Required:** Set up Hostinger cron jobs:
```bash
# Every minute — process notification/event queue
* * * * * curl -s -X POST https://YOUR_DOMAIN/api/cron/outbox -H "Authorization: Bearer YOUR_OUTBOX_WORKER_SECRET"

# Every minute — alternative via internal route
* * * * * curl -s -X POST https://YOUR_DOMAIN/api/internal/outbox -H "Authorization: Bearer YOUR_OUTBOX_WORKER_SECRET"
```

---

### 3. Compliance Worker Never Triggered

**File:** `src/app/api/internal/compliance/route.ts`
**Impact:** Employee document expiry alerts, contract deadlines, and compliance notifications are never generated.

**Fix Required:** Add Hostinger cron:
```bash
# Every hour — check compliance deadlines
0 * * * * curl -s -X POST https://YOUR_DOMAIN/api/internal/compliance -H "Authorization: Bearer YOUR_COMPLIANCE_WORKER_SECRET"
```

---

### 4. File Retention Worker Never Triggered

**File:** `src/app/api/internal/file-retention/route.ts`
**Impact:** Expired/deleted files are never cleaned up from storage, wasting disk space and potentially violating data retention policies.

**Fix Required:** Add Hostinger cron:
```bash
# Every 6 hours — clean up expired files
0 */6 * * * curl -s -X POST https://YOUR_DOMAIN/api/internal/file-retention -H "Authorization: Bearer YOUR_FILE_RETENTION_WORKER_SECRET"
```

---

### 5. Missing Environment Variables for Hostinger Production

**File:** `.env.local`
**Impact:** Multiple subsystems fail due to unconfigured secrets.

The following variables are **required** but missing from `.env.local`:

| Variable | Purpose | Status |
|----------|---------|--------|
| `HOSTINGER_FILE_STORAGE_ROOT` | Filesystem path for uploads | **MISSING** |
| `CRON_SECRET` | Auth for cron endpoint | **MISSING** |
| `FILE_ACCESS_SIGNING_SECRET` | Signed file download URLs | Unknown |
| `AUDIT_EVIDENCE_SECRET` | Audit evidence integrity | Unknown |
| `RATE_LIMIT_HASH_SECRET` | Rate limiter security | Unknown |
| `COMPLIANCE_WORKER_SECRET` | Compliance cron auth | Unknown |
| `FILE_RETENTION_WORKER_SECRET` | File cleanup cron auth | Unknown |

Without `HOSTINGER_FILE_STORAGE_ROOT`, file uploads fall back to Supabase Storage. If Supabase Storage buckets are not configured (or have restrictive policies), uploads will fail.

---

## High-Priority Issues

### 6. Chatbot SSE Streaming May Timeout

**File:** `src/app/api/chatbot/message/route.ts`
**Impact:** AI chatbot responses get cut off or fail entirely.

The chatbot uses Server-Sent Events (SSE) streaming via `ReadableStream`. Hostinger's NGINX reverse proxy typically has a 60-second proxy timeout and may buffer responses, breaking the streaming pattern.

**Fix Required:** Configure NGINX on Hostinger VPS:
```nginx
location /api/chatbot/ {
    proxy_buffering off;
    proxy_read_timeout 120s;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
}
```

Or add `X-Accel-Buffering: no` header in the route response.

---

### 7. `maxDuration = 60` Exceeds Default Timeouts

**Files:**
- `src/app/api/internal/outbox/route.ts` (60s)
- `src/app/api/internal/compliance/route.ts` (60s)
- `src/app/api/internal/file-retention/route.ts` (60s)
- `src/app/api/internal/storage-verify/route.ts` (60s)
- `src/app/api/cron/outbox/route.ts` (60s)

**Impact:** On Vercel, `maxDuration` extends the serverless function timeout. On Hostinger, this export is **ignored** — the NGINX/Node.js timeout applies instead (often 30s default).

**Fix Required:** Configure NGINX timeout on Hostinger VPS:
```nginx
proxy_read_timeout 120s;
proxy_connect_timeout 120s;
proxy_send_timeout 120s;
```

---

### 8. Next.js Image Optimization Requires `sharp`

**File:** `package.json` (overrides: `"sharp": "0.35.3"`)
**Impact:** Images served via `next/image` (used in 3 components) may fail if sharp native binaries don't compile on the Hostinger server.

**Fix Required:** Either:
1. Ensure `sharp` compiles on the target (requires `gcc`, `g++`, `python3`)
2. Or add to `next.config.mjs`:
```js
images: {
  unoptimized: true,
}
```

---

### 9. `vercel.json` Is Ignored on Hostinger

**File:** `vercel.json`
**Impact:** The cron defined there (`/api/cron/outbox` every minute) will never fire.

This file only has meaning on Vercel's platform. On Hostinger, crons must be configured via the Hostinger control panel or `crontab`.

---

## Medium-Priority Issues

### 10. No Process Manager Configuration

**Impact:** If the Node.js process crashes, nothing restarts it.

On Vercel, serverless functions restart automatically. On Hostinger VPS, you need a process manager.

**Fix Required:** Use PM2 or systemd:
```bash
# ecosystem.config.js for PM2
module.exports = {
  apps: [{
    name: "hr-app",
    script: ".next/standalone/server.js",
    env: { PORT: 3000, NODE_ENV: "production" }
  }]
};
```

---

### 11. No Health Check Monitoring

**Files:**
- `src/app/api/health/route.ts` — basic health check
- `src/app/api/ready/route.ts` — full readiness probe

**Impact:** These endpoints exist but nothing monitors them on Hostinger.

**Fix Required:** Set up monitoring that hits `/api/ready` periodically and alerts on non-200 responses.

---

### 12. OpenRouter API Key Exposed in Env

**File:** `.env.local` line 83
**Impact:** Security risk — the `OPENROUTER_API_KEY` should be in a secret manager, not committed.

**Note:** The `.env.local` file should be in `.gitignore` (it is), but ensure it's not accidentally deployed or committed.

---

### 13. Chat Realtime Subscriptions Depend on Supabase Realtime

**File:** `src/app/(app)/chat/page.tsx` (line 93)
**Impact:** The chat module uses Supabase Realtime (`postgres_changes` subscription). This works regardless of hosting since it connects to Supabase's servers via WebSocket. However, if the CSP header blocks WebSocket connections, it will fail.

**Current CSP allows:** `wss://*.supabase.co` — this is correct.

---

### 14. CORS/CSP Headers May Block Geolocation/Map APIs

**File:** `src/middleware.ts` (line 24)
**Impact:** The CSP `connect-src` allows `https://nominatim.openstreetmap.org`. If the app uses other external APIs not listed, they'll be blocked.

---

## Low-Priority Issues

### 15. OCR Assets Must Be Served Statically

**Files:**
- `src/lib/ocr/local-tesseract.ts`
- `scripts/prepare-ocr-assets.mjs`

**Impact:** OCR runs client-side via Tesseract.js WASM. The assets must be served from `/ocr/tesseract/`. The `prebuild` script copies them to `public/`. This works on any hosting.

---

### 16. No `engines` Field in package.json

**Impact:** No enforcement of Node.js version. Next.js 15.5 requires Node.js 18.17+. The app likely needs Node.js 20+ (uses `node:crypto` modern APIs).

---

### 17. Database Connection String

**File:** `.env.local`
**Impact:** `SUPABASE_DB_URL` is set to a placeholder (`postgresql://postgres:password@host:5432/postgres`). Direct DB access (for migrations) needs the real pooler URL.

---

## Deployment Checklist for Hostinger

### Required Steps:

- [ ] Add `output: "standalone"` to `next.config.mjs`
- [ ] Set all required environment variables on the Hostinger server
- [ ] Set `HOSTINGER_FILE_STORAGE_ROOT` to a persistent writable directory (e.g., `/home/user/storage`)
- [ ] Create the storage directory with proper permissions (`chmod 700`)
- [ ] Configure 3 cron jobs (outbox every minute, compliance hourly, file-retention every 6h)
- [ ] Install PM2 or configure systemd for process management
- [ ] Configure NGINX reverse proxy with extended timeouts and no buffering for SSE
- [ ] Ensure Node.js 20+ is installed
- [ ] Run `npm run build` on the server (or build locally and deploy `.next/standalone/`)
- [ ] Verify `sharp` compiles (or disable image optimization)
- [ ] Test `/api/ready` endpoint returns 200 after deployment

### Recommended NGINX Config:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
    }

    location /api/chatbot/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_buffering off;
        proxy_read_timeout 120s;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header X-Accel-Buffering no;
    }
}
```

### Crontab Entries:

```cron
* * * * * curl -s -X POST https://YOUR_DOMAIN/api/cron/outbox -H "Authorization: Bearer YOUR_OUTBOX_WORKER_SECRET" > /dev/null 2>&1
0 * * * * curl -s -X POST https://YOUR_DOMAIN/api/internal/compliance -H "Authorization: Bearer YOUR_COMPLIANCE_WORKER_SECRET" > /dev/null 2>&1
0 */6 * * * curl -s -X POST https://YOUR_DOMAIN/api/internal/file-retention -H "Authorization: Bearer YOUR_FILE_RETENTION_WORKER_SECRET" > /dev/null 2>&1
```

---

## Summary Table

| # | Issue | Severity | Impact |
|---|-------|----------|--------|
| 1 | Missing `output: "standalone"` | CRITICAL | App cannot serve properly |
| 2 | Outbox worker not triggered | CRITICAL | No notifications, no event processing |
| 3 | Compliance worker not triggered | CRITICAL | No compliance alerts |
| 4 | File retention worker not triggered | HIGH | Storage fills up, retention violations |
| 5 | Missing env variables | CRITICAL | Multiple subsystems fail |
| 6 | SSE streaming timeout | HIGH | Chatbot broken |
| 7 | maxDuration ignored | HIGH | Long workers killed mid-execution |
| 8 | sharp compilation | MEDIUM | Image optimization fails |
| 9 | vercel.json ignored | INFO | Cron config has no effect |
| 10 | No process manager | HIGH | App doesn't restart on crash |
| 11 | No health monitoring | MEDIUM | Downtime not detected |
| 12 | API key in env | LOW | Security hygiene |
| 13 | Realtime depends on Supabase | LOW | Works if CSP is correct |
| 14 | CSP may block APIs | LOW | New integrations may break |
| 15 | OCR static assets | LOW | Works with prebuild script |
| 16 | No engines field | LOW | Wrong Node version may be used |
| 17 | DB URL placeholder | LOW | Migrations won't run |
