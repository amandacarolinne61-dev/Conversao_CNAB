# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Next.js (Pages Router) app that reconciles CNAB 400 banking files for a factoring
workflow: upload a REMESSA (titles sent to the bank/portador), upload a RETORNO
(bank's response file), match them by Seu Número (see "Matching key" below),
and export a G3-ready RET file for titles that were liquidated (occurrence
code `06`). Data is stored in Supabase (Postgres). All UI text, comments, and
error messages are in Portuguese — match that when editing.

Built for a factoring operation (Energy Power / Money Solution), reconciling
titles against multiple client "carteiras" (e.g. GLEISIANE, FENTE FILM,
ZPEL). **Bancorp** is the first factoring/bank RETORNO layout this project
targets and the one `cnabRetorno.js`'s shifting-middle-field handling was
built around — see `lib/cnabRetorno.js` for that parsing note. `titulos`
persist in Supabase from the moment a REMESSA is uploaded and stay there
(never in-memory only) until a matching RETORNO arrives, however long that
takes.

## Commands

```
npm install
npm run dev     # http://localhost:3000
npm run build
npm run start
```

There is no test suite and no lint script configured in `package.json`.

Requires `.env.local` (see `.env.local.example`) with `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` — the service role key (not anon), because all
writes happen server-side via `lib/supabaseClient.js`. Also needs
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the public anon
key) for the browser-side realtime dashboard — see "Realtime dashboard"
below. Schema lives in `schema.sql`; run it manually in the Supabase SQL
Editor before using the app (tables: `remessas`, `titulos`, `retornos`,
`movimentos_retorno`, `ocorrencias_ref`, `dashboard_stats`).

## Architecture

**Flow:** `pages/index.js` uploads raw file text (decoded as **ISO-8859-1**,
not UTF-8 — CNAB files are Latin-1) as JSON to the API routes, which parse
fixed-width CNAB lines and write to Supabase.

- `lib/cnabRemessa.js` — parses REMESSA files (outbound, layout Itaú). Fixed
  400-char width, fully reliable positions.
- `lib/cnabRetorno.js` — parses RETORNO files (inbound, from the factoring).
  Some factorings (e.g. Bancorp) don't have a 100% fixed width: a field in the
  *middle* of the line varies in size, shifting everything after it. The
  parser only reads fields anchored to the front (CNPJ, Nosso Número,
  occurrence code) and fields anchored to the end (date, value, sacado name)
  — never fields that depend on the shifting middle section.
- `pages/api/upload-remessa.js` — inserts a `remessas` row + one `titulos` row
  per detail line. Rejects (409) if any Nosso Número in the file already
  exists in `titulos`.
- `pages/api/upload-retorno.js` — inserts a `retornos` row + `movimentos_retorno`
  rows, then bulk-updates matched `titulos.status`.
- `pages/api/exportar-baixas.js` — generates the outbound `.RET` file from
  `titulos` where `status = 'liquidado' AND exportado_em IS NULL`, then marks
  them exported.
- `pages/api/titulos.js` — read-only listing for the UI.
- `pages/api/dashboard-status.js` — read-only counts per `titulos.status`,
  backing the dashboard chart's initial load.

### Matching key: Seu Número (document number), not Nosso Número

As of the CNAB parsing update on 2026-07-22, the matching key between
`titulos` and incoming `movimentos_retorno` is **Seu Número**
(`titulos.seu_numero` / `mov.seuNumeroRaw`), normalized via
`normalizarNumeroTitulo()` in `upload-retorno.js` (strips everything but
letters/digits, case-insensitive). Nosso Número is **not** used to find the
title anymore — it's extracted and stored purely as a reference field
(`nossoNumeroFactoring`), used later by `exportar-baixas.js`.

Why the change: `titulos` only enforces `unique (remessa_id, nosso_numero)` —
Nosso Número is **not globally unique**, only unique within one
remessa/client, so two different clients could collide on it and get matched
to the wrong title. Seu Número is chosen by the client before the remessa is
generated, so it's a stronger identity signal per client — **but it has also
been seen to repeat across different titles/sacados within the same client**
(one real case: FENTE FILM had the same Seu Número on 9 different titles). So
`upload-retorno.js` never auto-picks among multiple candidates when a Seu
Número hits more than one `titulo` — it collects every match, flags them as
`titulosAmbiguos`, links none of them to `titulo_id`, and surfaces the list in
the API response for manual resolution instead of silently matching wrong.

