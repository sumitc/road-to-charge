export const config = { runtime: 'edge' };

import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EVConnectorData {
  standard: string;
  kw?: number;
  chargerKw?: number;
  count?: number;
  availableCount?: number;
  outOfServiceCount?: number;
  lastUpdate?: string;
}

interface EVStationData {
  station_name: string;
  provider: string;
  latitude: number;
  longitude: number;
  address: string;
  charger_type?: string;
  connector_types?: string[];
  availability_status?: string;
  maps_link?: string;
  external_id?: string;
  pricing?: string;
  power_output?: string;

  // Enriched dictionary fields.
  connectors?: EVConnectorData[];
  max_power_kw?: number;
  max_kw_by_standard?: Record<string, number>;
  total_chargers?: number;
  total_connectors?: number;
  vehicle_classes?: string[];
  charging_current?: string;
  ownership?: string;
  state?: string;
  district?: string;
  city?: string;
  location_quality?: string;
  mixed_admin?: boolean;
  opening_hours?: string;
  payment_modes?: string[];
  contact_numbers?: string[];
  staff?: string;
  access?: string;
  fee?: boolean;
  station_type?: string;
  available_count?: number;
  out_of_service_count?: number;
  availability_last_update?: string;
  last_rider_report?: string;
  data_as_of?: string;
  source_name?: string;
  source_url?: string;
}

/** Extract the first numeric value from strings such as "22 kW", "50", "3.3". */
function parseKw(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : undefined;
}

/** Normalise the many connector spellings used by OSM / OCPI / Google. */
function normaliseConnector(value: string): string {
  const key = value.toLowerCase().replace(/^ev_connector_type_/, '');
  const aliases: Record<string, string> = {
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

async function fetchTataPowerStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching Tata Power stations from website...');
    
    // Scrape Tata Power EZ Charge station locator
    const response = await fetch('https://ezcharge.tatapowerddl.com/webportal/stationlocator', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      console.log('Tata Power website not accessible, using fallback data');
      return getTataPowerFallbackData();
    }
    
    const html = await response.text();
    const stations: EVStationData[] = [];
    
    // Try to extract station data from the HTML
    // Look for JSON data or station listings
    const jsonMatch = html.match(/var\s+stations\s*=\s*(\[.*?\]);/s) || 
                     html.match(/stations["']?\s*:\s*(\[.*?\])/s) ||
                     html.match(/"stations":\s*(\[.*?\])/s);
    
    if (jsonMatch) {
      try {
        const stationData = JSON.parse(jsonMatch[1]);
        for (const station of stationData) {
          const lat = parseFloat(station.latitude || station.lat || station.Latitude || '0');
          const lng = parseFloat(station.longitude || station.lng || station.Longitude || '0');
          
          if (lat && lng) {
            stations.push({
              station_name: station.name || station.stationName || station.title || 'Tata Power Station',
              provider: 'Tata Power',
              latitude: lat,
              longitude: lng,
              address: station.address || station.location || 'Address not available',
              charger_type: station.chargerType || station.type || 'DC Fast Charger',
              connector_types: station.connectors ? station.connectors.split(',') : ['CCS2', 'Type 2'],
              availability_status: station.status || 'operational',
              external_id: station.id || station.stationId,
              power_output: station.power || station.powerOutput || '30kW',
              pricing: station.pricing || station.tariff || '₹10/kWh',
              maps_link: `https://www.google.com/maps?q=${lat},${lng}`
            });
          }
        }
      } catch (parseError) {
        console.error('Error parsing Tata Power JSON data:', parseError);
      }
    }
    
    // If no stations found from scraping, use fallback data
    if (stations.length === 0) {
      console.log('No stations extracted from Tata Power website, using fallback data');
      return getTataPowerFallbackData();
    }
    
    console.log(`Found ${stations.length} Tata Power stations from website`);
    return stations;
    
  } catch (error) {
    console.error('Error fetching Tata Power stations:', error);
    return getTataPowerFallbackData();
  }
}

function getTataPowerFallbackData(): EVStationData[] {
  return [
    {
      station_name: "Tata Power EZ Charge - Phoenix Marketcity",
      provider: "Tata Power",
      latitude: 19.0874,
      longitude: 72.9114,
      address: "Phoenix Marketcity, Kurla West, Mumbai",
      charger_type: "DC Fast Charger",
      connector_types: ["CCS2", "CHAdeMO"],
      availability_status: "available",
      power_output: "60kW",
      pricing: "₹12/kWh",
      maps_link: "https://www.google.com/maps?q=19.0874,72.9114"
    },
    {
      station_name: "Tata Power EZ Charge - Cyber Towers",
      provider: "Tata Power",
      latitude: 17.4326,
      longitude: 78.3908,
      address: "Cyber Towers, Madhapur, Hyderabad",
      charger_type: "DC Fast Charger",
      connector_types: ["CCS2", "Type 2"],
      availability_status: "available",
      power_output: "30kW",
      pricing: "₹10/kWh",
      maps_link: "https://www.google.com/maps?q=17.4326,78.3908"
    },
    {
      station_name: "Tata Power EZ Charge - Forum Mall",
      provider: "Tata Power",
      latitude: 17.4281,
      longitude: 78.4479,
      address: "Forum Mall, Kukatpally, Hyderabad",
      charger_type: "AC Charger",
      connector_types: ["Type 2", "Bharat AC"],
      availability_status: "available",
      power_output: "22kW",
      pricing: "₹8/kWh",
      maps_link: "https://www.google.com/maps?q=17.4281,78.4479"
    },
    {
      station_name: "Tata Power EZ Charge - DLF IT Park",
      provider: "Tata Power",
      latitude: 12.9698,
      longitude: 77.7500,
      address: "DLF IT Park, Whitefield, Bangalore",
      charger_type: "DC Fast Charger",
      connector_types: ["CCS2", "CHAdeMO"],
      availability_status: "available",
      power_output: "50kW",
      pricing: "₹11/kWh",
      maps_link: "https://www.google.com/maps?q=12.9698,77.7500"
    }
  ];
}

async function fetchAtherGridStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching Ather Grid stations...');
    
    // Sample Ather Grid stations - replace with actual API integration
    return [
      {
        station_name: "Ather Grid - Koramangala",
        provider: "Ather Energy",
        latitude: 12.9279,
        longitude: 77.6271,
        address: "Koramangala, Bangalore",
        charger_type: "DC Fast Charger",
        connector_types: ["CCS2"],
        availability_status: "available",
        power_output: "30kW",
        pricing: "₹10/kWh"
      }
    ];
  } catch (error) {
    console.error('Error fetching Ather Grid stations:', error);
    return [];
  }
}

