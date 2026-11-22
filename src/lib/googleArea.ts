export type GoogleRefreshStatus = 'pending' | 'done' | 'empty' | 'failed' | 'cached';

export interface GoogleRefreshInfo {
  cell: string;
  status: GoogleRefreshStatus;
  foundCount?: number;
  newCount?: number;
  enrichedCount?: number;
  checkedAt?: string;
  message?: string;
}

const CELL_SIZE = 0.05; // ~5 km at Indian latitudes

/** Keep this identical to server/lib/googleAreaBackfill.ts. */
export function googleAreaCell(lat: number, lng: number): string {
  return `${Math.round(lat / CELL_SIZE)},${Math.round(lng / CELL_SIZE)}`;
}
