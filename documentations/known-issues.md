# Known Issues & Assumptions

## LMS v43 Limitations

- SCORM and xAPI are intentionally deferred.
- Video transcoding is intentionally deferred; v1 stores videos privately and serves signed URLs.
- Certificates are printable HTML/CSS only; PDF generation is intentionally deferred.
- Course instructors are internal HRMS employees only; external instructors are intentionally deferred.
- Public academy, public registration, paid courses, and payment integrations are intentionally deferred.
- Learning paths are basic ordered course structures in v1; advanced automation is deferred.
- Manual QA still needs to be run against a reachable Supabase database for cross-org access, signed URLs, and role-specific workflows.

## LMS v43 Verification Note

`npm run apply:migration -- db/schema_v43_lms_module.sql` and `npm run verify:lms` require the configured Supabase database host to resolve. If DNS fails for the Supabase host, local lint/build can still pass, but database verification remains blocked until network/DNS access is restored.

## SIM Box OCR Import v52 Notes

- OCR uses free client-side Tesseract.js plus best-effort ZXing barcode detection. It may fail on blurry, tilted, shadowed, or low-resolution box photos.
- OCR output is intentionally treated as untrusted. Managers must review/edit the extracted provider, first kit code, last kit code, quantity, order/batch fields, dealer box fields, and duplicate status before confirming.
- Barcode reading is best-effort. If it fails, the manager can still verify and type barcode/label fields manually.
- `sim-box-imports` is private storage; the database stores object paths, not public URLs.
- The focused kit-code generation test is `npm run test:sim-box-generation`; parser coverage is `npm run test:sim-box-parser`. These do not replace database/API tests for duplicate handling, RLS, or storage policy behavior.

## Critical Issues

| # | Area | Description | Impact |
|---|------|-------------|--------|
| 1 | Security | Demo credentials exposed in login page UI (`hr@tatwir.sa` / `12345678`) | Credentials visible in production unless `NEXT_PUBLIC_SHOW_DEMO_LOGINS=false` |
| 2 | Database | `audit_logs` table referenced in `src/lib/utils/audit.ts` but may not exist in all deployments | Audit writes silently fail if table is missing |
| 3 | Environment | `.env.local` missing from repository (expected); app uses placeholder URLs during build | Non-functional without proper Supabase configuration |
| 4 | Type Safety | `as never` casting on all Supabase insert/update operations | Bypasses TypeScript compile-time checks on DB operations |

## High Severity Issues

| # | Area | Description | Impact |
|---|------|-------------|--------|
| 5 | Settings | Company Profile "Save" button shows success toast but never persists to database | User believes changes are saved when they are not |
| 6 | Notifications | `notification-triggers.ts` uses browser client; RLS may block cross-user inserts | Notifications may silently fail to create for other users |
| 7 | Validation | Zero input validation on many forms (client-side only where Zod is used) | Invalid data can reach the database |
| 8 | Data Fetching | No pagination on any query — fetches all records per org | Performance degrades with data volume growth |

## Medium Severity Issues

| # | Area | Description | Impact |
|---|------|-------------|--------|
| 9 | Hooks | `initial` array in `useOrgData` deps creates new reference each render | Potential unnecessary re-renders |
| 10 | CRUD | Delete operations show no error feedback on failure | User unaware if deletion failed |
| 11 | Leave | Leave balance not automatically decremented on approval in all code paths | Balance may become inconsistent |
| 12 | Attendance | No duplicate check-in prevention per day in client service | Employee could create multiple attendance records |
| 13 | Performance | Dashboard fetches ALL attendance records to compute 7-day trend | Unnecessary data transfer for aggregate |

## Low Severity Issues

| # | Area | Description | Impact |
|---|------|-------------|--------|
| 14 | Dead Code | `src/data/mock.ts` — 168 lines of unused mock data | Code bloat, potential confusion |
| 15 | Theming | Dark mode CSS variables lose brand color mapping | Dark mode appears generic (no Tatwir Green) |
| 16 | i18n | No internationalization library — mix of hardcoded Arabic and English strings | Cannot easily switch languages |

---

## Architectural Assumptions

### Multi-Tenancy
- **Assumption:** Every user belongs to exactly ONE organization
- **Implication:** No cross-org user scenarios are supported; users can only see data from their org
- **Exception:** Superadmins operate at platform level and can view multiple orgs

