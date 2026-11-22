# Blue Piller — Documentation Index

Living technical and product documentation for **Blue Piller**, an inventory management and POS system (Next.js 16 App Router, Auth.js v5, Prisma, MySQL, English/Arabic).

These documents describe the code **as it is today**. Anything not built is labelled **Planned** or **Deferred**. They contain no secrets, environment values, database URLs or machine paths.

| Document | Language | Purpose |
|---|---|---|
| [PROJECT_DOCUMENTATION_EN.md](PROJECT_DOCUMENTATION_EN.md) | English | Full technical and product reference |
| [PROJECT_DOCUMENTATION_AR.md](PROJECT_DOCUMENTATION_AR.md) | العربية (RTL) | Same facts, written for Arabic readers |

The two documents carry the **same factual content** and the same section structure. Technical identifiers (routes, model names, environment-variable names, code, product references) are never translated.

## Where to start

| If you want to… | Read |
|---|---|
| Understand what the system is and its status | [Project Overview](PROJECT_DOCUMENTATION_EN.md#sec-overview) |
| See how the app is built | [Architecture](PROJECT_DOCUMENTATION_EN.md#sec-architecture) |
| Know who can do what | [Authentication and Authorization](PROJECT_DOCUMENTATION_EN.md#sec-auth) |
| Find a screen, route or business rule | [Application Modules](PROJECT_DOCUMENTATION_EN.md#sec-modules) |
| Understand the database | [Data Model](PROJECT_DOCUMENTATION_EN.md#sec-data-model) |
| Change stock, units, barcodes | [Inventory Rules](PROJECT_DOCUMENTATION_EN.md#sec-inventory) |
| Change money, payments, ledger | [Financial Rules](PROJECT_DOCUMENTATION_EN.md#sec-finance) |
| Work on the cashier screen | [POS Workflow](PROJECT_DOCUMENTATION_EN.md#sec-pos) |
| Add a report or label layout | [Reports and Printing](PROJECT_DOCUMENTATION_EN.md#sec-reports) |
| Add or change text / Arabic | [Localization](PROJECT_DOCUMENTATION_EN.md#sec-i18n) |
| Run migrations safely | [Database and Migration Operations](PROJECT_DOCUMENTATION_EN.md#sec-db-ops) |
| Host the system | [Deployment and Production Readiness](PROJECT_DOCUMENTATION_EN.md#sec-deployment) |
| Commit a change correctly | [Git and Change Workflow](PROJECT_DOCUMENTATION_EN.md#sec-git) |
| See what is planned or deferred | [Roadmap](PROJECT_DOCUMENTATION_EN.md#sec-roadmap) |
| Understand why it was built this way | [Decision Log](PROJECT_DOCUMENTATION_EN.md#sec-decisions) |

## Current baseline

- Documented commit: `ed94d0b` (2026-11-22), package version `0.1.0`.
- Prisma migrations in the repository: 40 (latest `20261203000000_pos_multi_unit_lines`).
- Diagrams are Mermaid and render on GitHub.

## Keeping the documents current

Update both language files in the same commit as the code change that affects them. The mapping of "what changed → which section to update" and the changelog entry format are in [How to Maintain This Documentation](PROJECT_DOCUMENTATION_EN.md#sec-maintenance) (Arabic: [كيفية صيانة هذا التوثيق](PROJECT_DOCUMENTATION_AR.md#sec-maintenance)).

Never add secrets, `.env` values, database URLs, private user data or machine-specific paths to these files.
