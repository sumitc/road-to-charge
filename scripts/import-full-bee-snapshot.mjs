/**
 * One-off/full import of the BEE/Ministry of Power station snapshot.
 *
 * The keyless BEE API is rate limited to 100 requests / 15 minutes, so the
 * normal daily sync can only pull a couple of pages per state. This script
 * reads the same publisher dataset from the upstream project's static JSON
 * (29,184 stations, one request) and upserts all of it in one pass.
 *
 * Usage:
 *   node scripts/import-full-bee-snapshot.mjs /tmp/ruvo-bee-stations.json
 */
import fs from 'node:fs';
import postgres from 'postgres';
import { createStationDb } from '../server/lib/station-db.ts';

function loadEnv() {
  if (!fs.existsSync('.env.vercel')) return;
  for (const line of fs.readFileSync('.env.vercel', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    if (!process.env[key]) {
      process.env[key] = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
}

function parseKw(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : undefined;
}

function normaliseConnector(value) {
  const key = String(value ?? '').toLowerCase().replace(/^ev_connector_type_/, '');
  const aliases = {
    type2_combo: 'CCS2',
    ccs_combo_2: 'CCS2',
    ccs2: 'CCS2',
    type1_combo: 'CCS1',
    ccs_combo_1: 'CCS1',
    type2: 'Type 2',
    type2_ac: 'Type 2',
    type1: 'Type 1',
    type1_ac: 'Type 1',
    'ccs-ii': 'CCS2',
    chademo: 'CHAdeMO',
    nacs: 'NACS',
    gbt: 'GB/T',
    lev_ac: 'LEV AC',
    lev_dc: 'LEV DC',
    bharat_ac001: 'Bharat AC',
    bharat_dc001: 'Bharat DC',
  };
  return aliases[key] ?? value;
}

function mapRow(row) {
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  const chargers = Array.isArray(row.chargers) ? row.chargers : [];
  const standards = Array.isArray(row.standards) ? row.standards : [];
  const currents = Array.isArray(row.currents) ? row.currents : [];
  return {
    station_name: row.address || `${row.city || row.district || 'BEE'} EV Charging Station`,
    provider: row.operator || 'Unknown Provider',
    latitude: lat,
    longitude: lng,
    address: [row.address, row.city, row.district, row.state].filter(Boolean).join(', '),
    charger_type: chargers[0]?.type_raw,
    connector_types: standards.map(normaliseConnector),
    availability_status: 'unknown',
    external_id: `bee_${row.id}`,
    maps_link: `https://www.google.com/maps?q=${lat},${lng}`,
    power_output: row.max_power_kw ? `${row.max_power_kw}kW` : undefined,
    connectors: chargers.flatMap((charger) =>
      (Array.isArray(charger.guns) ? charger.guns : []).map((gun) => ({
        standard: normaliseConnector(gun.standard ?? ''),
        kw: parseKw(gun.kw),
        chargerKw: parseKw(charger.charger_kw),
        count: charger.count,
      })),
    ),
    max_power_kw: parseKw(row.max_power_kw),
    max_kw_by_standard: row.max_kw_by_standard ?? {},
    total_chargers: row.total_chargers,
    total_connectors: row.total_connectors,
    vehicle_classes: row.vehicle_classes,
    charging_current: currents.join(','),
    ownership: row.ownership,
    state: row.state,
    district: row.district,
    city: row.city,
    location_quality: row.location_quality,
    mixed_admin: row.mixed_admin,
    data_as_of: 'till 26th October 2025',
    source_name: 'EV Public Charging Stations Data till 26th October 2025',
    source_url: 'http://beeindia.gov.in/WriteReadData/RTF1984/EV_PCS_Data_29277.pdf',
  };
}

loadEnv();
const input = process.argv[2] || '/tmp/ruvo-bee-stations.json';
const rows = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!Array.isArray(rows) || rows.length === 0) throw new Error('No rows in snapshot');
console.log(`Loaded ${rows.length} BEE stations from ${input}`);

const db = createStationDb();
const BATCH = 500;
for (let i = 0; i < rows.length; i += BATCH) {
  await db.upsert(rows.slice(i, i + BATCH).map(mapRow));
  process.stdout.write(`\rUpserted ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
}
console.log('');

// Remove the hard-coded demonstration rows from the old sync sources. They
// were never real operator data and some were labelled as PlugShare.
const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
const sql = postgres(url, { ssl: 'require', max: 1, prepare: false, connect_timeout: 20 });
const removed = await sql`
  DELETE FROM public.ev_charging_stations
  WHERE source_name IS NULL AND (
    external_id LIKE 'plugshare_%' OR external_id LIKE 'jio_bp_%' OR
    external_id LIKE 'cz_%' OR external_id LIKE 'bb_%' OR external_id LIKE 'abb_%' OR
    station_name LIKE 'Tata Power EZ Charge - %' OR
    station_name LIKE 'Ather Grid - %' OR station_name LIKE 'Statiq - %'
  )
  RETURNING station_name
`;
console.log(`Removed ${removed.length} demonstration rows`);
await sql.end();
await db.close();
