# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Next.js (Pages Router) app that reconciles CNAB 400 banking files for a factoring
workflow: upload a REMESSA (titles sent to the bank/portador), upload a RETORNO
(bank's response file), match them by Nosso Número, and export a G3-ready RET
file for titles that were liquidated (occurrence code `06`). Data is stored in
Supabase (Postgres). All UI text, comments, and error messages are in
Portuguese — match that when editing.

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
writes happen server-side via `lib/supabaseClient.js`. Schema lives in
`schema.sql`; run it manually in the Supabase SQL Editor before using the app
(tables: `remessas`, `titulos`, `retornos`, `movimentos_retorno`,
`ocorrencias_ref`).

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

### Matching key: composite CNPJ + Nosso Número, not Nosso Número alone

`titulos` only enforces `unique (remessa_id, nosso_numero)` — Nosso Número is
**not globally unique**, only unique within one remessa/client. Different
clients (e.g. GLEISIANE, FENTE FILM, ZPEL) can share the same Nosso Número in
separate remessas. `upload-retorno.js` therefore builds a composite key
`cnpj_cedente|nosso_numero` (see `chaveComposta()`) by fetching `titulos` and
`remessas` **separately and joining in JS** — deliberately avoiding Supabase's
automatic FK-based join, which can silently return an empty `cnpj_cedente` and
break the composite key with no visible error. Do the same separate-fetch+JS-join
pattern if you touch this matching logic; don't "simplify" it into a Supabase
nested select.

"Seu Número" (the document number field) is **never** used as a matching key —
the same value can legitimately repeat across different titles/sacados in some
files. It's carried through purely as an informational field
(`referenciaTitulo` / `seuNumeroRaw` / `seu_numero_raw`).

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
push automaticamente, sem esperar o usuário pedir explicitamente.