async function fetchNITIAayogData(): Promise<EVStationData[]> {
  try {
    console.log('Fetching NITI Aayog E-Amrit data...');
    
    // NITI Aayog E-Amrit Dataset integration
    const response = await fetch('https://e-amrit.niti.gov.in/assets/data/charging_stations.json');
    if (!response.ok) {
      throw new Error(`NITI Aayog API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Transform NITI data to our schema
    return data.map((station: any) => ({
      station_name: station.name || station.station_name,
      provider: station.operator || "Government",
      latitude: parseFloat(station.latitude || station.lat),
      longitude: parseFloat(station.longitude || station.lng),
      address: station.address || station.location,
      charger_type: station.charger_type,
      connector_types: station.connector_types ? station.connector_types.split(',') : [],
      availability_status: station.status || 'unknown',
      external_id: station.id,
      power_output: station.power_kw ? `${station.power_kw}kW` : undefined
    }));
  } catch (error) {
    console.error('Error fetching NITI Aayog data:', error);
    return [];
  }
}

async function fetchOpenChargeMapStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching OpenChargeMap stations for India...');
    
    // Fetch stations from India (country code 100) with a reasonable limit
    const response = await fetch('https://api.openchargemap.io/v3/poi/?output=json&countrycode=IN&maxresults=500&compact=true&verbose=false');
    
    if (!response.ok) {
      throw new Error(`OpenChargeMap API error: ${response.status}`);
    }
    
    const stations = await response.json();
    console.log(`Fetched ${stations.length} stations from OpenChargeMap`);
    
    // Transform OpenChargeMap data to our schema
    return stations.map((station: any) => {
      const connections = station.Connections || [];
      const connectorTypes = connections.map((conn: any) => 
        conn.ConnectionType?.Title || 'Unknown'
      ).filter((type: string) => type !== 'Unknown');
      
      return {
        station_name: station.AddressInfo?.Title || 'Unknown Station',
        provider: station.OperatorInfo?.Title || 'OpenChargeMap',
        latitude: parseFloat(station.AddressInfo?.Latitude || '0'),
        longitude: parseFloat(station.AddressInfo?.Longitude || '0'),
        address: [
          station.AddressInfo?.AddressLine1,
          station.AddressInfo?.Town,
          station.AddressInfo?.StateOrProvince,
          station.AddressInfo?.Postcode
        ].filter(Boolean).join(', '),
        charger_type: connections[0]?.Level?.Title || 'Unknown',
        connector_types: connectorTypes.length > 0 ? connectorTypes : ['Unknown'],
        availability_status: station.StatusType?.IsOperational ? 'operational' : 'unknown',
        external_id: station.ID?.toString(),
        power_output: connections[0]?.PowerKW ? `${connections[0].PowerKW}kW` : undefined,
        maps_link: `https://www.google.com/maps?q=${station.AddressInfo?.Latitude},${station.AddressInfo?.Longitude}`
      };
    }).filter((station: EVStationData) => 
      station.latitude && station.longitude && 
      station.latitude !== 0 && station.longitude !== 0
    );
    
  } catch (error) {
    console.error('Error fetching OpenChargeMap stations:', error);
    return [];
  }
}

