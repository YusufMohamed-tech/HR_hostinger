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

## Current State

The project is a **functional Phase 1+ prototype** with multiple active modules (HR core, Sales, Recruitment, Accounting, Chat). The frontend is well-structured with consistent patterns and the database schema is comprehensive with Row Level Security properly configured. See [Known Issues](./known-issues.md) for production-readiness gaps.
