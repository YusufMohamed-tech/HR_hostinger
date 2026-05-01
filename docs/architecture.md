# System Architecture

## Components
- Next.js 14 App Router frontend
- Supabase backend (PostgreSQL, Auth, Storage)
- Optional AI service (Python or API route)

## Data Flow
1. User signs in (magic link later, mock now)
2. Client calls Next.js API routes
3. API routes use service layer to access Supabase
4. RLS enforces org-based access at database level
5. Aggregations feed KPI, payroll, and AI insights

## Deployment
- Frontend on Vercel
- Supabase managed database and auth
- Optional AI microservice on serverless or container
