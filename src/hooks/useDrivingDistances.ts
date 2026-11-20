import { useQuery } from '@tanstack/react-query';
import type { ChargingStation } from '@/types/station';

/**
 * Road distances are fetched after the station list has rendered, so the list
 * itself stays fast. A single OSRM table call covers up to 80 stations; the
 * straight-line distance already on each row is used until this resolves.
 */
const CHUNK_SIZE = 80;

interface Origin {
  lat: number;
  lng: number;
}

async function fetchChunk(origin: Origin, stations: ChargingStation[]): Promise<Record<string, number>> {
  const coords = [
    `${origin.lng},${origin.lat}`,
    ...stations.map(station => `${station.lng},${station.lat}`),
  ].join(';');
  const destinations = stations.map((_, index) => index + 1).join(';');
  const response = await fetch(
    `https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&destinations=${destinations}&annotations=distance`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) throw new Error(`Routing table returned ${response.status}`);
  const data = await response.json() as { distances?: number[][] };
  const distances = data.distances?.[0] ?? [];
  const result: Record<string, number> = {};
  stations.forEach((station, index) => {
    const metres = distances[index];
    if (typeof metres === 'number' && Number.isFinite(metres)) {
      result[station.id] = metres / 1000;
    }
  });
  return result;
}

export function useDrivingDistances(origin: Origin | null, stations: ChargingStation[]) {
  // Sort IDs so re-ordering the visible cards never changes the cache key and
  // triggers a second routing table call.
  const key = stations.map(station => station.id).sort().join(',');
  return useQuery<Record<string, number>>({
    queryKey: ['driving-distances', origin?.lat.toFixed(3), origin?.lng.toFixed(3), key],
    enabled: Boolean(origin && stations.length > 0),
    queryFn: async () => {
      if (!origin) return {};
      const result: Record<string, number> = {};
      for (let i = 0; i < stations.length; i += CHUNK_SIZE) {
        Object.assign(result, await fetchChunk(origin, stations.slice(i, i + CHUNK_SIZE)));
      }
      return result;
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
}