### Authentication
- **Assumption:** Email/password is the only auth method
- **Implication:** No social login (Google, Apple), no SSO/SAML, no MFA (listed as "planned")
- **Implementation:** Magic link/OAuth callback route exists but is not actively used

### Data Scale
- **Assumption:** Small-to-medium organizations (< 500 employees per org)
- **Implication:** No pagination, no infinite scrolling, no virtual lists
- **Risk:** Performance will degrade significantly with large datasets

### Connectivity
- **Assumption:** Users have reliable internet connectivity
- **Implication:** No offline mode, no service worker, no optimistic updates
- **Risk:** Attendance check-in fails if network is unstable

### Geography
- **Assumption:** Primary deployment in Saudi Arabia
- **Implication:** Arabic RTL interface, Saudi-specific HR options (cities, banks, national ID format)
- **Note:** No timezone handling — all dates treated as local

### File Storage
- **Assumption:** Supabase Storage buckets exist and are properly configured
- **Implication:** File uploads will fail silently if buckets don't exist
- **Buckets needed:** `attendance-selfies`, `employee-documents`, `task-attachments`
- **On-ground SIM buckets needed:** `merchant-place-photos`, `merchant-payment-proofs`, `sim-box-imports`

### Browser APIs
- **Assumption:** Users grant geolocation permission for attendance
- **Implication:** Check-in requires GPS; will fail or be inaccurate without permission
- **Note:** Camera permission needed for selfie capture

---

## Missing Infrastructure

| Category | Status | Notes |
|----------|--------|-------|
| Automated Testing | Not implemented | No Jest, Vitest, Playwright, or Cypress |
| CI/CD Pipeline | Not configured | Manual deployment to Vercel |
| Error Tracking | Not integrated | No Sentry, Bugsnag, or similar |
| Performance Monitoring | Not configured | No APM or real-user monitoring |
| Database Backups | Supabase managed | No custom backup strategy documented |
| Rate Limiting | Not implemented | API routes unprotected from abuse |
| CSP Headers | Not configured | Only basic security headers present |
| Email/SMS Delivery | Not integrated | All notifications are in-app only |
| Background Jobs | Not implemented | No queue system for async tasks |
| Data Caching | Not implemented | No Redis, SWR, or React Query |
| Search | Basic client-side filter | No full-text search (Supabase FTS available but unused) |
| Audit Log UI | Superadmin only | No per-org audit log viewer |
| Data Export | Not implemented | No CSV/Excel/PDF export |
| Real-time Updates | Not implemented | Supabase Realtime available but unused for live data |

---

## Security Considerations

| Concern | Current State | Recommendation |
|---------|--------------|----------------|
| Input validation | Partial (Zod on some forms) | Add Zod validation to ALL API routes |
| SQL injection | Protected by Supabase SDK parameterization | Low risk — SDK handles escaping |
| XSS | React auto-escapes; no `dangerouslySetInnerHTML` usage found | Low risk |
| CSRF | Supabase cookie auth with SameSite=Lax | Acceptable for same-origin |
| File upload | Limited type/size checking in some paths | Standardize validation on all upload endpoints |
| Rate limiting | None | Add rate limiting to public endpoints |
| Secrets in code | Placeholder URLs in Supabase client files | Acceptable — real keys in .env.local only |
| Demo credentials | Controlled by env var | Ensure `NEXT_PUBLIC_SHOW_DEMO_LOGINS=false` in production |

---

## Technical Debt

| Item | Priority | Effort |
|------|----------|--------|
| Add Zod validation to all API routes | High | Medium |
| Add pagination to all list queries | High | Medium |
| Replace `as never` casts with proper typing | Medium | High |
| Add error handling/feedback on all mutations | Medium | Medium |
| Implement data caching (SWR or React Query) | Medium | Medium |
| Add automated testing (at minimum: API routes) | Medium | High |
| Set up CI/CD pipeline | Medium | Low |
| Integrate error tracking (Sentry) | Medium | Low |
| Add email notification delivery | Low | Medium |
| Implement proper i18n with next-intl | Low | High |
| Add dark mode brand color mapping | Low | Low |
| Clean up dead code (mock.ts, unused scripts) | Low | Low |

---

## Deployment Assumptions

- **Vercel** is the deployment platform (serverless functions, edge network)
- **Supabase** is the managed database (no self-hosted PostgreSQL)
- **HTTPS** is provided by Vercel (required for geolocation API)
- **Domain:** Custom domain configured through Vercel
- **Environment:** Single environment (no staging/preview deployments documented)
