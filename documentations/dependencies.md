# Dependencies & External Integrations

## Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `next` | 14.2.35 | React framework (App Router, SSR, API routes) |
| `react` | ^18.3.1 | UI library |
| `react-dom` | ^18.3.1 | React DOM renderer |
| `@supabase/supabase-js` | ^2.105.1 | Supabase JavaScript client (database, auth, storage) |
| `@supabase/ssr` | ^0.10.2 | Supabase server-side rendering helpers (cookie auth) |
| `@base-ui/react` | ^1.4.1 | Unstyled React primitives (used alongside ShadCN) |
| `@zxing/browser` | ^0.2.0 | Best-effort client-side barcode detection for SIM box images |
| `class-variance-authority` | ^0.7.1 | Component variant utility (ShadCN pattern) |
| `clsx` | ^2.1.1 | Conditional className joining |
| `tailwind-merge` | ^3.5.0 | Merge Tailwind classes without conflicts |
| `tesseract.js` | ^7.0.0 | Free client-side OCR for SIM box import |
| `tw-animate-css` | ^1.4.0 | Tailwind animation utilities |
| `lucide-react` | ^1.14.0 | Icon library (500+ SVG icons) |
| `date-fns` | ^4.1.0 | Date manipulation and formatting |
| `react-day-picker` | ^9.14.0 | Calendar/date picker component |
| `recharts` | ^3.8.1 | Charting library (line, bar, area, pie charts) |
| `leaflet` | ^1.9.4 | Interactive maps (geofence visualization) |
| `shadcn` | ^4.6.0 | ShadCN CLI for component generation |
| `zod` | ^4.4.3 | Schema validation library |

## Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5 | TypeScript compiler |
| `@types/node` | ^20 | Node.js type definitions |
| `@types/react` | ^18 | React type definitions |
| `@types/react-dom` | ^18 | React DOM type definitions |
| `@types/leaflet` | ^1.9.21 | Leaflet type definitions |
| `eslint` | ^8 | Code linting |
| `eslint-config-next` | 14.2.35 | Next.js ESLint preset |
| `postcss` | ^8 | CSS processing (Tailwind pipeline) |
| `tailwindcss` | ^3.4.1 | Utility-first CSS framework |
| `tailwindcss-animate` | ^1.0.7 | Tailwind animation plugin |
| `dotenv` | ^16.4.5 | Environment variable loading (scripts) |
| `pg` | ^8.11.5 | PostgreSQL client (migration/seed scripts) |

---

## External Service Integrations

### Supabase (Primary Backend)

**Services Used:**
| Service | Purpose |
|---------|---------|
| PostgreSQL | Relational database with RLS |
| Auth | Email/password authentication, session management |
| Storage | File uploads (selfies, documents, attachments) |
| Realtime | (Available but not heavily used) |

**Connection Types:**
- Browser client: Public anon key → subject to RLS
- Server client: Anon key + cookies → user-context queries
- Admin client: Service role key → bypasses RLS

### Vercel (Deployment)

- Automatic deployments from GitHub
- Edge network for static assets
- Serverless functions for API routes
- Environment variable management

### Google Fonts

- **Noto Sans Arabic** — Primary application font
- Loaded via `next/font/google` with variable weight support

---

## What's NOT Integrated

The following common SaaS integrations are **not present**:

| Category | Status |
|----------|--------|
| Email Service (SendGrid, Resend, etc.) | Not integrated — notifications are in-app only |
| SMS (Twilio, etc.) | Not integrated |
| Payment Processing (Stripe, etc.) | Not integrated |
| Error Tracking (Sentry, etc.) | Not integrated |
| Analytics (GA, Mixpanel, etc.) | Not integrated |
| Push Notifications (FCM, etc.) | Not integrated |
| CI/CD (GitHub Actions, etc.) | Not configured |
| Monitoring (DataDog, etc.) | Not configured |
| Redis / Cache Layer | Not used |
| Message Queue (Bull, etc.) | Not used |
| ORM (Prisma, Drizzle, etc.) | Not used (direct Supabase SDK) |
| Testing Framework (Jest, Vitest, etc.) | Not installed |
| Data Fetching (SWR, React Query, etc.) | Not used |
| State Management (Redux, Zustand, etc.) | Not used |
| Form Library (react-hook-form, etc.) | Not used |
| i18n (next-intl, etc.) | Not used (hardcoded Arabic/English) |

---

## Dependency Architecture

```
┌─────────────────────────────────────────────┐
│              Application Layer               │
│                                             │
│  Next.js 14 ← React 18 ← TypeScript 5     │
│                                             │
├─────────────────────────────────────────────┤
│              UI Layer                        │
│                                             │
│  Tailwind CSS + ShadCN/UI + lucide-react   │
│  + class-variance-authority + clsx         │
│  + tailwind-merge + tw-animate-css         │
│                                             │
├─────────────────────────────────────────────┤
│              Data Layer                      │
│                                             │
│  @supabase/supabase-js + @supabase/ssr     │
│  + zod (validation)                         │
│                                             │
├─────────────────────────────────────────────┤
│              Feature Libraries               │
│                                             │
│  date-fns + react-day-picker (dates)        │
│  recharts (charts)                          │
│  leaflet (maps)                             │
│                                             │
├─────────────────────────────────────────────┤
│              Dev Tooling                     │
│                                             │
│  ESLint + TypeScript + PostCSS              │
│  pg + dotenv (scripts only)                 │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Version Constraints

- **Node.js:** 18.x+ required (Next.js 14 requirement)
- **npm:** 9.x+ (for lockfile format)
- **TypeScript:** 5.x (strict mode features)
- **React:** 18.x (not 19 — App Router compatibility)
- **Next.js:** 14.2.x (not 15 — API stability)

---

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` must NEVER be exposed to the browser
- `NEXT_PUBLIC_*` variables are safe to expose (bundled into client code)
- The `pg` package is only used in scripts (never in the deployed application)
- `dotenv` is a dev dependency only (Next.js handles env loading in production)
