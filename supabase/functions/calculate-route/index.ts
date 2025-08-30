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
    const API_KEY = Deno.env.get('OPENROUTESERVICE_API_KEY');
    if (!API_KEY) {
      console.error('Route calculation error: API key not found');
      return new Response(
        JSON.stringify({ error: 'API key not configured' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Route calculation request for coordinates:', coordinates);
    const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        coordinates,
        format: 'geojson',
        instructions: true,
        geometry_simplify: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Route calculation failed:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Route calculation failed', status: response.status, details: errorText }),
        { 
          status: response.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
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