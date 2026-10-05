# projects-spec.md - Energy configurator

Full spec: section 8 of `project_specs.md` in the energy model project (approved 4 Oct 2026). Summary:

## What it does and who visits it

Anyone with a building (house to large office) enters their site, fleet and grid connection, optionally a year of
meter data, and gets the best combination of solar, battery, charge points and connection, simulated hour by hour.
Phase 4b: a saved result becomes a contact, company, deal and draft quote in Bridge CRM (one tenant).

## Tech stack

Next.js 14 + TypeScript + Tailwind on Vercel (team "Wim's projects", Pro). Calculation in the browser (Web Workers).
Database (phase 4b): Bridge CRM Supabase project, new tables only (`energy_reference`, `energy_tenant_settings`,
`energy_configurations`), written by one server route.

## Pages

- `/nl`, `/en` - configurator and results
- `/nl/about`, `/en/about` - method, assumptions, sources, model version

## Languages

Dutch (default) and English; `/` redirects by cookie `lang`, then browser language.

## Phases

| Phase | What | Visible to |
|---|---|---|
| 4a | Engine port with parity tests; configurator page | Wim only (Vercel preview behind Vercel login) |
| 4b | Save result into the Demo tenant of Bridge CRM | Wim only |
| 4c | Live tenant, domain (DNS at Yourhosting), go public | Public, separate go-ahead |

## Done (phase 4a)

- Parity: 30 random designs, NPV within EUR 100, energy within 0.5%; full runs pick the same best design as Python.
- Speed: full optimisation under 10 s on a laptop, under 20 s on a phone.
- Meter CSV (8,760 / 35,040 rows) works; bad files get a clear message.
- Build passes, no console errors, light/dark, phone width without sideways scroll.

## Change 5 (approved 5 Oct)

- Solar yield by roof orientation (south 950, flat 880, east-west 850 kWh/kWp, editable) and inverter cap 0.87 kW/kWp.
- Results: investment split per part, 15-year cash flow, packages compared (smart charging only, + solar,
  + battery, solar + battery), price level per part (low / base / high).
- Parity on 30 new random designs: worst EUR 2; full office run worst EUR 28, same best design (EUR 119,306).

## Phase 4b (done 5 Oct: live save verified)

Full design: section 8.10 of `project_specs.md`. Draft migration: `supabase/migrations/20261005120000_energy_configurator.sql`
(three new tables, one save function callable only by the service role, Demo seed incl. 5 products). Dry-run scripts:
`supabase/dryrun_stub.sql`, `supabase/dryrun_test.sql` (local Postgres only). Save route `/api/save` re-checks the design
on the server. Migration applied to the live database on 5 Oct after approval; security check unchanged.
