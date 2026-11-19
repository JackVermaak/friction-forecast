// Unit tests for the scoring model, on small hand-built hourly fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROCK, DEFAULT_PROFILE, profileFor, ramp, band, windScore, wetness, hourScore, rateDays, buildForecast,
} from '../public/frictionforecast/score.js';
import { AREAS, COUNTRIES, countryKey } from '../public/frictionforecast/areas.js';
import { forecastUrl, archiveUrl, fetchForecast, PAST_DAYS } from '../public/frictionforecast/openmeteo.js';

// `days` days of hourly weather from 2026-11-01, starting from a cool, dry, breezy, cloudy
// baseline. `at(day, hour)` returns overrides for that hour.
function fixture(days, at = () => ({})) {
  const h = {
    time: [], temperature_2m: [], relative_humidity_2m: [], dew_point_2m: [], wind_speed_10m: [],
    wind_gusts_10m: [], precipitation: [], precipitation_probability: [], shortwave_radiation: [],
  };
  for (let d = 0; d < days; d++) {
    for (let hr = 0; hr < 24; hr++) {
      const o = { temp: 8, rh: 40, wind: 12, rain: 0, prob: 0, sun: 0, ...at(d, hr) };
      const date = `2026-11-${String(d + 1).padStart(2, '0')}`;
      h.time.push(`${date}T${String(hr).padStart(2, '0')}:00`);
      h.temperature_2m.push(o.temp);
      h.relative_humidity_2m.push(o.rh);
      h.dew_point_2m.push(o.dew ?? o.temp - 10);
      h.wind_speed_10m.push(o.wind);
      h.wind_gusts_10m.push(o.wind * 1.5);
      h.precipitation.push(o.rain);
      h.precipitation_probability.push(o.prob);
      h.shortwave_radiation.push(o.sun);
    }
  }
  return h;
}
const area = (rock, hours = [8, 20]) => ({ id: rock, rock, hours });
const day = (h, rock, i, hours) => rateDays(h, area(rock, hours))[i];

test('ramps and bands are straight lines between their end points', () => {
  assert.equal(ramp(5, 0, 10), 0.5);
  assert.equal(ramp(-1, 0, 10), 0);
  assert.equal(ramp(11, 0, 10), 1);
  const p = DEFAULT_PROFILE;
  assert.equal(band(7, p.tempIdeal, p.tempLimits), 1);
  assert.equal(band(18, p.tempIdeal, p.tempLimits), 0.5);
  assert.equal(band(-2, p.tempIdeal, p.tempLimits), 0.5);
  assert.equal(band(30, p.tempIdeal, p.tempLimits), 0);
});

test('wind: calm scores 0.6, a breeze 1, and a gale never drops below 0.3', () => {
  const p = DEFAULT_PROFILE;
  assert.equal(windScore(0, p), 0.6);
  assert.equal(windScore(15, p), 1);
  assert.equal(windScore(50, p), 1 - 0.7);
  assert.equal(windScore(90, p), 1 - 0.7);
});

test('settings layer default <- rock <- visitor, overriding only what each sets', () => {
  const p = profileFor(ROCK.granite, { rhBad: 70, weights: { wind: 0.1 } });
  assert.equal(p.rhBad, 70);
  assert.equal(p.rhGood, 45); // from granite
  assert.deepEqual(p.tempIdeal, DEFAULT_PROFILE.tempIdeal); // from the default
  assert.deepEqual(p.weights, { temp: 0.45, humidity: 0.35, wind: 0.1 });
  assert.deepEqual(profileFor(ROCK.gneiss).weights, DEFAULT_PROFILE.weights);
});

test('the wetness bucket caps at 3 mm and porous rock soaks for a day after it empties', () => {
  const storm = fixture(4, (d) => (d === 0 ? { rain: 0.75, rh: 95, prob: 90 } : {}));
  const sand = wetness(storm, ROCK.sandstone);
  const basalt = wetness(storm, ROCK.basalt);
  const firstDry = (w) => w.findIndex((x, i) => i > 23 && !x);
  // 18 mm of rain fills the 3 mm bucket; sandstone then needs the bucket to drain plus 24 h.
  assert.ok(firstDry(sand) - firstDry(basalt) >= 24, `sandstone dry at ${firstDry(sand)}, basalt at ${firstDry(basalt)}`);
  assert.ok(basalt[23], 'still wet at the end of the storm');
  assert.ok(!basalt[95], 'basalt dry by day 4');
});

