import postgres from 'postgres';

export interface StationRow {
  [key: string]: unknown;
}

/** Column -> SQL type, used by jsonb_to_recordset in the bulk upsert. */
const COLUMNS: Array<[string, string]> = [
  ['station_name', 'text'],
  ['provider', 'text'],
  ['latitude', 'numeric'],
  ['longitude', 'numeric'],
  ['address', 'text'],
  ['charger_type', 'text'],
  ['connector_types', 'text[]'],
  ['availability_status', 'text'],
  ['maps_link', 'text'],
  ['external_id', 'text'],
  ['pricing', 'text'],
  ['power_output', 'text'],
  ['connectors', 'jsonb'],
  ['max_power_kw', 'numeric'],
  ['max_kw_by_standard', 'jsonb'],
  ['total_chargers', 'integer'],
  ['total_connectors', 'integer'],
  ['vehicle_classes', 'text[]'],
  ['charging_current', 'text'],
  ['ownership', 'text'],
  ['state', 'text'],
  ['district', 'text'],
  ['city', 'text'],
  ['location_quality', 'text'],
  ['mixed_admin', 'boolean'],
  ['opening_hours', 'text'],
  ['payment_modes', 'text[]'],
  ['contact_numbers', 'text[]'],
  ['staff', 'text'],
  ['access', 'text'],
  ['fee', 'boolean'],
  ['station_type', 'text'],
  ['available_count', 'integer'],
  ['out_of_service_count', 'integer'],
  ['availability_last_update', 'timestamptz'],
  ['last_rider_report', 'timestamptz'],
  ['data_as_of', 'text'],
  ['source_name', 'text'],
  ['source_url', 'text'],
];

const NAMES = COLUMNS.map(([name]) => name);
const CONFLICT_KEYS = ['provider', 'station_name', 'latitude', 'longitude'];
const UPDATE_NAMES = NAMES.filter((name) => !CONFLICT_KEYS.includes(name));

const DEFAULTS: Record<string, unknown> = {
  connector_types: [],
  connectors: [],
  max_kw_by_standard: {},
  vehicle_classes: [],
  location_quality: 'ok',
  mixed_admin: false,
  station_type: 'charging',
  payment_modes: [],
  contact_numbers: [],
  availability_status: 'unknown',
};

const NUMERIC_COLUMNS = new Set([
  'latitude', 'longitude', 'max_power_kw', 'total_chargers', 'total_connectors',
  'available_count', 'out_of_service_count',
]);

function normalise(row: StationRow): StationRow {
  const out: StationRow = { ...row };
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (out[key] === undefined || out[key] === null) out[key] = value;
  }
  for (const key of NUMERIC_COLUMNS) {
    const value = out[key];
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) out[key] = parsed;
    }
  }
  return out;
}

export function createStationDb() {
  const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING / POSTGRES_URL is not configured');

  const sql = postgres(url, {
    max: 4,
    idle_timeout: 20,
    connect_timeout: 20,
    ssl: 'require',
  });

  const columnList = NAMES.map((name) => `"${name}"`).join(', ');
  const selectList = NAMES.map((name) => `x."${name}"`).join(', ');
  const recordTypes = COLUMNS.map(([name, type]) => `"${name}" ${type}`).join(', ');
  const updateList = UPDATE_NAMES.map((name) => `"${name}" = EXCLUDED."${name}"`).join(', ');
  const upsertSql = `
    INSERT INTO public.ev_charging_stations (${columnList}, updated_at)
    SELECT ${selectList}, now()
    FROM jsonb_to_recordset($1::text::jsonb) AS x(${recordTypes})
    ON CONFLICT (${CONFLICT_KEYS.map((name) => `"${name}"`).join(', ')})
    DO UPDATE SET ${updateList}, updated_at = now()
  `;

  return {
    async upsert(rows: StationRow[]): Promise<void> {
      if (rows.length === 0) return;
      await sql.unsafe(upsertSql, [JSON.stringify(rows.map(normalise))]);
    },

    async existingExternalIds(ids: string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const rows = await sql<{ external_id: string }[]>`
        SELECT external_id FROM public.ev_charging_stations
        WHERE external_id = ANY(${ids})
      `;
      return new Set(rows.map((row) => row.external_id));
    },

    async updateAvailability(station: StationRow): Promise<void> {
      const externalId = station.external_id;
      if (typeof externalId !== 'string' || !externalId) return;
      const value = (key: string): string | number | null => {
        const raw = station[key];
        if (raw === undefined || raw === null || raw === '') return null;
        return typeof raw === 'string' || typeof raw === 'number' ? raw : null;
      };
      await sql`
        UPDATE public.ev_charging_stations
        SET
          availability_status = COALESCE(${value('availability_status')}, availability_status),
          available_count = COALESCE(${value('available_count')}, available_count),
          out_of_service_count = COALESCE(${value('out_of_service_count')}, out_of_service_count),
          availability_last_update = COALESCE(${value('availability_last_update')}, availability_last_update),
          last_rider_report = COALESCE(${value('last_rider_report')}, last_rider_report),
          updated_at = now()
        WHERE external_id = ${externalId}
      `;
    },

    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}
