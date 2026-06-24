# Configuration Details

## Environment Variables

### Required Variables

| Variable | Type | Description |
|----------|------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL (e.g., `https://abc123.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase anonymous/public API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | Supabase service role key (bypasses RLS) |

### Database Scripts Variables

| Variable | Type | Description |
|----------|------|-------------|
| `SUPABASE_DB_URL` | Server-only | PostgreSQL connection string (for migration scripts) |
| `ALLOW_DESTRUCTIVE_SCHEMA_APPLY` | Script-only | Must be `true` to run full schema reset |
| `ALLOW_DESTRUCTIVE_MIGRATION` | Script-only | Must be `true` for migrations with DROP/TRUNCATE |

### Seed Script Variables

| Variable | Type | Description |
|----------|------|-------------|
| `INITIAL_ADMIN_EMAIL` | Script-only | Email for first admin account |
| `INITIAL_ADMIN_PASSWORD` | Script-only | Password for first admin account |
| `INITIAL_ADMIN_NAME` | Script-only | Full name for first admin |
| `INITIAL_ORG_NAME` | Script-only | Organization name |
| `INITIAL_ORG_SLUG` | Script-only | Organization URL slug |
| `INITIAL_ORG_ID` | Script-only | Pre-defined org UUID (optional) |

### Optional Demo Variables

| Variable | Type | Description |
|----------|------|-------------|
| `NEXT_PUBLIC_SHOW_DEMO_LOGINS` | Public | Show demo login buttons (`true`/`false`) |
| `NEXT_PUBLIC_DEMO_ADMIN_EMAIL` | Public | Demo admin email |
| `NEXT_PUBLIC_DEMO_ADMIN_PASSWORD` | Public | Demo admin password |
| `NEXT_PUBLIC_DEMO_EMPLOYEE_EMAIL` | Public | Demo employee email |
| `NEXT_PUBLIC_DEMO_EMPLOYEE_PASSWORD` | Public | Demo employee password |

### Template (`.env.example`)

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SHOW_DEMO_LOGINS=false
NEXT_PUBLIC_DEMO_ADMIN_EMAIL=
NEXT_PUBLIC_DEMO_ADMIN_PASSWORD=
NEXT_PUBLIC_DEMO_EMPLOYEE_EMAIL=
NEXT_PUBLIC_DEMO_EMPLOYEE_PASSWORD=
```

---

## Next.js Configuration (`next.config.mjs`)

```javascript
const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
];

const nextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
```

### Security Headers Explained

| Header | Value | Purpose |
|--------|-------|---------|
| X-DNS-Prefetch-Control | `on` | Enables DNS prefetching for performance |
| X-Frame-Options | `DENY` | Prevents clickjacking (no iframe embedding) |
| X-Content-Type-Options | `nosniff` | Prevents MIME-type sniffing attacks |
| Referrer-Policy | `strict-origin-when-cross-origin` | Controls referrer header exposure |
| Permissions-Policy | `camera=(self), geolocation=(self), microphone=()` | Restricts browser APIs to same-origin |

---

## TypeScript Configuration (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "strict": true,
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "incremental": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "paths": {
      "@/*": ["./src/*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Key settings:**
- **Strict mode:** Full TypeScript strictness enabled
- **Path alias:** `@/*` maps to `./src/*` (e.g., `@/components/ui/button`)
- **Bundler resolution:** Modern module resolution for Next.js
- **Incremental:** Faster rebuilds via TypeScript's incremental compilation

---

## Tailwind CSS Configuration (`tailwind.config.ts`)

```typescript
const config: Config = {
  darkMode: ["class"],              // Dark mode via CSS class
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],   // Noto Sans Arabic
      },
      colors: {
        // ShadCN HSL variable system
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "..." },
        secondary: { ... },
        destructive: { ... },
        muted: { ... },
        accent: { ... },
        popover: { ... },
        card: { ... },
        // Brand colors (fixed)
        brand: {
          DEFAULT: "#5DAE46",  // Tatwir Green
          dark: "#4EA72E",
          light: "#EAF3E8",
        }
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
```

---

## ShadCN/UI Configuration (`components.json`)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

**Key settings:**
- **Style:** `base-nova` (ShadCN's newest style variant)
- **RSC:** React Server Components enabled
- **CSS Variables:** Theming via HSL variables (not static colors)
- **Icon Library:** lucide-react

---

## PostCSS Configuration (`postcss.config.mjs`)

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

Standard Tailwind CSS processing pipeline.

---

## ESLint Configuration

Uses `eslint-config-next` with the `core-web-vitals` preset for Next.js-specific rules and web performance guidelines.

---

## Middleware Configuration

The middleware matcher excludes static assets:

```typescript
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

This means middleware runs on:
- All page routes
- All API routes
- But NOT on static files, images, or Next.js internal routes

---

## Brand Configuration (`src/config/brand.ts`)

Application branding constants:

| Constant | Value |
|----------|-------|
| Brand Color | `#5DAE46` |
| Brand Dark | `#4EA72E` |
| Brand Light | `#EAF3E8` |
| App Name | "تطوير تالنت" (Tatwir Talent) |
| Tagline | "Measure Work. Maximize Performance." |
| Font | Noto Sans Arabic |