test('sandstone after a storm: wet, then wet, then good again', () => {
  // Day 0: 18 mm of rain. Day 1: sunny with 70 % humidity. Days 2-3: dry and cool.
  const h = fixture(4, (d, hr) => {
    if (d === 0) return { rain: 0.75, rh: 95, prob: 90, dew: 7 };
    if (d === 1) return { rh: 70, sun: hr >= 9 && hr <= 16 ? 500 : 0 };
    return {};
  });
  assert.equal(day(h, 'sandstone', 0).rating, 'wet');
  assert.equal(day(h, 'sandstone', 1).rating, 'wet');
  assert.equal(day(h, 'sandstone', 3).rating, 'good');
  // Gneiss and basalt are not hard-stopped: rain day scores 0, the next day is usable.
  assert.equal(day(h, 'gneiss', 0).rating, 'bad');
  assert.equal(day(h, 'gneiss', 0).score, 0);
  assert.notEqual(day(h, 'basalt', 1).rating, 'wet');
  assert.ok(day(h, 'basalt', 1).score >= 45, `basalt day after: ${day(h, 'basalt', 1).score}`);
});

test('wet gneiss keeps 40 % of its score, wet sandstone none', () => {
  const h = fixture(1);
  const p = profileFor(ROCK.gneiss);
  const dry = hourScore(h, 12, false, ROCK.gneiss, p);
  assert.equal(hourScore(h, 12, true, ROCK.gneiss, p), Math.round(dry * 0.4));
  assert.equal(hourScore(h, 12, true, ROCK.sandstone, profileFor(ROCK.sandstone)), 0);
});

test('rain now, or a 70 % chance of it, zeroes the hour', () => {
  const p = profileFor(ROCK.basalt);
  assert.equal(hourScore(fixture(1, () => ({ rain: 0.2 })), 12, false, ROCK.basalt, p), 0);
  assert.equal(hourScore(fixture(1, () => ({ prob: 70 })), 12, false, ROCK.basalt, p), 0);
  assert.ok(hourScore(fixture(1, () => ({ prob: 60 })), 12, false, ROCK.basalt, p) > 0);
});

test('condensation: the score fades as the air nears its dew point', () => {
  const p = profileFor(ROCK.basalt);
  const at = (gap) => hourScore(fixture(1, () => ({ dew: 8 - gap })), 12, false, ROCK.basalt, p);
  assert.equal(at(1), 0);
  assert.ok(at(2.5) > 0 && at(2.5) < at(4));
  assert.equal(at(4), at(8));
});

test('a scorching afternoon is bad, even in very dry air', () => {
  // 30 °C air in full sun is about 38 °C rock: past the temperature gate.
  const h = fixture(1, (d, hr) => ({ temp: 30, rh: 20, sun: 1000 }));
  const r = day(h, 'sandstone', 0);
  assert.equal(r.rating, 'bad');
  assert.equal(r.score, 0);
});

test('on a hot sunny day the cool evening window beats the afternoon', () => {
  const h = fixture(1, (d, hr) => (hr < 17
    ? { temp: 27, rh: 30, sun: hr >= 9 ? 900 : 200 }
    : { temp: 16, rh: 40, sun: 0 }));
  const r = day(h, 'sandstone', 0);
  assert.equal(r.window, '17:00–20:00');
  assert.ok(r.hours.find((x) => x.hour === 14).score < r.score);
});

test('a cold, dry, breezy day is good on every rock', () => {
  const h = fixture(1, () => ({ temp: 6, rh: 30, wind: 15 }));
  for (const rock of Object.keys(ROCK)) {
    const r = day(h, rock, 0);
    assert.equal(r.rating, 'good', rock);
    assert.ok(r.score >= 90, `${rock} ${r.score}`);
  }
});

test('a visitor setting a stricter humidity limit lowers the score', () => {
  const h = fixture(1, () => ({ temp: 8, rh: 60 }));
  const a = { id: 'g', rock: 'granite', hours: [8, 20] };
  const base = rateDays(h, a)[0].score;
  const strict = rateDays(h, a, { rhBad: 70 })[0].score;
  assert.ok(strict < base, `${strict} < ${base}`);
});

test('only scored hours count, and the window is 3 hours inside them', () => {
  const h = fixture(1, (d, hr) => (hr === 6 || hr === 7 || hr === 8 ? { temp: 6, rh: 30, wind: 15 } : { rh: 75 }));
  const r = rateDays(h, area('sandstone', [10, 17]))[0];
  assert.equal(r.hours.length, 7);
  assert.equal(r.hours[0].hour, 10);
  assert.match(r.window, /^1[0-4]:00–1[3-7]:00$/);
});

