# Backend (Next.js API + Services)

## API Route Structure
- /api/employees
- /api/departments
- /api/locations
- /api/contracts
- /api/schedules
- /api/events
- /api/kpis
- /api/payroll
- /api/lms
- /api/audit

## Service Layer
- src/services/supabaseClient.ts
- src/services/employeesService.ts
- src/services/schedulingService.ts
- src/services/analyticsService.ts
- src/services/payrollService.ts

## Patterns
- Request validation per route
- Org scoping at every query
- Audit logging for all writes