async function fetchJioBPPulseStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching Jio-bp Pulse stations...');
    
    // Try to fetch from Jio-bp locator page
    const response = await fetch('https://www.jio-bp.com/station-locator');
    if (!response.ok) {
      throw new Error(`Jio-bp API error: ${response.status}`);
    }
    
    // For now, return sample data as the actual implementation would need HTML parsing
    return [
      {
        station_name: 'Jio-bp Pulse Gachibowli',
        provider: 'Jio-bp Pulse',
        latitude: 17.4239,
        longitude: 78.3776,
        address: 'Gachibowli, Hyderabad, Telangana',
        charger_type: 'DC Fast Charging',
        connector_types: ['CCS2', 'CHAdeMO'],
        availability_status: 'operational',
        external_id: 'jio_bp_gachibowli',
        power_output: '60kW',
        maps_link: 'https://www.google.com/maps?q=17.4239,78.3776'
      },
      {
        station_name: 'Jio-bp Pulse Hitec City',
        provider: 'Jio-bp Pulse',
        latitude: 17.4435,
        longitude: 78.3772,
        address: 'Hitec City, Hyderabad, Telangana',
        charger_type: 'DC Fast Charging',
        connector_types: ['CCS2', 'Type 2'],
        availability_status: 'operational',
        external_id: 'jio_bp_hitec',
        power_output: '30kW',
        maps_link: 'https://www.google.com/maps?q=17.4435,78.3772'
      }
    ];
  } catch (error) {
    console.error('Error fetching Jio-bp Pulse stations:', error);
    return [];
  }
}

async function fetchPlugShareStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching PlugShare stations for India...');
    
    // PlugShare API would require authentication - using sample data for now
    return [
      {
        station_name: 'PlugShare Banjara Hills',
        provider: 'PlugShare Network',
        latitude: 17.4126,
        longitude: 78.4486,
        address: 'Banjara Hills, Hyderabad, Telangana',
        charger_type: 'Level 2',
        connector_types: ['Type 2', 'CCS2'],
        availability_status: 'operational',
        external_id: 'plugshare_banjara',
        power_output: '22kW',
        maps_link: 'https://www.google.com/maps?q=17.4126,78.4486'
      },
      {
        station_name: 'PlugShare Jubilee Hills',
        provider: 'PlugShare Network',
        latitude: 17.4239,
        longitude: 78.4238,
        address: 'Jubilee Hills, Hyderabad, Telangana',
        charger_type: 'DC Fast Charging',
        connector_types: ['CCS2', 'CHAdeMO'],
        availability_status: 'operational',
        external_id: 'plugshare_jubilee',
        power_output: '50kW',
        maps_link: 'https://www.google.com/maps?q=17.4239,78.4238'
      }
    ];
  } catch (error) {
    console.error('Error fetching PlugShare stations:', error);
    return [];
  }
}

async function fetchChargeZoneStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching ChargeZone stations...');
    
    return [
      {
        station_name: 'ChargeZone Kondapur',
        provider: 'ChargeZone',
        latitude: 17.4516,
        longitude: 78.3648,
        address: 'Kondapur, Hyderabad, Telangana',
        charger_type: 'DC Fast Charging',
        connector_types: ['CCS2', 'Type 2'],
        availability_status: 'operational',
        external_id: 'cz_kondapur',
        power_output: '25kW',
        maps_link: 'https://www.google.com/maps?q=17.4516,78.3648'
      },
      {
        station_name: 'ChargeZone Secunderabad',
        provider: 'ChargeZone',
        latitude: 17.4399,
        longitude: 78.4983,
        address: 'Secunderabad, Telangana',
        charger_type: 'Level 2',
        connector_types: ['Type 2', 'Bharat AC'],
        availability_status: 'operational',
        external_id: 'cz_secunderabad',
        power_output: '7.4kW',
        maps_link: 'https://www.google.com/maps?q=17.4399,78.4983'
      }
    ];
  } catch (error) {
    console.error('Error fetching ChargeZone stations:', error);
    return [];
  }
}

async function fetchABBIndiaStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching ABB India stations...');
    
    return [
      {
        station_name: 'ABB Terra AC Madhapur',
        provider: 'ABB India',
        latitude: 17.4475,
        longitude: 78.3915,
        address: 'Madhapur, Hyderabad, Telangana',
        charger_type: 'AC Charging',
        connector_types: ['Type 2', 'Bharat AC'],
        availability_status: 'operational',
        external_id: 'abb_madhapur',
        power_output: '22kW',
        maps_link: 'https://www.google.com/maps?q=17.4475,78.3915'
      },
      {
        station_name: 'ABB Terra DC Miyapur',
        provider: 'ABB India',
        latitude: 17.4969,
        longitude: 78.3267,
        address: 'Miyapur, Hyderabad, Telangana',
        charger_type: 'DC Fast Charging',
        connector_types: ['CCS2', 'CHAdeMO'],
        availability_status: 'operational',
        external_id: 'abb_miyapur',
        power_output: '50kW',
        maps_link: 'https://www.google.com/maps?q=17.4969,78.3267'
      }
    ];
  } catch (error) {
    console.error('Error fetching ABB India stations:', error);
    return [];
  }
}

async function fetchBrightBluStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching BrightBlu stations...');
    
    return [
      {
        station_name: 'BrightBlu Kukatpally',
        provider: 'BrightBlu',
        latitude: 17.4840,
        longitude: 78.4071,
        address: 'Kukatpally, Hyderabad, Telangana',
        charger_type: 'DC Fast Charging',
        connector_types: ['CCS2', 'Type 2'],
        availability_status: 'operational',
        external_id: 'bb_kukatpally',
        power_output: '30kW',
        maps_link: 'https://www.google.com/maps?q=17.4840,78.4071'
      },
      {
        station_name: 'BrightBlu Uppal',
        provider: 'BrightBlu',
        latitude: 17.4064,
        longitude: 78.5569,
        address: 'Uppal, Hyderabad, Telangana',
        charger_type: 'Level 2',
        connector_types: ['Type 2', 'Bharat AC'],
        availability_status: 'operational',
        external_id: 'bb_uppal',
        power_output: '11kW',
        maps_link: 'https://www.google.com/maps?q=17.4064,78.5569'
      }
    ];
  } catch (error) {
    console.error('Error fetching BrightBlu stations:', error);
    return [];
  }
}

