import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { coordinates } = await req.json();
    
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
      return new Response(
        JSON.stringify({ error: 'At least 2 coordinates are required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Using OpenRouteService for route calculation
    const API_KEY = '5b3ce3597851110001cf6248b20188b5c9e24a6e991ba49fdb2b3a2b';
    const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: {
        'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
        'Authorization': API_KEY,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        coordinates,
        format: 'geojson',
        instructions: true,
        geometry_simplify: true
      })
    });

    if (!response.ok) {
      throw new Error(`Route calculation failed: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No route found' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const route = data.features[0];
    const geometry = route.geometry;
    const properties = route.properties;

    const result = {
      coordinates: geometry.coordinates,
      distance: properties.segments[0].distance,
      duration: properties.segments[0].duration,
      instructions: properties.segments[0].steps.map((step: any) => step.instruction)
    };

    console.log('Route calculation successful:', { coordinatesCount: coordinates.length, distance: result.distance });

    return new Response(
      JSON.stringify(result),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Route calculation error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});