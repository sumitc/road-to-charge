export type ConnectorSpeed = 'slow' | 'fast' | 'super-fast';

export interface ConnectorFilterOption {
  value: string;
  /** Speed first, technology second, e.g. "Super-fast · CCS". */
  label: string;
  match: string[];
}

/** Filter options shown in Near Me and Trip Planner, ordered fastest first. */
export const CONNECTOR_FILTER_OPTIONS: ConnectorFilterOption[] = [
  {
    value: 'ccs',
    label: 'Super-fast · CCS',
    match: ['ccs'],
  },
  {
    value: 'chademo',
    label: 'Fast · CHAdeMO',
    match: ['chademo'],
  },
  {
    value: 'bharatDc',
    label: 'Fast · Bharat DC',
    match: ['bharat dc', 'dc001'],
  },
  {
    value: 'type2',
    label: 'Slow · Type 2',
    match: ['type 2', 'type2', 'mennekes', 'j1772', 'type 1'],
  },
  {
    value: 'bharatAc',
    label: 'Slow · Bharat AC',
    match: ['bharat ac', 'ac001'],
  },
];

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
