import { ChargingStation } from '@/types/station';
import { LocationService } from '@/services/locationService';
import { EVStationService } from '@/services/evStationService';

// Mock charging stations data - in real app, this would come from APIs
const mockStations: Omit<ChargingStation, 'distance'>[] = [
  {
    id: '1',
    name: 'Connaught Place Fast Charge',
    provider: 'Tata Power',
    address: 'Connaught Place, New Delhi, Delhi 110001',
    lat: 28.6315,
    lng: 77.2167,
    status: 'operational',
    connectorTypes: ['CCS', 'CHAdeMO', 'Type 2'],
    powerOutput: '50kW DC',
    pricing: '₹12/kWh'
  },
  {
    id: '2',
    name: 'DLF Mall Charging Hub',
    provider: 'ChargeZone',
    address: 'DLF Mall of India, Noida, Uttar Pradesh 201301',
    lat: 28.5706,
    lng: 77.3272,
    status: 'operational',
    connectorTypes: ['CCS', 'Type 2'],
    powerOutput: '22kW AC',
    pricing: '₹8/kWh'
  },
  {
    id: '3',
    name: 'India Gate Electric Station',
    provider: 'BPCL',
    address: 'India Gate, Rajpath, New Delhi, Delhi 110003',
    lat: 28.6129,
    lng: 77.2295,
    status: 'operational',
    connectorTypes: ['CCS', 'CHAdeMO'],
    powerOutput: '60kW DC',
    pricing: '₹15/kWh'
  },
  {
    id: '4',
    name: 'Gurgaon Cyber City Hub',
    provider: 'Shell Recharge',
    address: 'Cyber City, Gurugram, Haryana 122002',
    lat: 28.4950,
    lng: 77.0910,
    status: 'maintenance',
    connectorTypes: ['CCS', 'Type 2'],
    powerOutput: '50kW DC',
    pricing: '₹13/kWh'
  },
  {
    id: '5',
    name: 'Karol Bagh Electric Zone',
    provider: 'Fortum',
    address: 'Karol Bagh, New Delhi, Delhi 110005',
    lat: 28.6519,
    lng: 77.1909,
    status: 'operational',
    connectorTypes: ['Type 2', 'Bharat AC'],
    powerOutput: '7kW AC',
    pricing: '₹6/kWh'
  },
  {
    id: '6',
    name: 'Lajpat Nagar Fast Charge',
    provider: 'Ather Grid',
    address: 'Lajpat Nagar, New Delhi, Delhi 110024',
    lat: 28.5674,
    lng: 77.2436,
    status: 'operational',
    connectorTypes: ['CCS', 'Type 2'],
    powerOutput: '30kW DC',
    pricing: '₹10/kWh'
  },
  {
    id: '7',
    name: 'Faridabad Industrial Hub',
    provider: 'Tata Power',
    address: 'Sector 16A, Faridabad, Haryana 121002',
    lat: 28.4089,
    lng: 77.3178,
    status: 'out-of-service',
    connectorTypes: ['CCS', 'CHAdeMO'],
    powerOutput: '50kW DC',
    pricing: '₹12/kWh'
  },
  {
    id: '8',
    name: 'Rohini Express Charging',
    provider: 'ChargeZone',
    address: 'Sector 18, Rohini, New Delhi, Delhi 110089',
    lat: 28.7041,
    lng: 77.1025,
    status: 'operational',
    connectorTypes: ['CCS', 'Type 2', 'Bharat DC'],
    powerOutput: '25kW DC',
    pricing: '₹9/kWh'
  }
];

export const getStationsWithDistance = async (userLocation: { lat: number; lng: number } | null, radius: number = 50): Promise<ChargingStation[]> => {
  if (!userLocation) return [];

  // Use real EV station service instead of mock data
  try {
    const stations = await EVStationService.getStationsWithDistance(userLocation, radius);
    return stations;
  } catch (error) {
    console.error('Error fetching real station data, falling back to mock:', error);
    
    // Fallback to mock data if real service fails
    return mockStations
      .map(station => ({
        ...station,
        distance: LocationService.calculateDistance(userLocation, { lat: station.lat, lng: station.lng })
      }))
      .filter(station => station.distance <= radius)
      .sort((a, b) => a.distance - b.distance);
  }
};

export const searchStationsByLocation = async (query: string): Promise<ChargingStation[]> => {
  // Use real EV station service for search
  try {
    const stations = await EVStationService.searchStationsByLocation(query);
    return stations;
  } catch (error) {
    console.error('Error searching real station data, falling back to mock:', error);
    
    // Fallback to mock data if real service fails
    const mockSearchResults = mockStations.map(station => ({
      ...station,
      distance: Math.random() * 20 + 1 // Random distance for demo
    }));

    return mockSearchResults.sort((a, b) => a.distance - b.distance);
  }
};