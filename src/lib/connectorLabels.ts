export type ConnectorSpeed = 'slow' | 'fast' | 'super-fast';

export interface ConnectorFilterOption {
  value: string;
  /** Speed first, technology second, e.g. "Super-fast · CCS". */
  label: string;
  /** Short explanation shown in the filter dropdown. */
  hint: string;
  match: string[];
}

/** Filter options shown in Near Me and Trip Planner, ordered fastest first. */
export const CONNECTOR_FILTER_OPTIONS: ConnectorFilterOption[] = [
  {
    value: 'ccs',
    label: 'Super-fast · CCS',
    hint: 'DC · usually 50–350 kW',
    match: ['ccs'],
  },
  {
    value: 'chademo',
    label: 'Fast · CHAdeMO',
    hint: 'DC · usually 25–50 kW',
    match: ['chademo'],
  },
  {
    value: 'bharatDc',
    label: 'Fast · Bharat DC',
    hint: 'DC · public fast charging',
    match: ['bharat dc', 'dc001'],
  },
  {
    value: 'type2',
    label: 'Slow · Type 2',
    hint: 'AC · usually 3–22 kW',
    match: ['type 2', 'type2', 'mennekes', 'j1772', 'type 1'],
  },
  {
    value: 'bharatAc',
    label: 'Slow · Bharat AC',
    hint: 'AC · standard charging',
    match: ['bharat ac', 'ac001'],
  },
];

const VALUE_TO_RAW_TYPE: Record<string, string> = {
  ccs: 'CCS',
  chademo: 'CHAdeMO',
  bharatDc: 'Bharat DC',
  type2: 'Type 2',
  bharatAc: 'Bharat AC',
};

const speedByMatch: Array<{ match: string[]; speed: ConnectorSpeed }> = [
  { match: ['ccs', 'supercharger', 'ultra'], speed: 'super-fast' },
  { match: ['chademo', 'bharat dc', 'dc001', 'gb/t dc', 'dc fast'], speed: 'fast' },
  {
    match: ['type 2', 'type2', 'bharat ac', 'ac001', 'mennekes', 'j1772', 'type 1', 'ac slow'],
    speed: 'slow',
  },
];

const SPEED_LABEL: Record<ConnectorSpeed, string> = {
  slow: 'Slow',
  fast: 'Fast',
  'super-fast': 'Super-fast',
};

const includesAny = (value: string, needles: string[]): boolean =>
  needles.some(needle => value.includes(needle));

/** Friendly charging-speed bucket for a raw connector standard. */
export function connectorSpeed(connector: string): ConnectorSpeed | undefined {
  const value = connector.toLowerCase();
  return speedByMatch.find(entry => includesAny(value, entry.match))?.speed;
}

/** Speed-first badge label, e.g. "Super-fast · CCS". */
export function connectorBadgeLabel(connector: string): string {
  const speed = connectorSpeed(connector);
  return speed ? `${SPEED_LABEL[speed]} · ${connector}` : connector;
}

/** Canonical connector standard stored in the database for a filter value. */
export function connectorRawType(value: string): string {
  return VALUE_TO_RAW_TYPE[value] ?? value;
}

/** Infer selected connector values from free text, e.g. OCR output. */
export function inferConnectorTypesFromText(text: string): string[] {
  const value = text.toLowerCase();
  return CONNECTOR_FILTER_OPTIONS
    .filter(option => includesAny(value, option.match))
    .map(option => option.value);
}

/**
 * True when a station matches any selected connector filter. An empty
 * selection means "all connectors", which keeps the default view unchanged.
 */
export function matchesConnectorFilters(
  connectorTypes: string[] | undefined,
  filters: string[]
): boolean {
  if (!filters.length) return true;
  if (!connectorTypes?.length) return false;

  return filters.some(filter => {
    const option = CONNECTOR_FILTER_OPTIONS.find(item => item.value === filter);
    if (!option) return false;
    return connectorTypes.some(type => includesAny(type.toLowerCase(), option.match));
  });
}
