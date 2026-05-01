# Apply Database Schema

## Requirements
- .env.local with SUPABASE_DB_URL (or DATABASE_URL)
- Node.js installed

## Command
```bash
node scripts/apply-schema.mjs
```

The script runs db/schema.sql inside a transaction and prints success or failure.
