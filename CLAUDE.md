# CLAUDE.md - Energy configurator (Your Energy Choice Today)

Public configurator for solar, battery, EV charging and grid connection. Change 4 of the energy model project
(owner: Wim Hendriksen). The Python model in the project bundle (`energy_model_source.zip`) is the reference;
this repo is its browser port plus the web page.

## Rules

1. **Read first.** Read this file and `projects-spec.md` before any action.
2. **Define before you build.** Any new feature, input, tariff, data flow or integration: update `projects-spec.md`,
   show it to Wim, wait for approval.
3. **Look before you create.** Check Vercel (team "Wim's projects"), GitHub and Supabase (Bridge CRM) for what exists.
4. **Test before you say done.**
   - `npm run build` passes; no console errors; light and dark; phone width without sideways scroll.
   - `npm run parity` (cases from `energy/src/parity_cases.py`): browser vs Python NPV within EUR 100, energy within 0.5%.
   - A full optimisation finishes in under 10 s on a laptop.
5. **Confirm before anything public or paid.** Connecting the domain, going public, or any purchase needs Wim's go-ahead.

**Core rule:** do exactly what is asked. If unclear, ask first.

## How to respond

Plain English. Each reply: What I just did / What you need to do / Why / Next step / Errors.

## Tech stack

- Next.js 14 (App Router), TypeScript, Tailwind CSS. Deployed on Vercel (team "Wim's projects").
- `lib/engine/` - the model (TypeScript port of the Python reference), runs in Web Workers (`lib/engine/worker.ts`).
  `rng.ts` reproduces numpy's PCG64 / ziggurat-normal / beta so weather, price and noise series match Python.
- `lib/i18n.ts` - all text, Dutch and English. Never hard-code copy in components.
- `middleware.ts` - sends `/` to `/nl` or `/en` (cookie, then browser language).
- Phase 4b adds saving to the Bridge CRM database; until then nothing leaves the visitor's browser.

## Secrets

Never commit keys. `.env.local` is git-ignored. The Supabase service-role key (phase 4b) lives only in Vercel env vars.

## Change log

| Date | Change | Files |
|------|--------|-------|
| 2026-10-04 | Phase 4a: engine port, configurator page (nl/en), parity test | all |
