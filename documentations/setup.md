# Installation & Setup Guide

## Prerequisites

- **Node.js** 18.x or later
- **npm** 9.x or later
- **Supabase Project** — Create one at [supabase.com](https://supabase.com)
- **Git** for version control

## Step 1: Clone and Install

```bash
git clone <repository-url>
cd HR
npm install
```

## Step 2: Environment Configuration

Create your local environment file:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your Supabase credentials:

```env
# Required - Supabase Project
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Required for database scripts only
SUPABASE_DB_URL=postgresql://postgres:[password]@db.[project-id].supabase.co:5432/postgres
```

### Where to find these values:

1. Go to your Supabase project dashboard
2. Navigate to **Settings → API**
3. Copy the **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
4. Copy the **anon/public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Copy the **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`
6. Navigate to **Settings → Database** for the connection string → `SUPABASE_DB_URL`

## Step 3: Database Setup

### Option A: Fresh Setup (New Supabase Project)

Apply the base schema (destructive — drops all existing application tables):

```bash
ALLOW_DESTRUCTIVE_SCHEMA_APPLY=true npm run apply:schema
```

Then apply all incremental migrations in order:

```bash
npm run apply:migration -- db/schema_v2_additions.sql
npm run apply:migration -- db/schema_v3_rbac.sql
# ... continue through all migrations
npm run apply:migration -- db/schema_v40_accounting_audit_fixes.sql
```

### Option B: Incremental Migration (Existing Database)

Apply only the specific migration needed:

```bash
npm run apply:migration -- db/schema_v12_safe_saves_and_policy_fix.sql
```

### Supabase Storage Buckets

Create the following storage buckets in your Supabase dashboard (Storage → New Bucket):

| Bucket Name | Purpose | Public |
|-------------|---------|--------|
| `attendance-selfies` | Employee check-in photos | No |
| `employee-documents` | Employee CVs, contracts, IDs | No |

## Step 4: Seed Initial Data

### Production Setup

Create the first admin user:

```bash
npm run seed:admin
```

To create Dr. Amr Naiem as platform superadmin:

```bash
npm run seed:dr-amr
```

### Development/Staging Setup

Create demo users with pre-set credentials:

```bash
npm run seed:demo
```

Additional seed scripts for development:

```bash
npm run seed:saudi-employees      # Sample employee records
npm run seed:demo-tasks           # Task data
npm run seed:demo-schedules-leaves # Schedule and leave data
npm run seed:sales-mock           # Sales module data
npm run seed:recruitment-mock     # Recruitment pipeline data
npm run seed:attendance-dashboard # Attendance records
npm run seed:location-coordinates # GPS coordinates for locations
```

## Step 5: Run the Development Server

```bash
npm run dev
```

The application will be available at **http://localhost:3000**.

### Demo Credentials (Development Only)

| Role | Email | Password |
|------|-------|----------|
| Admin | `hr@tatwir.sa` | `12345678` |
| Employee | `employee@tatwir.sa` | `123456789` |

## Step 6: Verify Setup

1. Open http://localhost:3000 — you should see the login page
2. Log in with demo credentials (if seeded)
3. The dashboard should display with KPI cards
4. Navigate to Employees, Departments, etc. to verify data loads

## Production Deployment (Vercel)

1. Push your code to GitHub
2. Connect the repository to Vercel
3. Set environment variables in Vercel dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy — Vercel auto-builds on push

### Security Headers

The Next.js config (`next.config.mjs`) automatically applies these security headers:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(self), geolocation=(self), microphone=()`

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Build fails with Supabase errors | Ensure `.env.local` exists with valid credentials |
| Login redirects back to login | Check Supabase Auth settings and RLS policies |
| Data doesn't load | Verify the database schema is applied and user has org membership |
| Storage uploads fail | Create the required storage buckets in Supabase |
| Geolocation doesn't work | Must access via HTTPS or localhost (browser security) |
