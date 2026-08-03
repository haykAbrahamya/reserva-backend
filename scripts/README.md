# Operational scripts

One-off / repeatable admin tasks that talk to the running API (not part of the app build).

## `apply-service-translations.mjs`

Bulk-applies **name + category translations** (en / hy / ru) to a partner's
**existing** services. It updates via `PATCH /services/:id` — it never creates
services. Each input row is matched to a service by its base Armenian `name`.

### Input format

A JSON array, one object per service:

```json
[
  {
    "name": "Ազդրերի ալեքսանդրիտ",
    "name_en": "Thighs (Alexandrite Laser)",
    "name_ru": "Бедра (Александритовый лазер)",
    "category": "Ալեքսանդրիտային մազահեռացում",
    "category_en": "Alexandrite Laser Hair Removal",
    "category_ru": "Александритовая эпиляция"
  }
]
```

`name` / `category` (Armenian) must match the service's base values exactly — they
are the match key and are also stored as the `hy` locale. The base columns are not
modified; only the `nameI18n` / `categoryI18n` blobs are set.

### Run

1. Get a **partner admin** access token (role `admin`) for the target partner —
   e.g. log in as that partner in the backoffice and copy the bearer from
   `localStorage['reserva-access']`, or from the network tab. Tokens expire in
   ~15 min, so grab it right before running.

2. **Dry run first** — fetches + matches, writes nothing. Confirm
   `unmatched=0` before doing the real run:

   ```bash
   DRY=1 TOKEN=<bearer> node scripts/apply-service-translations.mjs ./partner-x.json
   ```

3. Apply for real:

   ```bash
   TOKEN=<bearer> node scripts/apply-service-translations.mjs ./partner-x.json
   ```

### Options

| Var / flag        | Default                          | Purpose                                  |
| ----------------- | -------------------------------- | ---------------------------------------- |
| `TOKEN=` / `--token=` | —                            | Partner admin bearer (required)          |
| `API_URL=` / `--api=` | `https://api.reserva.am/api/v1` | Target API (use `http://localhost:4000/api/v1` locally) |
| `DRY=1` / `--dry` | off                              | Match only, no writes                    |

### Notes

- The token scopes to one partner — other partners' services are never touched.
- **Idempotent**: re-running just re-sets the same translations.
- Any row with no matching service is listed under `UNMATCHED` and skipped
  (nothing is created). Fix the name and re-run — safe to repeat.
- `example-alexandrite-diode.json` is the input used for the first partner (laser
  hair-removal), kept as a reference template.
