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
    const { address } = await req.json();
    
    if (!address) {
      return new Response(
        JSON.stringify({ error: 'Address is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Using OpenRouteService for geocoding
    const API_KEY = Deno.env.get('OPENROUTESERVICE_API_KEY');
    if (!API_KEY) {
      console.error('Geocoding error: API key not found');
      return new Response(
        JSON.stringify({ error: 'API key not configured' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Geocoding request for:', address);
    const response = await fetch(
      `https://api.openrouteservice.org/geocode/search?api_key=${API_KEY}&text=${encodeURIComponent(address)}&size=1`
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Geocoding failed:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Geocoding failed', status: response.status, details: errorText }),
        { 
          status: response.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Address not found' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const feature = data.features[0];
    const [lng, lat] = feature.geometry.coordinates;

    const result = {
      lat,
      lng,
      address: feature.properties.label
    };

    console.log('Geocoding successful:', { address, result });

    return new Response(
      JSON.stringify(result),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Geocoding error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});