// Backtest: score past days from the Open-Meteo archive, to compare against sessions you
// remember. Usage: node scripts/backtest.mjs <area-id> <start YYYY-MM-DD> <end YYYY-MM-DD>
// e.g.        node scripts/backtest.mjs magic-wood 2026-08-12 2026-08-31
// The archive has no rain probability, so only measured rain counts, and it lags real time
// by a few days. Three extra days are fetched before the start so the wetness model has history.
import { AREAS } from '../public/frictionforecast/areas.js';
import { fetchArchive } from '../public/frictionforecast/openmeteo.js';
import { rateDays } from '../public/frictionforecast/score.js';

const [id, start, end] = process.argv.slice(2);
const area = AREAS.find((a) => a.id === id);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
if (!area || !isDate(start) || !isDate(end) || end < start) {
  console.error('Usage: node scripts/backtest.mjs <area-id> <start YYYY-MM-DD> <end YYYY-MM-DD>');
  console.error(`Areas: ${AREAS.map((a) => a.id).join(', ')}`);
  process.exit(1);
}

const lead = new Date(`${start}T00:00:00Z`);
lead.setUTCDate(lead.getUTCDate() - 3);
const [raw] = await fetchArchive([area], lead.toISOString().slice(0, 10), end);
const days = rateDays(raw.hourly, area).filter((d) => d.date >= start);

console.log(`${area.name} (${area.rock}), scored ${area.hours[0]}:00–${area.hours[1]}:00 local\n`);
console.log('date        rating  score  window        temp  RH   wind  rain mm');
for (const d of days) {
  const rain = d.hours.reduce((s, h) => s + h.precip, 0);
  const w = d.rating === 'wet' || d.score === 0 ? d.hours : d.hours.filter((h) => h.hour >= Number(d.window.slice(0, 2)) && h.hour < Number(d.window.slice(0, 2)) + 3);
  const avg = (k) => Math.round(w.reduce((s, h) => s + h[k], 0) / w.length);
  console.log([
    d.date, d.rating.padEnd(6), String(d.score).padStart(5), ` ${d.window}`,
    `${avg('temp')}°`.padStart(5), `${avg('humidity')}%`.padStart(4), String(avg('wind')).padStart(5), rain.toFixed(1).padStart(8),
  ].join('  '));
}
const count = (r) => days.filter((d) => d.rating === r).length;
console.log(`\n${count('good')} good, ${count('okay')} okay, ${count('bad')} bad, ${count('wet')} wet out of ${days.length} days.`);