async function fetchBEEIndiaStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching BEE India EV stations from evyatra.beeindia.gov.in...');
    
    const response = await fetch('https://evyatra.beeindia.gov.in/public-charging-stations/');
    if (!response.ok) {
      throw new Error(`BEE India website error: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Parse HTML to extract table data
    // Using basic string parsing since we don't have BeautifulSoup in Deno
    const stations: EVStationData[] = [];
    
    // Look for table structure in the HTML
    const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
    if (!tableMatch) {
      console.log('No table found in BEE India page');
      return [];
    }
    
    const tableHtml = tableMatch[0];
    
    // Extract headers
    const headerMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
    let headers: string[] = [];
    if (headerMatch) {
      const headerCells = headerMatch[0].match(/<th[^>]*>([\s\S]*?)<\/th>/gi);
      if (headerCells) {
        headers = headerCells.map(cell => 
          cell.replace(/<[^>]*>/g, '').trim().toLowerCase()
        );
      }
    }
    
    // Extract rows
    const tbodyMatch = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i);
    if (tbodyMatch) {
      const rows = tbodyMatch[0].match(/<tr[\s\S]*?<\/tr>/gi);
      if (rows) {
        for (const row of rows) {
          const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
          if (cells && cells.length >= 4) {
            const rowData: {[key: string]: string} = {};
            cells.forEach((cell, index) => {
              if (headers[index]) {
                rowData[headers[index]] = cell.replace(/<[^>]*>/g, '').trim();
              }
            });
            
            // Map common field names to our schema
            const lat = parseFloat(rowData.latitude || rowData.lat || '0');
            const lng = parseFloat(rowData.longitude || rowData.lng || rowData.long || '0');
            
            if (lat && lng) {
              stations.push({
                station_name: rowData.name || rowData.station_name || rowData['station name'] || 'Unknown Station',
                provider: rowData.operator || rowData.provider || 'BEE India',
                latitude: lat,
                longitude: lng,
                address: rowData.address || rowData.location || 'Address not available',
                charger_type: rowData.charger_type || rowData['charger type'],
                connector_types: rowData.connector_types ? rowData.connector_types.split(',').map(c => c.trim()) : [],
                availability_status: rowData.status || 'unknown',
                external_id: rowData.id || rowData['station id'],
                power_output: rowData.power || rowData.power_output,
                pricing: rowData.pricing || rowData.tariff
              });
            }
          }
        }
      }
    }
    
    console.log(`Found ${stations.length} stations from BEE India`);
    return stations;
    
  } catch (error) {
    console.error('Error fetching BEE India stations:', error);
    return [];
  }
}

async function fetchStatiqStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching Statiq stations...');
    
    // Sample Statiq stations - replace with actual scraping/API
    return [
      {
        station_name: "Statiq - DLF Cybercity",
        provider: "Statiq",
        latitude: 28.4945,
        longitude: 77.0863,
        address: "DLF Cybercity, Gurugram",
        charger_type: "AC Charger",
        connector_types: ["Type 2"],
        availability_status: "available",
        power_output: "22kW",
        pricing: "₹8/kWh"
      }
    ];
  } catch (error) {
    console.error('Error fetching Statiq stations:', error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// New sources
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any -- external API payloads are untyped JSON */

const BEE_API_BASE = 'https://ev-charging-stations-api.vercel.app';

function mapBEEStation(row: any, source: any): EVStationData {
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  const chargers = Array.isArray(row.chargers) ? row.chargers : [];
  const standards: string[] = Array.isArray(row.standards) ? row.standards : [];
  const currents: string[] = Array.isArray(row.currents) ? row.currents : [];

  return {
    station_name: row.address || `${row.city || row.district || 'BEE'} EV Charging Station`,
    provider: row.operator || 'Unknown Provider',
    latitude: lat,
    longitude: lng,
    address: [row.address, row.city, row.district, row.state].filter(Boolean).join(', '),
    charger_type: chargers[0]?.type_raw,
    connector_types: standards.map(normaliseConnector),
    // BEE does not publish live availability.
    availability_status: 'unknown',
    external_id: `bee_${row.id}`,
    maps_link: `https://www.google.com/maps?q=${lat},${lng}`,
    power_output: row.max_power_kw ? `${row.max_power_kw}kW` : undefined,
    connectors: chargers.flatMap((charger: any) =>
      (Array.isArray(charger.guns) ? charger.guns : []).map((gun: any) => ({
        standard: normaliseConnector(gun.standard ?? ''),
        kw: parseKw(gun.kw),
        chargerKw: parseKw(charger.charger_kw),
        count: charger.count,
      }))
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
    data_as_of: source?.snapshot_label ?? 'till 26th October 2025',
    source_name: source?.name ?? 'BEE EV Public Charging Stations Data',
    source_url: source?.url,
  };
}

/**
 * BEE / Ministry of Power data republished as a keyless, CORS-enabled API.
 * One page per state keeps us well inside the 100 req / 15 min rate limit while
 * spreading coverage across all states and UTs.
 */
async function fetchBEEApiStations(pagesPerState: number = 1): Promise<EVStationData[]> {
  try {
    console.log(`Fetching BEE stations from ${BEE_API_BASE}...`);

    const statesResponse = await fetch(`${BEE_API_BASE}/v1/states`);
    if (!statesResponse.ok) {
      throw new Error(`BEE states API error: ${statesResponse.status}`);
    }
    const statesPayload = await statesResponse.json();
    const states: any[] = Array.isArray(statesPayload.data) ? statesPayload.data : [];
    const stateFilters = states
      .map(state => state.state_code || state.state)
      .filter(Boolean)
      .slice(0, 40);
    const targets: Array<{ state?: string }> = stateFilters.length
      ? stateFilters.map(state => ({ state }))
      : [{}];

    const stations: EVStationData[] = [];

    for (const target of targets) {
      for (let page = 1; page <= pagesPerState; page++) {
        const params = new URLSearchParams({
          limit: '100',
          page: String(page),
          ...(target.state ? { state: target.state } : {}),
        });

        const response = await fetch(`${BEE_API_BASE}/v1/stations?${params}`);
        if (response.status === 429) {
          console.warn('BEE API rate limited - stopping this sync pass');
          return stations;
        }
        if (!response.ok) {
          throw new Error(`BEE stations API error: ${response.status}`);
        }

        const payload = await response.json();
        const rows: any[] = Array.isArray(payload.data) ? payload.data : [];
        for (const row of rows) {
          stations.push(mapBEEStation(row, payload.meta?.source));
        }
        if (rows.length < 100) break;
      }
    }

    console.log(`Found ${stations.length} BEE stations`);
    return stations;
  } catch (error) {
    console.error('Error fetching BEE API stations:', error);
    return [];
  }
}

/** OpenEV - Delhi Transport: live per-connector availability and tariffs. */
async function fetchOpenEVDelhiStations(): Promise<EVStationData[]> {
  const apiKey = process.env.OPEN_EV_API_KEY;
  if (!apiKey) {
    console.log('OPEN_EV_API_KEY not set - skipping OpenEV Delhi');
    return [];
  }

  try {
    console.log('Fetching OpenEV Delhi stations...');
    const response = await fetch(
      `https://openev.delhitransport.in/api/get-ev/?key=${encodeURIComponent(apiKey)}`
    );
    if (!response.ok) {
      throw new Error(`OpenEV API error: ${response.status}`);
    }

    const payload = await response.json();
    const groups: any[] = Array.isArray(payload) ? payload : [payload];
    const stations: EVStationData[] = [];

    for (const group of groups) {
      for (const station of Array.isArray(group.data) ? group.data : []) {
        const lat = Number(station.coordinates?.latitude ?? station.latitude);
        const lng = Number(station.coordinates?.longitude ?? station.longitude);
        if (!lat || !lng) continue;

        const chargers: any[] = Array.isArray(station.charger_type) ? station.charger_type : [];
        const priced = chargers.find(ch => ch.cost_per_unit && ch.cost_per_unit !== 'NA');
        const availableCount = Number(station.available) || 0;
        const totalConnectors = Number(station.total) || undefined;

        stations.push({
          station_name: station.name || 'OpenEV Delhi Station',
          provider: station.vendor || 'Delhi Transport',
          latitude: lat,
          longitude: lng,
          address: [station.address, station.city, station.postal_code].filter(Boolean).join(', '),
          charger_type: chargers[0]?.type,
          connector_types: chargers.map(ch => normaliseConnector(ch.type)).filter(Boolean),
          availability_status: availableCount > 0
            ? 'available'
            : (totalConnectors && totalConnectors > 0 ? 'unavailable' : 'unknown'),
          external_id: `openev_${station.id}`,
          maps_link: `https://www.google.com/maps?q=${lat},${lng}`,
          power_output: chargers[0]?.capacity,
          pricing: priced?.cost_per_unit ??
            (station.cost_per_unit && station.cost_per_unit !== 'NA' ? station.cost_per_unit : undefined),
          connectors: chargers.map(ch => ({
            standard: normaliseConnector(ch.type ?? ''),
            kw: parseKw(ch.capacity),
            count: Number(ch.total) || undefined,
            availableCount: Number(ch.available) || 0,
          })),
          available_count: availableCount,
          total_connectors: totalConnectors,
          opening_hours: [station.open, station.close].filter(Boolean).join(' - ') || undefined,
          payment_modes: typeof station.payment_modes === 'string'
            ? station.payment_modes.split(',').map((mode: string) => mode.trim()).filter(Boolean)
            : station.payment_modes,
          contact_numbers: station.contact_numbers,
          staff: station.staff,
          state: 'Delhi',
          city: station.city,
          station_type: station.station_type === 'battery_swapping' ? 'battery_swapping' : 'charging',
          source_name: 'OpenEV - Delhi Transport',
          source_url: 'https://openev.delhitransport.in/',
          data_as_of: group.timestamp ?? new Date().toISOString(),
          availability_last_update: group.timestamp ?? new Date().toISOString(),
        });
      }
    }

    console.log(`Found ${stations.length} OpenEV Delhi stations`);
    return stations;
  } catch (error) {
    console.error('Error fetching OpenEV Delhi stations:', error);
    return [];
  }
}

/** OpenStreetMap charging stations via Overpass, including socket:* detail. */
async function fetchOSMStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching OpenStreetMap charging stations...');
    const endpoint = process.env.OVERPASS_API_URL ?? 'https://overpass-api.de/api/interpreter';
    // India bounding box; hard cap keeps the shared Overpass instance happy.
    const query = `[out:json][timeout:50];nwr["amenity"="charging_station"](6.7,68.1,35.6,97.3);out center 1500;`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }).toString(),
    });
    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`);
    }

    const payload = await response.json();
    const elements: any[] = Array.isArray(payload.elements) ? payload.elements : [];
    const stations: EVStationData[] = [];

    for (const element of elements) {
      const lat = element.lat ?? element.center?.lat;
      const lng = element.lon ?? element.center?.lon ?? element.center?.longitude;
      if (!lat || !lng) continue;

      const tags = element.tags ?? {};
      const socketKeys = Object.keys(tags).filter(key =>
        key.startsWith('socket:') &&
        !key.endsWith(':output') &&
        !key.endsWith(':current') &&
        !key.endsWith(':voltage')
      );
      const connectors: EVConnectorData[] = socketKeys.map(key => ({
        standard: normaliseConnector(key.replace('socket:', '')),
        kw: parseKw(tags[`${key}:output`]),
        count: Number(tags[key]) || undefined,
      }));
      const outputs = connectors.map(c => c.kw).filter((kw): kw is number => kw !== undefined);
      const maxPowerKw = outputs.length ? Math.max(...outputs) : undefined;

      stations.push({
        station_name: tags.name || `${tags.operator || 'OSM'} Charging Station`,
        provider: tags.operator || tags.brand || 'OpenStreetMap',
        latitude: Number(lat),
        longitude: Number(lng),
        address: [tags['addr:street'], tags['addr:city'], tags['addr:state']]
          .filter(Boolean).join(', ') || 'Address not available',
        charger_type: tags.frequency === '0' ? 'DC Fast Charger' : undefined,
        connector_types: connectors.map(c => c.standard),
        availability_status: 'unknown',
        external_id: `osm_${element.type}_${element.id}`,
        maps_link: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        power_output: maxPowerKw ? `${maxPowerKw}kW` : undefined,
        connectors,
        max_power_kw: maxPowerKw,
        max_kw_by_standard: Object.fromEntries(
          connectors.filter(c => c.kw !== undefined).map(c => [c.standard, c.kw as number])
        ),
        total_connectors: Number(tags.capacity) || undefined,
        charging_current: tags.frequency === '0' ? 'DC' : undefined,
        city: tags['addr:city'],
        state: tags['addr:state'],
        opening_hours: tags.opening_hours,
        access: tags.access,
        fee: tags.fee === 'yes' ? true : (tags.fee === 'no' ? false : undefined),
        station_type: tags['charging_station:battery_swapping'] === 'only'
          ? 'battery_swapping'
          : 'charging',
        source_name: 'OpenStreetMap',
        source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      });
    }

    console.log(`Found ${stations.length} OpenStreetMap stations`);
    return stations;
  } catch (error) {
    console.error('Error fetching OpenStreetMap stations:', error);
    return [];
  }
}

/** Google Places API (New) evChargeOptions - connector-level live availability. */
async function fetchGooglePlacesStations(): Promise<EVStationData[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.log('GOOGLE_MAPS_API_KEY not set - skipping Google Places');
    return [];
  }

  const centres = [
    { lat: 28.6139, lng: 77.2090 }, // Delhi
    { lat: 19.0760, lng: 72.8777 }, // Mumbai
    { lat: 12.9716, lng: 77.5946 }, // Bengaluru
    { lat: 17.3850, lng: 78.4867 }, // Hyderabad
  ];
  const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.evChargeOptions';
  const stations: EVStationData[] = [];

  try {
    for (const centre of centres) {
      const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify({
          includedTypes: ['ev_charging_station'],
          maxResultCount: 20,
          locationRestriction: {
            circle: {
              center: { latitude: centre.lat, longitude: centre.lng },
              radius: 15000,
            },
          },
        }),
      });

      if (!response.ok) {
        console.warn(`Google Places error for ${centre.lat},${centre.lng}: ${response.status}`);
        continue;
      }

      const payload = await response.json();
      for (const place of Array.isArray(payload.places) ? payload.places : []) {
        const lat = Number(place.location?.latitude);
        const lng = Number(place.location?.longitude);
        if (!lat || !lng) continue;

        const aggregations: any[] = place.evChargeOptions?.connectorAggregation ?? [];
        const connectors: EVConnectorData[] = aggregations.map(agg => ({
          standard: normaliseConnector(String(agg.type ?? '')),
          kw: parseKw(agg.maxChargeRateKw),
          count: agg.count,
          availableCount: agg.availableCount,
          outOfServiceCount: agg.outOfServiceCount,
          lastUpdate: agg.availabilityLastUpdateTime,
        }));
        const outputs = connectors.map(c => c.kw).filter((kw): kw is number => kw !== undefined);
        const available = connectors.reduce((sum, c) => sum + (c.availableCount ?? 0), 0);
        const outOfService = connectors.reduce((sum, c) => sum + (c.outOfServiceCount ?? 0), 0);

        stations.push({
          station_name: place.displayName?.text || 'Google EV Charging Station',
          provider: 'Google Places',
          latitude: lat,
          longitude: lng,
          address: place.formattedAddress || 'Address not available',
          connector_types: connectors.map(c => c.standard),
          availability_status: outOfService > 0 && available === 0
            ? 'out-of-service'
            : (outOfService > 0 ? 'maintenance' : 'operational'),
          external_id: `google_${place.id}`,
          maps_link: `https://www.google.com/maps/place/?q=place_id:${place.id}`,
          power_output: outputs.length ? `${Math.max(...outputs)}kW` : undefined,
          connectors,
          max_power_kw: outputs.length ? Math.max(...outputs) : undefined,
          total_connectors: place.evChargeOptions?.connectorCount,
          available_count: available,
          out_of_service_count: outOfService,
          availability_last_update: aggregations
            .map(agg => agg.availabilityLastUpdateTime)
            .filter(Boolean)
            .sort()
            .pop(),
          source_name: 'Google Places API (New)',
          source_url: 'https://developers.google.com/maps/documentation/places/web-service',
        });
      }
    }

    console.log(`Found ${stations.length} Google Places stations`);
    return stations;
  } catch (error) {
    console.error('Error fetching Google Places stations:', error);
    return stations;
  }
}

