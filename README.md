# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/92b4a09c-92e4-404c-929c-2fa397ffeeb9

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/92b4a09c-92e4-404c-929c-2fa397ffeeb9) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/92b4a09c-92e4-404c-929c-2fa397ffeeb9) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/tips-tricks/custom-domain#step-by-step-guide)

## Charging station data sources

`supabase/functions/sync-ev-stations` aggregates the station dictionary. Sources marked **keyless** need no credentials; the others are skipped unless their secret is set (see `.env.example`).

| Source | Detail added | Credentials |
| --- | --- | --- |
| BEE API (`ev-charging-stations-api.vercel.app`) | 29k+ stations, gun-level kW, vehicle classes, ownership, admin geography | keyless |
| OpenStreetMap Overpass | `socket:*` connectors, kW, fee, opening hours | keyless |
| Open Charge Map | base station list | `OPEN_CHARGE_MAP_API_KEY` |
| OpenEV – Delhi Transport | live connector availability, tariffs, payment modes | `OPEN_EV_API_KEY` |
| Google Places API (New) | live `evChargeOptions` availability per connector | `GOOGLE_MAPS_API_KEY` |
| OCPI 2.2.1 locations feed | live EVSE status and tariffs | `OCPI_LOCATIONS_URL`, `OCPI_TOKEN` |
| Legacy CPO scrapers / samples | Tata Power, Ather, NITI Aayog, Jio-bp, PlugShare, ChargeZone, ABB, BrightBlu, BEE India, Statiq | — |

Set Edge Function secrets with `supabase secrets set <NAME>=<value>`. Trigger a sync by calling `sync-ev-stations`; an optional JSON body `{ "maxPagesPerState": 2 }` pulls more BEE pages per state (1–10, default 1).

The dictionary schema lives in `supabase/migrations/20261118220000_enhance_station_dictionary.sql` and the frontend shape in `src/types/station.ts`.
