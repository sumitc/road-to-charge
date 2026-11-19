export type ConnectorSpeed = 'slow' | 'fast' | 'super-fast';

export interface ConnectorFilterOption {
  value: string;
  label: string;
  match: string[];
}

/** Filter options shown in Near Me and Trip Planner. */
export const CONNECTOR_FILTER_OPTIONS: ConnectorFilterOption[] = [
  { value: 'all', label: 'All connectors', match: [] },
  {
    value: 'type2',
    label: 'Type 2 — Slow (AC)',
    match: ['type 2', 'type2', 'mennekes', 'j1772', 'type 1'],
  },
  {
    value: 'bharatAc',
    label: 'Bharat AC — Slow (AC)',
    match: ['bharat ac', 'ac001'],
  },
  {
    value: 'chademo',
    label: 'CHAdeMO — Fast (DC)',
    match: ['chademo'],
  },
  {
    value: 'bharatDc',
    label: 'Bharat DC — Fast (DC)',
    match: ['bharat dc', 'dc001'],
  },
  {
    value: 'ccs',
    label: 'CCS — Super-fast (DC)',
    match: ['ccs'],
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

/** Raw connector type plus a plain-language speed hint, e.g. "CCS · Super-fast". */
export function connectorBadgeLabel(connector: string): string {
  const speed = connectorSpeed(connector);
  return speed ? `${connector} · ${SPEED_LABEL[speed]}` : connector;
}

/** True when any of a station's connector types matches the selected filter. */
export function matchesConnectorFilter(
  connectorTypes: string[] | undefined,
  filter: string
): boolean {
  if (filter === 'all') return true;
  if (!connectorTypes?.length) return false;

  const option = CONNECTOR_FILTER_OPTIONS.find(item => item.value === filter);
  if (!option) return true;

  return connectorTypes.some(type => includesAny(type.toLowerCase(), option.match));
}
