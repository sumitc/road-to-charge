import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Route, RoutePoint } from '@/services/routeService';
import { ChargingStation } from '@/types/station';
import { connectorBadgeLabel } from '@/lib/connectorLabels';

// Fix for default markers in Leaflet with Webpack
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface TripMapProps {
  route: Route;
  stations: ChargingStation[];
  routePoints: RoutePoint[];
}

const TripMap: React.FC<TripMapProps> = ({ route, stations, routePoints }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || !route) return;

    // Initialize map
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
    }

    const map = L.map(mapRef.current).setView([route.coordinates[0][1], route.coordinates[0][0]], 10);
    mapInstanceRef.current = map;

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Create custom icons
    const startIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background-color: #22c55e; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">A</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const endIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background-color: #dc2626; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">B</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const waypointIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background-color: #3b82f6; color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 10px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">•</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const chargingIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background-color: #f59e0b; color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">⚡</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    // Add route line
    const routeLatLngs = route.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
    L.polyline(routeLatLngs, {
      color: '#3b82f6',
      weight: 4,
      opacity: 0.8
    }).addTo(map);

    // Add route points markers
    if (routePoints.length > 0) {
      // Start point
      L.marker([routePoints[0].lat, routePoints[0].lng], { icon: startIcon })
        .addTo(map)
        .bindPopup(`<strong>Start:</strong> ${routePoints[0].address || 'Starting point'}`);

      // Waypoints
      if (routePoints.length > 2) {
        routePoints.slice(1, -1).forEach((point, index) => {
          L.marker([point.lat, point.lng], { icon: waypointIcon })
            .addTo(map)
            .bindPopup(`<strong>Waypoint ${index + 1}:</strong> ${point.address || 'Waypoint'}`);
        });
      }

      // End point
      if (routePoints.length > 1) {
        const endPoint = routePoints[routePoints.length - 1];
        L.marker([endPoint.lat, endPoint.lng], { icon: endIcon })
          .addTo(map)
          .bindPopup(`<strong>Destination:</strong> ${endPoint.address || 'Destination'}`);
      }
    }

    // Add charging station markers
    stations.forEach((station) => {
      const marker = L.marker([station.lat, station.lng], { icon: chargingIcon })
        .addTo(map);

      const popupContent = `
        <div class="p-2">
          <h3 class="font-semibold text-sm mb-1">${station.name}</h3>
          <p class="text-xs text-gray-600 mb-2">${station.address}</p>
          <div class="space-y-1">
            ${station.powerOutput ? `<div class="text-xs"><strong>Power:</strong> ${station.powerOutput}</div>` : ''}
            ${station.connectorTypes?.length ? `<div class="text-xs"><strong>Connectors:</strong> ${station.connectorTypes.map(connectorBadgeLabel).join(', ')}</div>` : ''}
            ${station.pricing ? `<div class="text-xs"><strong>Pricing:</strong> ${station.pricing}</div>` : ''}
            <div class="text-xs"><strong>Status:</strong> 
              <span class="inline-block w-2 h-2 rounded-full ml-1 ${
                station.status === 'operational' ? 'bg-green-500' : 
                station.status === 'maintenance' ? 'bg-yellow-500' : 'bg-red-500'
              }"></span>
              ${station.status}
            </div>
          </div>
        </div>
      `;
      
      marker.bindPopup(popupContent);
    });

    // Fit map to show entire route
    const allLatLngs = [
      ...routeLatLngs,
      ...stations.map(station => [station.lat, station.lng] as [number, number])
    ];
    
    if (allLatLngs.length > 0) {
      const bounds = L.latLngBounds(allLatLngs);
      map.fitBounds(bounds, { padding: [20, 20] });
    }

    // Cleanup function
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [route, stations, routePoints]);

  return (
    <div 
      ref={mapRef} 
      className="w-full h-[320px] sm:h-96 rounded-lg"
      style={{ minHeight: '320px' }}
    />
  );
};

export default TripMap;