test('a sandstone day is only "wet" when every scored hour is wet', () => {
  // Rain until 10:00 then a dry sunny afternoon: the bucket drains, but the 24 h soak keeps it wet.
  const h = fixture(2, (d, hr) => (d === 0 && hr < 2 ? { rain: 0.5 } : { sun: 600 }));
  assert.equal(day(h, 'sandstone', 0).rating, 'wet');
  // A dry morning before afternoon rain is not a wet day: the morning window still counts.
  const h2 = fixture(1, (d, hr) => (hr >= 14 ? { rain: 2, prob: 90 } : {}));
  const r = day(h2, 'sandstone', 0);
  assert.notEqual(r.rating, 'wet');
  assert.ok(Number(r.window.slice(0, 2)) <= 11, r.window);
});

test('buildForecast keeps area order and drops the history days', () => {
  const areas = AREAS.slice(0, 2);
  const raw = areas.map(() => ({ hourly: fixture(10) }));
  const f = buildForecast(raw, areas, PAST_DAYS);
  assert.deepEqual(f.areas.map((a) => a.id), ['rocklands', 'topside']);
  assert.equal(f.areas[0].days.length, 7);
  assert.equal(f.areas[0].days[0].date, '2026-11-04');
  assert.ok(!Number.isNaN(Date.parse(f.updatedAt)));
});

test('missing values (null) never produce NaN scores', () => {
  const h = fixture(1);
  h.precipitation_probability = h.time.map(() => null);
  h.shortwave_radiation[12] = null;
  delete h.wind_gusts_10m;
  for (const d of rateDays(h, area('gneiss'))) for (const x of d.hours) assert.ok(Number.isFinite(x.score));
});

test('every area has a known rock, valid hours and a unique id', () => {
  const ids = new Set();
  for (const a of AREAS) {
    assert.ok(ROCK[a.rock], a.id);
    assert.ok(a.hours[0] >= 0 && a.hours[1] <= 24 && a.hours[1] - a.hours[0] >= 3, a.id);
    assert.ok(Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180, a.id);
    assert.ok(a.country && a.place && a.seasonText, a.id);
    assert.ok(a.season.length && a.season.every((m) => m >= 1 && m <= 12), a.id);
    assert.ok(!ids.has(a.id));
    ids.add(a.id);
  }
});

test('one Open-Meteo request covers every area, in order', () => {
  const u = new URL(forecastUrl(AREAS));
  assert.equal(u.searchParams.get('latitude').split(',').length, AREAS.length);
  assert.equal(u.searchParams.get('latitude').split(',')[0], String(AREAS[0].lat));
  assert.equal(u.searchParams.get('timezone').split(',')[2], 'Europe/Zurich');
  assert.equal(u.searchParams.get('past_days'), '3');
  assert.equal(u.searchParams.get('forecast_days'), '7');
  const a = new URL(archiveUrl(AREAS.slice(0, 1), '2026-08-12', '2026-08-31'));
  assert.equal(a.hostname, 'archive-api.open-meteo.com');
  assert.ok(!a.searchParams.get('hourly').includes('precipitation_probability'));
});

test('a single-area answer is wrapped in an array', async () => {
  const fake = async () => ({ ok: true, json: async () => ({ hourly: { time: [] } }) });
  const out = await fetchForecast(AREAS.slice(0, 1), fake);
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 1);
  const bad = async () => ({ ok: false, status: 429, text: async () => 'limit' });
  await assert.rejects(fetchForecast(AREAS, bad), /429/);
});

test('countries: each listed once, in first-appearance order, with areas grouped together', () => {
  assert.deepEqual(COUNTRIES.map((c) => c.name),
    ['South Africa', 'Switzerland', 'Germany', 'France', 'Austria', 'Italy', 'Spain']);
  assert.equal(COUNTRIES.reduce((n, c) => n + c.count, 0), AREAS.length);
  assert.equal(COUNTRIES.find((c) => c.name === 'Switzerland').count, 6);
  // Grouped: once a country's run of areas ends, it never comes back.
  const runs = AREAS.map((a) => a.country).filter((c, i, all) => c !== all[i - 1]);
  assert.equal(runs.length, COUNTRIES.length);
  assert.equal(countryKey('South Africa'), 'south-africa');
  for (const c of COUNTRIES) assert.match(c.key, /^[a-z]+(-[a-z]+)*$/);
});
