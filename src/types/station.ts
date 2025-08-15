export interface ChargingStation {
  id: string;
  name: string;
  provider: string;
  address: string;
  lat: number;
  lng: number;
  distance: number;
  status: 'operational' | 'maintenance' | 'out-of-service';
  connectorTypes?: string[];
  powerOutput?: string;
  pricing?: string;
}

export interface UserLocation {
  lat: number;
  lng: number;
}