/** Generic OCPI 2.2.1 locations adapter (IONAGE, ChargeID, EVnnovator, etc.). */
async function fetchOCPIStations(): Promise<EVStationData[]> {
  const baseUrl = process.env.OCPI_LOCATIONS_URL;
  const token = process.env.OCPI_TOKEN;
  if (!baseUrl || !token) {
    console.log('OCPI_LOCATIONS_URL/OCPI_TOKEN not set - skipping OCPI');
    return [];
  }

  try {
    console.log('Fetching OCPI locations...');
    const response = await fetch(baseUrl, {
      headers: {
        Authorization: `Token ${token}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`OCPI API error: ${response.status}`);
    }

    const payload = await response.json();
    const locations: any[] = Array.isArray(payload.data) ? payload.data : [];
    const stations: EVStationData[] = [];

    for (const location of locations) {
      const lat = Number(location.coordinates?.latitude);
      const lng = Number(location.coordinates?.longitude);
      if (!lat || !lng) continue;

      const evses: any[] = Array.isArray(location.evses) ? location.evses : [];
      const connectors: EVConnectorData[] = [];
      let status = 'unknown';

      for (const evse of evses) {
        const evseStatus = String(evse.status ?? '').toUpperCase();
        if (['AVAILABLE', 'BLOCKED', 'CHARGING'].includes(evseStatus)) status = 'available';
        else if (['OUTOFORDER', 'INOPERATIVE', 'REMOVED'].includes(evseStatus)) status = 'out-of-service';
        else if (['PLANNED', 'SUSPENDED'].includes(evseStatus) && status === 'unknown') status = 'maintenance';

        for (const connector of Array.isArray(evse.connectors) ? evse.connectors : []) {
          connectors.push({
            standard: normaliseConnector(String(connector.standard ?? '')),
            kw: connector.max_electric_power
              ? Number(connector.max_electric_power) / 1000
              : parseKw(connector.power),
            lastUpdate: evse.last_updated,
          });
        }
      }

      stations.push({
        station_name: location.name || `${location.operator?.name || 'OCPI'} Charging Station`,
        provider: location.operator?.name || 'OCPI',
        latitude: lat,
        longitude: lng,
        address: [location.address?.street, location.address?.city, location.address?.country]
          .filter(Boolean).join(', '),
        connector_types: connectors.map(c => c.standard),
        availability_status: status,
        external_id: `ocpi_${location.id}`,
        maps_link: `https://www.google.com/maps?q=${lat},${lng}`,
        connectors,
        total_connectors: connectors.length,
        available_count: connectors.filter(c => c.availableCount).length,
        out_of_service_count: evses.filter(evse =>
          ['OUTOFORDER', 'INOPERATIVE', 'REMOVED'].includes(String(evse.status ?? '').toUpperCase())
        ).length,
        availability_last_update: evses
          .map(evse => evse.last_updated)
          .filter(Boolean)
          .sort()
          .pop(),
        opening_hours: location.opening_times?.regular_hours
          ? JSON.stringify(location.opening_times.regular_hours)
          : undefined,
        source_name: 'OCPI locations feed',
        source_url: baseUrl,
      });
    }

    console.log(`Found ${stations.length} OCPI stations`);
    return stations;
  } catch (error) {
    console.error('Error fetching OCPI stations:', error);
    return [];
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

type SyncMode = 'full' | 'catalog' | 'availability';

/**
 * Refresh only the live fields of stations that already exist. Upserting these
 * records would create shallow duplicates and would wipe the catalog fields
 * (connectors, vehicle classes, provenance, ...) from the dictionary.
 */
async function refreshAvailability(
  // The inferred Supabase client generics don't survive extraction into a helper.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  liveStations: EVStationData[]
): Promise<{ updated: number; skipped: number }> {
  const ids = [...new Set(
    liveStations.map(station => station.external_id).filter((id): id is string => Boolean(id))
  )];
  if (ids.length === 0) return { updated: 0, skipped: liveStations.length };

  const { data: existing, error } = await supabase
    .from('ev_charging_stations')
    .select('external_id')
    .in('external_id', ids);

  if (error) throw error;

  const existingIds = new Set((existing ?? []).map((row: { external_id: string }) => row.external_id));
  const matching = liveStations.filter(
    station => station.external_id && existingIds.has(station.external_id)
  );

  const chunkSize = 20;
  for (let i = 0; i < matching.length; i += chunkSize) {
    const chunk = matching.slice(i, i + chunkSize);
    const results = await Promise.all(chunk.map(station =>
      supabase
        .from('ev_charging_stations')
        .update({
          availability_status: station.availability_status,
          available_count: station.available_count,
          out_of_service_count: station.out_of_service_count,
          availability_last_update: station.availability_last_update,
          last_rider_report: station.last_rider_report,
        })
        .eq('external_id', station.external_id!)
    ));
    const failure = results.find(result => result.error);
    if (failure?.error) throw failure.error;
  }

  return { updated: matching.length, skipped: liveStations.length - matching.length };
}

export default async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Optional shared-secret protection for scheduled callers (GitHub Actions).
  const syncSecret = process.env.SYNC_SECRET;
  if (syncSecret && req.headers.get('authorization') !== `Bearer ${syncSecret}`) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const requestedMode = String(body.mode ?? url.searchParams.get('mode') ?? 'full') as SyncMode;
    const mode: SyncMode = ['full', 'catalog', 'availability'].includes(requestedMode)
      ? requestedMode
      : 'full';
    // Control how many pages of 100 BEE stations are pulled per state.
    const pagesPerState = Math.min(Math.max(Number(body.maxPagesPerState ?? url.searchParams.get('maxPagesPerState')) || 1, 1), 10);

    const includeCatalog = mode === 'full' || mode === 'catalog';
    const includeAvailability = mode === 'full' || mode === 'availability';

    console.log(`Starting EV stations sync (mode: ${mode})...`);

    type FetchSpec = {
      name: string;
      kind: 'catalog' | 'availability';
      run: () => Promise<EVStationData[]>;
    };
    const fetches: FetchSpec[] = [];

    if (includeCatalog) {
      fetches.push(
        { name: 'Tata Power', kind: 'catalog', run: fetchTataPowerStations },
        { name: 'Ather Grid', kind: 'catalog', run: fetchAtherGridStations },
        { name: 'NITI Aayog', kind: 'catalog', run: fetchNITIAayogData },
        { name: 'OpenChargeMap', kind: 'catalog', run: fetchOpenChargeMapStations },
        { name: 'Jio-bp Pulse', kind: 'catalog', run: fetchJioBPPulseStations },
        { name: 'PlugShare', kind: 'catalog', run: fetchPlugShareStations },
        { name: 'ChargeZone', kind: 'catalog', run: fetchChargeZoneStations },
        { name: 'ABB India', kind: 'catalog', run: fetchABBIndiaStations },
        { name: 'BrightBlu', kind: 'catalog', run: fetchBrightBluStations },
        { name: 'BEE India', kind: 'catalog', run: fetchBEEIndiaStations },
        { name: 'Statiq', kind: 'catalog', run: fetchStatiqStations },
        { name: 'BEE API', kind: 'catalog', run: () => fetchBEEApiStations(pagesPerState) },
        { name: 'OpenStreetMap', kind: 'catalog', run: fetchOSMStations }
      );
    }

    if (includeAvailability) {
      fetches.push(
        { name: 'OpenEV Delhi', kind: 'availability', run: fetchOpenEVDelhiStations },
        { name: 'Google Places', kind: 'availability', run: fetchGooglePlacesStations },
        { name: 'OCPI', kind: 'availability', run: fetchOCPIStations }
      );
    }

    const results = await Promise.all(
      fetches.map(async fetchSpec => ({
        name: fetchSpec.name,
        kind: fetchSpec.kind,
        stations: await fetchSpec.run()
      }))
    );

    const sources: Record<string, number> = {};
    for (const result of results) sources[result.name] = result.stations.length;

    const catalogStations = results
      .filter(result => result.kind === 'catalog')
      .flatMap(result => result.stations);
    const liveStations = results
      .filter(result => result.kind === 'availability')
      .flatMap(result => result.stations);

    console.log(
      `Collected ${catalogStations.length} catalog and ${liveStations.length} live stations`
    );

    if (catalogStations.length === 0 && liveStations.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          mode,
          message: 'No stations fetched from any source'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert/update catalog stations in batches to stay within request size limits.
    const batchSize = 500;
    let synced = 0;
    for (let i = 0; i < catalogStations.length; i += batchSize) {
      const batch = catalogStations.slice(i, i + batchSize);
      const { error } = await supabase
        .from('ev_charging_stations')
        .upsert(batch, {
          onConflict: 'provider,station_name,latitude,longitude',
          ignoreDuplicates: false
        });

      if (error) {
        console.error('Database error:', error);
        return new Response(
          JSON.stringify({
            success: false,
            mode,
            synced,
            error: error.message
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
      synced += batch.length;
    }

    const availability = await refreshAvailability(supabase, liveStations);

    console.log(
      `Synced ${synced} catalog stations; refreshed ${availability.updated} live stations`
    );

    return new Response(
      JSON.stringify({
        success: true,
        mode,
        synced,
        availability,
        sources
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}