# Energy configurator

Find the best combination of solar panels, battery, EV charge points and grid connection for a Dutch building.
Every design is simulated hour by hour (8,760 h) in the visitor's browser.

## Run locally

1. `npm install`
2. `npm run dev`
3. Open http://localhost:3000

## Check the engine against the Python reference

`npm run parity` reads `scripts/parity_cases.json`, produced by `python parity_cases.py` in the Python model's
`src/` folder (not committed here: it is regenerated from the reference model).

## Deploy

Vercel project `energy-configurator` (team "Wim's projects"). Every push to `main` deploys.
