# Tatwir Talent HRMS - System Documentation

> Comprehensive technical documentation for the Tatwir Talent Human Resource Management System.

## About This Project

**Tatwir Talent HRMS** is a SaaS HR Management System purpose-built for deskless workers in retail, logistics, and field operations. The primary target market is Saudi Arabia (KSA).

| Property | Value |
|----------|-------|
| Package Name | `tatwir-hrms` |
| Version | 0.1.0 |
| Framework | Next.js 14 (App Router) |
| Database | Supabase (PostgreSQL) |
| Language | TypeScript (strict) |
| UI Direction | RTL (Arabic-first) |
| Brand Color | `#5DAE46` (Tatwir Green) |
| Tagline | "Measure Work. Maximize Performance." |

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | System architecture, component relationships, data flow |
| [Project Structure](./project-structure.md) | Folder/file layout with explanations |
| [Setup Guide](./setup.md) | Installation, environment configuration, first run |
| [Database](./database.md) | Schema, tables, migrations, RLS policies |
| [API Reference](./api.md) | All API endpoints with methods and descriptions |
| [Modules](./modules.md) | Feature module descriptions and business logic |
| [Services](./services.md) | Service layer API documentation |
| [Authentication & RBAC](./authentication.md) | Auth flow, roles, permissions, route protection |
| [Frontend](./frontend.md) | Components, pages, hooks, UI patterns |
| [Configuration](./configuration.md) | Environment variables, Next.js config, Tailwind setup |
| [Dependencies](./dependencies.md) | All packages and external integrations |
| [Development Guide](./development.md) | Development workflows, conventions, scripts |
| [Implementation Change History](./IMPLEMENTATION_CHANGE_HISTORY.md) | Complete inventory/custody/returns/Excel-recognition delivery history and release process |
| [Known Issues](./known-issues.md) | Bugs, limitations, and assumptions |
| [Multi-Tenancy Audit](./audit.md) | Full multi-tenancy readiness audit and phased roadmap |
| [Audit Remediation](./audit-remediation.md) | Remediation progress, completed fixes, and rollout checks |
| [Schema Apply Notes](./schema-apply.md) | Database schema application notes |
| [Agent Instruction](./Agent%20instruction.md) | Required workflow for future agents before and after changes |

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# Run development server
npm run dev
```

The app runs at `http://localhost:3000` by default.

## LMS v43

The repository now includes a professional internal LMS module for corporate employee learning. See:
- [Modules](./modules.md#lms-module-v43)
- [Database](./database.md#lms-v43-additive-migration)
- [API Reference](./api.md#lms-v43-api)
- [Frontend](./frontend.md#lms-v43-frontend)

## On-Ground Agent and Trader SIM Chain v47-v53

The repository also includes the on-ground SIM distribution workflow: manager stock control, field-agent accounts, trader accounts, editable SIM package commission rules, SIM box OCR stock import, merchant/trader payment confirmations, trader sale activation details, and Finance commission settlement tracking. See:
- [Modules](./modules.md#10a-on-ground-agent--trader-sim-distribution)
- [Database](./database.md#on-ground-agent-and-trader-sim-chain-v47-v53)
- [API Reference](./api.md#on-ground-agent--trader-sim-apis)
- [Frontend](./frontend.md#on-ground-agent--trader-frontend)
- [Schema Apply Notes](./schema-apply.md#apply-on-ground-agent-and-trader-migrations)

## Current State

The project is a **functional Phase 1+ prototype** with multiple active modules (HR core, Sales, Recruitment, Accounting, Chat, LMS, promoter kiosk, and on-ground SIM distribution). The frontend is well-structured with consistent patterns and the database schema is comprehensive with Row Level Security properly configured. See [Known Issues](./known-issues.md) for production-readiness gaps.

For the latest serialized product-inventory implementation timeline, including employee custody, evidence-backed returns, automatic Excel recognition, navigation updates, verification, and pending work, see [Implementation Change History](./IMPLEMENTATION_CHANGE_HISTORY.md).
