#!/usr/bin/env node
/**
 * Plot Ampo's Vercel Web Analytics data as a standalone SVG chart.
 *
 * Usage:
 *   node scripts/usage-chart.mjs                 # last 7 days, by day
 *   node scripts/usage-chart.mjs --days=30       # last 30 days
 *   node scripts/usage-chart.mjs --by=hour       # hourly buckets
 *   node scripts/usage-chart.mjs --out=path.svg
 *
 * Requires the Vercel CLI to be logged in (uses `vercel api`). Web Analytics
 * only reports pageviews + anonymous unique visitors going forward; it cannot
 * backfill history before the feature was enabled on 2026-11-23.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PROJECT_ID = 'prj_Dv37B44pqmZruQkGkMLUJdDpT8XY';
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : 'true'];
}));

const days = Math.max(1, Math.min(90, Number(args.days) || 7));
const by = ['hour', 'day', 'week', 'month'].includes(args.by) ? args.by : 'day';
const out = args.out || '/private/var/folders/04/3dn3shdx7xz2f9tn_q8g0p0r0000gn/T/opencode/ampo-usage-chart.svg';

const until = new Date();
const since = new Date(until.getTime() - days * 86400_000);
const iso = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

const url = `/v1/query/web-analytics/visits/aggregate?projectId=${PROJECT_ID}`
  + `&since=${encodeURIComponent(iso(since))}&until=${encodeURIComponent(iso(until))}&by=${by}`;

let payload;
try {
  payload = JSON.parse(execFileSync('vercel', ['api', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch (error) {
  console.error('Could not query Vercel Web Analytics:', error.message);
  process.exit(1);
}

const points = (payload.data || []).map(p => ({
  label: by === 'hour'
    ? new Date(p.timestamp).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true })
    : new Date(p.timestamp).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
  pageviews: Number(p.pageviews) || 0,
  visitors: Number(p.visitors) || 0,
}));

const totalPageviews = points.reduce((n, p) => n + p.pageviews, 0);
const totalVisitors = points.reduce((n, p) => n + p.visitors, 0);
const peak = Math.max(1, ...points.map(p => p.pageviews));

const W = 900, H = 380, L = 56, R = 24, T = 86, B = 56;
const plotW = W - L - R, plotH = H - T - B;
const slot = plotW / Math.max(points.length, 1);
const barW = Math.max(4, Math.min(34, slot * 0.34));
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,-apple-system,Segoe UI,sans-serif">`,
  `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
  `<text x="${L}" y="34" font-size="20" font-weight="700" fill="#0f172a">Ampo — site usage (Vercel Web Analytics)</text>`,
  `<text x="${L}" y="58" font-size="12" fill="#64748b">${by} buckets · ${iso(since)} → ${iso(until)} · pageviews ${totalPageviews}, unique visitors ${totalVisitors}</text>`,
  `<text x="${L}" y="74" font-size="11" fill="#94a3b8">Tracking started 2026-11-23 — earlier history is unavailable. Pageviews are not API call counts.</text>`,
];

for (let i = 0; i <= 4; i++) {
  const y = T + plotH - (plotH * i / 4);
  const value = Math.round(peak * i / 4);
  svg.push(`<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`);
  svg.push(`<text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#94a3b8">${value}</text>`);
}

points.forEach((p, i) => {
  const cx = L + slot * i + slot / 2;
  const ph = (p.pageviews / peak) * plotH;
  const vh = (p.visitors / peak) * plotH;
  svg.push(`<rect x="${(cx - barW - 2).toFixed(1)}" y="${(T + plotH - ph).toFixed(1)}" width="${barW}" height="${Math.max(ph, 0).toFixed(1)}" rx="3" fill="#2563eb"><title>${esc(p.label)}: ${p.pageviews} pageviews</title></rect>`);
  svg.push(`<rect x="${(cx + 2).toFixed(1)}" y="${(T + plotH - vh).toFixed(1)}" width="${barW}" height="${Math.max(vh, 0).toFixed(1)}" rx="3" fill="#16a34a"><title>${esc(p.label)}: ${p.visitors} visitors</title></rect>`);
  if (points.length <= 14 || i % Math.ceil(points.length / 12) === 0) {
    svg.push(`<text x="${cx.toFixed(1)}" y="${T + plotH + 18}" text-anchor="middle" font-size="10" fill="#64748b">${esc(p.label)}</text>`);
  }
});

svg.push(`<rect x="${L}" y="${H - 26}" width="12" height="12" rx="2" fill="#2563eb"/><text x="${L + 18}" y="${H - 16}" font-size="11" fill="#475569">Pageviews</text>`);
svg.push(`<rect x="${L + 110}" y="${H - 26}" width="12" height="12" rx="2" fill="#16a34a"/><text x="${L + 128}" y="${H - 16}" font-size="11" fill="#475569">Unique visitors</text>`);
svg.push('</svg>');

writeFileSync(out, svg.join('\n'));
console.log(`Chart written to ${out}`);
console.log(`Pageviews: ${totalPageviews} | Unique visitors: ${totalVisitors} | Buckets: ${points.length}`);
