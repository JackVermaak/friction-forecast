# Friction Forecast

[![Tests](https://github.com/JackVermaak/friction-forecast/actions/workflows/tests.yml/badge.svg)](https://github.com/JackVermaak/friction-forecast/actions/workflows/tests.yml)

A 7-day bouldering conditions forecast. Each day at each area is rated **good**, **okay**, **bad** or **wet**, with the best 3-hour session window, from rock temperature, humidity and wind weighted per rock type.

**Live:** [jackvermaak.com/frictionforecast](https://jackvermaak.com/frictionforecast/) · [How it works](https://jackvermaak.com/frictionforecast/about)

15 areas in seven countries, with a filter by country:

| Country | Areas | Rock |
| --- | --- | --- |
| South Africa | Rocklands, Topside (Cape Town) | Sandstone |
| Switzerland | Magic Wood, Cresciano, Chironico, Brione, Val Bavona | Gneiss |
| | Sustenpass | Granite |
| Germany | Avalonia, Göttinger Wald | Sandstone |
| | Glees | Basalt |
| France | Fontainebleau | Sandstone |
| Austria | Zillertal | Gneiss |
| Italy | Val Masino | Granite |
| Spain | Albarracín | Sandstone |

Each area's coordinates, scored hours and season are in [`areas.js`](public/frictionforecast/areas.js). To add an area, add one entry there; the request, the scoring and the filter pick it up.

## How it runs

It's a static page, with no server, no build step and no dependencies.

1. The browser makes **one** request to the [Open-Meteo](https://open-meteo.com/) forecast API for all areas: 3 days of history for the wetness model, plus 7 days ahead.
2. `score.js` scores every hour and rates each local day by its best 3-hour window.
3. The raw answer is kept in `localStorage` for an hour, along with the chosen country (also in the URL, e.g. `?country=switzerland`, so a filtered view can be shared). With no signal, the page shows the last forecast, says so, and flags it once it's over 12 hours old.

The original plan had a Cloudflare Worker that fetched every 3 hours into KV, but jackvermaak.com is a static Cloudflare Pages site. Fetching from the browser means there's nothing to deploy or keep running. Open-Meteo allows cross-origin requests, and one request per visit stays well inside the free tier.

## The model

Each hour scores 0–100 from a weighted mix of three comfort factors:

- **Rock temperature:** air temperature plus up to 8 °C for sun. Full marks from 2 to 12 °C, zero at −6 and 24 °C.
- **Humidity:** full marks at or below the rock's "good" level, zero at its "bad" level.
- **Wind:** full marks from 8 to 25 km/h. Calm air still scores 0.6.

Gates then zero or cut the score:

- rain in the hour, or a 70 % chance of it
- the air within 4 °C of its dew point (condensation)
- wet rock
- extreme rock temperature

The temperature gate isn't in the original plan. Without it, very dry air could make a 35 °C sandstone afternoon score "good". Now the whole score fades out past −6 or 24 °C and reaches zero at −16 or 34 °C.

Wetness uses a 3 mm bucket model. Rain fills it, and warmth, wind, dryness and sun empty it. Sandstone stays wet for another 24 h after the bucket empties and is a hard stop (rated **wet**), following the DAV and IG Klettern "let it dry for a day" guidance. Wet gneiss and basalt keep 40 % of their score.

The full numbers are on the [How it works](https://jackvermaak.com/frictionforecast/about) page and in [`score.js`](public/frictionforecast/score.js). Every threshold is a first guess, to be tuned against logged sessions.

## Files

```
public/frictionforecast/
  index.html, about.html, style.css
  app.js        page: fetch, cache, render
  score.js      scoring model (pure functions, no DOM)
  areas.js      areas, rock types, scored hours, seasons
  openmeteo.js  request URLs and fetch helpers
scripts/backtest.mjs   score past days from the Open-Meteo archive
scripts/stamp.mjs      content hashes in the pages, so browsers never mix old and new files
test/score.test.mjs    unit tests on hand-built hourly fixtures
```

## Develop

Needs Node 18 or newer. There's nothing to install.

```bash
npm test        # scoring tests
npm run check   # syntax check, and that the pages' cache-busting hashes are current
npm run stamp   # rewrite those hashes after changing any file in public/frictionforecast
npm run serve   # http://localhost:8790/frictionforecast/
```

Backtest any area against the archive, to compare with sessions you remember:

```bash
node scripts/backtest.mjs magic-wood 2026-08-12 2026-08-31
```

## Publishing

The site copy lives in the [jackvermaak.com](https://github.com/JackVermaak/jackvermaak.com) repo. After changing anything under `public/frictionforecast`, run `npm run stamp` here and commit. Then run `python3 tools/sync_apps.py` there, then commit and push. Cloudflare Pages deploys on push.

## Credits

Weather data by [Open-Meteo.com](https://open-meteo.com/), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), from the free non-commercial API.

Code: [MIT](LICENSE).
