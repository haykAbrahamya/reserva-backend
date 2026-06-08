# Reserva API

Multi-tenant salon booking platform — backend for the **partner-backoffice**, the
public **client booking** app, and the future **internal-backoffice**.

Built with **NestJS 11 · Prisma · PostgreSQL · Zod**. Stateless JWT auth
(access + rotating refresh), per-tenant data isolation, role-based access
(`admin` / `manager`), and a hard, race-proof double-booking guarantee enforced
at the database level.

---

## Stack & architecture

```
src/
  common/            cross-cutting: errors, interceptors, dto, utils, schemas, ids
    errors/          ErrorCode enum, AppException, global exception filter
    utils/           phone normalization, availability/slot math
    schemas/         shared Zod schemas (week schedule)
  config/            env validation (Zod) — fails fast on bad config
  prisma/            PrismaModule + PrismaService
  auth/              JWT access+refresh, guards (JWT, Roles, Internal), password (argon2)
  modules/
    partners/        tenant + branding/presentation; public read by slug; internal provisioning
    locations/       branches + weekly opening hours (admin-managed)
    services/        service catalog
    specialists/     team, service links, weekly schedule, time-off (+ conflict detection)
    clients/         per-partner customers (deduped by phone), stats
    bookings/        backoffice CRUD, status, reschedule — overlap-guarded
    public/          unauthenticated availability + booking by slug
    users/           manager management (admin), OTP issuance
  health.controller.ts
  main.ts            bootstrap, Helmet, CORS, Scalar docs, /api/v1 prefix
```

**Conventions**

- Every response is wrapped `{ "data": ... }`; paginated lists return
  `{ items, page, pageSize, total, pageCount }`.
- Every error is `{ "error": { code, message, details? } }` with a stable
  machine-readable `code` (see `src/common/errors/error-codes.ts`).
- All DTOs are **Zod** schemas (`createZodDto`) → validated by a global pipe and
  reflected into the OpenAPI document.
- Primary keys are **UUIDv7** (time-ordered, index-friendly, non-enumerable).
- Tenant isolation: every owned row carries `partnerId`; the JWT carries the
  caller's `partnerId`/`role`/`locationId` and services scope all queries by it.
  Managers are additionally restricted to their branch.

---

## Getting started

### 1. Prerequisites

- Node ≥ 20, pnpm ≥ 9
- PostgreSQL ≥ 14 (needs the `btree_gist` extension — standard in core)

### 2. Install & configure

```bash
pnpm install
cp .env.example .env        # then edit secrets + DATABASE_URL
```

Generate strong secrets for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`INTERNAL_API_KEY` (e.g. `openssl rand -hex 32`).

### 3. Database — migrate

```bash
pnpm prisma:generate         # generate the Prisma client
pnpm prisma:deploy           # apply migrations (prod)
# — or, in development —
pnpm prisma:migrate          # create/apply dev migrations
```

The migrations include the baseline schema **and** the booking-overlap
`EXCLUDE` constraint (`bookings_no_overlap`) that makes double-booking
impossible even under concurrent load.

### 4. Seed demo data (optional, server-run)

Ports the original frontend mock data (Antheris, BarberBro, Lumé, Avanta) — full
branding, locations, services, specialists, a few bookings, and login users.

```bash
pnpm db:seed
```

Demo logins (password `demo1234`):

| Email                 | Role    | Tenant            |
| --------------------- | ------- | ----------------- |
| `admin@antheris.am`   | admin   | Antheris          |
| `manager@antheris.am` | manager | Antheris · Arabkir |
| `admin@barberbro.am`  | admin   | BarberBro         |
| `admin@lume.am`       | admin   | Lumé Studio       |
| `admin@avanta.am`     | admin   | Avanta            |

### 5. Run

```bash
pnpm start:dev               # watch mode
# or
pnpm build && pnpm start:prod
```

- API base: `http://localhost:4000/api/v1`
- **Interactive docs (Scalar): `http://localhost:4000/api/docs`**
- OpenAPI JSON: `http://localhost:4000/api/openapi.json`
- Health: `http://localhost:4000/api/v1/health`

---

## API surface (high level)

| Area        | Routes (under `/api/v1`)                                                              | Auth         |
| ----------- | ------------------------------------------------------------------------------------ | ------------ |
| Auth        | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `POST /auth/change-password` | mixed |
| Partner     | `GET /partner`, `PATCH /partner` (admin)                                              | JWT          |
| Locations   | `GET /locations`, `POST/PATCH/DELETE /locations/:id` (admin)                          | JWT          |
| Services    | `GET/POST /services`, `PATCH/DELETE /services/:id`                                    | JWT          |
| Specialists | `GET/POST /specialists`, `PATCH/DELETE /specialists/:id`, `…/:id/time-off` (+ `/conflicts`) | JWT    |
| Clients     | `GET /clients` (search, paginated), `GET/PATCH /clients/:id`                          | JWT          |
| Bookings    | `GET /bookings`, `GET /bookings/calendar`, `POST /bookings`, `PATCH /bookings/:id`, `/:id/status`, `DELETE` | JWT |
| Users       | `GET/POST /users`, `PATCH/DELETE /users/:id` (admin)                                  | JWT (admin)  |
| Public      | `GET /public/partners/:slug`, `…/slots`, `POST …/bookings`                            | none         |
| Internal    | `POST /internal/partners` (provision partner + first admin)                           | `x-internal-key` |

Managers are scoped to their branch on bookings/calendar automatically.

---

## Notes for ops

- **Scaling:** stateless API — run N instances behind a load balancer. Refresh
  tokens are stored hashed in `refresh_tokens` and rotated on every refresh.
- **Indexes:** all hot query paths are indexed (tenant + time-window on bookings,
  tenant + phone on clients, etc.). See `prisma/schema.prisma`.
- **Throttling:** global rate limit (configurable); the public booking POST has a
  tighter per-IP limit.