If you touch this logic: keep building the lookup index from a **fresh
separate fetch** of all `titulos` (see `indiceTitulos` in
`upload-retorno.js`), not a Supabase nested/joined select — this codebase has
previously relied on separate-fetch-and-join-in-JS to avoid silent join
failures, and that habit still matters here even though the join key changed.

### Occurrence codes drive status, not hardcoded logic

`ocorrencias_ref` (Supabase table) maps occurrence code → description →
whether it triggers a baixa (`gera_baixa`). Adding a new occurrence code is a
data change in Supabase, not a code change. `STATUS_POR_OCORRENCIA` in
`upload-retorno.js` maps codes to the `titulos.status` values shown in the UI
(`aguardando_retorno`, `confirmado`, `rejeitado`, `liquidado`, `baixado`,
`baixa_rejeitada`, `ver_manual`).

### RET export format (`exportar-baixas.js`)

Output layout is built from real, byte-validated template lines
(`HEADER_TEMPLATE` / `DETAIL_TEMPLATE` / `TRAILER_TEMPLATE`), with fields
overwritten at fixed byte offsets via `setAt()`. Notable, non-obvious
positions documented in the file's header comment: the title reference the
G3 system actually reads is at position 42 (10 chars), *not* the position-116
field, which is only an informational echo. The value written is always the
**contracted title value** (`valor_titulo`), not the value actually paid in
the retorno — any discrepancy is surfaced only as a UI warning, never written
to the exported file. Trailer must carry the real title count and total value
(a zeroed trailer was observed to make G3 distrust the whole file).

### Realtime dashboard (`dashboard_stats`)

`schema.sql` defines a `dashboard_stats` table (status → count, one row per
status) kept in sync with `titulos` by a Postgres trigger
(`recalcular_dashboard_stats()`), rather than exposing `titulos` itself to
Supabase Realtime. This is deliberate: `titulos` has CNPJ, sacado names and
values — sensitive for a factoring operation — and Realtime payloads over
`postgres_changes` go out to whatever holds the anon key, which is meant to
be public. `dashboard_stats` never holds anything beyond status + count, so
it's the only table with an RLS policy allowing public (`anon`) `select`; all
other tables have RLS **enabled with no policy**, meaning only the server's
`service_role` key (which bypasses RLS) can read/write them. If you add
another Realtime-driven feature, follow the same pattern — never grant `anon`
direct access to a business table just to get Realtime to fire.

Gotcha: this Supabase project rejects any `DELETE`/`UPDATE` without a `WHERE`
clause for non-superuser roles — **including `service_role`, and even inside
a `SECURITY DEFINER` trigger function**. The SQL Editor runs as `postgres`
(exempt), so an unfiltered `delete from dashboard_stats;` looks fine there but
throws `"DELETE requires a WHERE clause"` the moment a real upload (which
runs as `service_role` through PostgREST) fires the trigger. Always write
`where true` explicitly if a delete is meant to clear a whole table.

`components/DashboardChart.js` (browser) subscribes to `dashboard_stats` via
`lib/supabaseBrowserClient.js`, which uses `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (separate from the server's
`SUPABASE_SERVICE_ROLE_KEY` — the anon key is the only one ever sent to the
browser). If those env vars aren't set, the component falls back to polling
`/api/dashboard-status` every 8s instead of failing.

### Dates

CNAB dates are `DDMMAA` fixed-width, converted to ISO `YYYY-MM-DD` via
`toDate()`/`isoParaDDMMAA()` helpers in each lib file (not shared — if you fix
a date bug, check all three: `cnabRemessa.js`, `cnabRetorno.js`,
`exportar-baixas.js`). The frontend (`pages/index.js`) formats ISO dates back
to `DD/MM/YYYY` via manual string splitting, deliberately avoiding
`new Date(iso)` — parsing a date-only ISO string produces UTC midnight, which
shifts a day earlier once converted to Brazil's timezone.

## Git workflow

Sempre que terminar uma tarefa (fix, feature, refactor, etc.), faça commit e
push automaticamente, sem esperar o usuário pedir explicitamente — mas
**sempre na branch `dev`, nunca direto em `main`** (main é produção). Se a
branch `dev` não existir ainda localmente, crie a partir de `main`. Deploys
pra `main` são decisão explícita do usuário, não automática.
