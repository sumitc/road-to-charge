import { createHmac, timingSafeEqual } from 'node:crypto';
import { del } from '@vercel/blob';
import { createStationDb } from './station-db.js';
import { createSubmissionDb, type SubmissionRow } from './submission-db.js';

const DUPLICATE_RADIUS_KM = 0.5;

interface PlaceMatch {
  name: string;
  address?: string;
  lat: number;
  lng: number;
  distanceKm: number;
  url?: string;
  types?: string[];
}

export interface ReviewFindings {
  checkedAt: string;
  recommendation: 'publish' | 'review' | 'duplicate';
  summary: string;
  google: {
    available: boolean;
    matchCount: number;
    matches: PlaceMatch[];
    error?: string;
  };
  osm: {
    available: boolean;
    matchCount: number;
    matches: PlaceMatch[];
    error?: string;
  };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function checkGoogle(submission: SubmissionRow) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return { available: false, matchCount: 0, matches: [], error: 'GOOGLE_MAPS_API_KEY not configured' };
  }

  try {
    const data = await fetchJson('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri',
      },
      body: JSON.stringify({
        textQuery: `${submission.station_name} EV charging station`,
        locationBias: {
          circle: {
            center: { latitude: submission.latitude, longitude: submission.longitude },
            radius: 1500,
          },
        },
        maxResultCount: 5,
      }),
    });

    const matches: PlaceMatch[] = (data.places ?? []).map((place: any) => ({
      name: place.displayName?.text ?? 'Unnamed place',
      address: place.formattedAddress,
      lat: place.location?.latitude ?? 0,
      lng: place.location?.longitude ?? 0,
      distanceKm: haversineKm(
        submission.latitude,
        submission.longitude,
        place.location?.latitude ?? 0,
        place.location?.longitude ?? 0
      ),
      url: place.googleMapsUri,
      types: place.types ?? [],
    }));

    return { available: true, matchCount: matches.length, matches };
  } catch (error) {
    return {
      available: false,
      matchCount: 0,
      matches: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkOsm(submission: SubmissionRow) {
  try {
    const query = `[out:json][timeout:20];nwr["amenity"="charging_station"](around:500,${submission.latitude},${submission.longitude});out center 20;`;
    const response = await fetch(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
      {
        headers: { 'User-Agent': 'Ampo/1.0 (+https://ampo.vercel.app)' },
        signal: AbortSignal.timeout(20000),
      }
    );
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    const data = await response.json();

    const matches: PlaceMatch[] = (data.elements ?? []).map((element: any) => {
      const lat = element.lat ?? element.center?.lat ?? 0;
      const lng = element.lon ?? element.center?.lon ?? 0;
      return {
        name: element.tags?.name ?? 'Unnamed charging station',
        address: [element.tags?.['addr:street'], element.tags?.['addr:city']]
          .filter(Boolean)
          .join(', '),
        lat,
        lng,
        distanceKm: haversineKm(submission.latitude, submission.longitude, lat, lng),
        url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`,
      };
    });

    return { available: true, matchCount: matches.length, matches };
  } catch (error) {
    return {
      available: false,
      matchCount: 0,
      matches: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function verifySubmission(submission: SubmissionRow): Promise<ReviewFindings> {
  const [google, osm] = await Promise.all([checkGoogle(submission), checkOsm(submission)]);
  const duplicates = [...google.matches, ...osm.matches].filter(
    match => match.distanceKm <= DUPLICATE_RADIUS_KM
  );
  const recommendation = duplicates.length > 0 ? 'duplicate' : 'publish';

  const googleNote = google.available
    ? `Google Places: ${google.matchCount} candidate(s)`
    : `Google Places unavailable (${google.error ?? 'not configured'})`;
  const osmNote = osm.available
    ? `OpenStreetMap: ${osm.matchCount} charging station(s) nearby`
    : `OpenStreetMap unavailable (${osm.error ?? 'unknown error'})`;

  return {
    checkedAt: new Date().toISOString(),
    recommendation,
    summary: `${googleNote}; ${osmNote}. ${
      duplicates.length > 0
        ? `Possible duplicate within ${DUPLICATE_RADIUS_KM} km — review before publishing.`
        : 'No close match found — likely a new location.'
    }`,
    google,
    osm,
  };
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createReviewToken(id: string, decision: 'approve' | 'reject', secret: string): string {
  const payload = `${id}:${decision}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyReviewToken(
  token: string,
  secret: string
): { id: string; decision: 'approve' | 'reject' } | null {
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(payload, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  const [id, decision] = payload.split(':');
  if (!id || (decision !== 'approve' && decision !== 'reject')) return null;
  return { id, decision };
}

function detailsHtml(submission: SubmissionRow, findings: ReviewFindings): string {
  const escape = (value: unknown) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const rows = [
    ['Station', submission.station_name],
    ['Coordinates', `${submission.latitude}, ${submission.longitude}`],
    ['Address', submission.address || '—'],
    ['Provider', submission.provider || '—'],
    ['Connector types', submission.connector_types.join(', ') || '—'],
    ['Connector text', submission.connector_text || '—'],
    ['OCR text', submission.ocr_text || '—'],
    ['Notes', submission.notes || '—'],
    ['Submitted by', submission.submitter_email || '—'],
    ['Submitted at', submission.created_at],
  ];

  const photos = submission.photo_urls.length
    ? submission.photo_urls.map((url, index) => `<li><a href="${escape(url)}">Photo ${index + 1}</a></li>`).join('')
    : '<li>No photos</li>';

  const googleMatches = findings.google.matches.length
    ? findings.google.matches
        .map(match => `<li>${escape(match.name)} — ${match.distanceKm.toFixed(2)} km ${match.url ? `<a href="${escape(match.url)}">map</a>` : ''}</li>`)
        .join('')
    : '<li>No candidates</li>';

  const osmMatches = findings.osm.matches.length
    ? findings.osm.matches
        .map(match => `<li>${escape(match.name)} — ${match.distanceKm.toFixed(2)} km <a href="${escape(match.url)}">map</a></li>`)
        .join('')
    : '<li>No candidates</li>';

  const secret = process.env.REVIEW_SECRET;
  const baseUrl = process.env.APP_URL || 'https://ampo.vercel.app';
  const approveUrl = secret
    ? `${baseUrl}/api/submission-decision?token=${encodeURIComponent(createReviewToken(submission.id, 'approve', secret))}&decision=approve`
    : '';
  const rejectUrl = secret
    ? `${baseUrl}/api/submission-decision?token=${encodeURIComponent(createReviewToken(submission.id, 'reject', secret))}&decision=reject`
    : '';

  return `
    <h2>New Ampo station submission</h2>
    <p><strong>Automated check:</strong> ${escape(findings.summary)}</p>
    <p><strong>Recommendation:</strong> ${escape(findings.recommendation)}</p>
    <table cellpadding="6" cellspacing="0" border="1">
      ${rows.map(([label, value]) => `<tr><th align="left">${escape(label)}</th><td>${escape(value)}</td></tr>`).join('')}
    </table>
    <h3>Photos</h3><ul>${photos}</ul>
    <h3>Google Places candidates</h3><ul>${googleMatches}</ul>
    <h3>OpenStreetMap candidates</h3><ul>${osmMatches}</ul>
    ${
      approveUrl && rejectUrl
        ? `<p><a href="${approveUrl}" style="background:#0ea5e9;color:#fff;padding:10px 16px;text-decoration:none;border-radius:8px">Approve &amp; publish</a>
           &nbsp; <a href="${rejectUrl}" style="background:#64748b;color:#fff;padding:10px 16px;text-decoration:none;border-radius:8px">Reject</a></p>`
        : '<p><em>Approve/reject links unavailable: REVIEW_SECRET is not configured.</em></p>'
    }
  `;
}

export async function sendReviewEmail(submission: SubmissionRow, findings: ReviewFindings) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, error: 'RESEND_API_KEY not configured' };

  const from = process.env.RESEND_FROM || 'Ampo <onboarding@resend.dev>';
  const to = process.env.REVIEW_EMAIL || 'develop.sumit@gmail.com';

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Ampo station review: ${submission.station_name}`,
        html: detailsHtml(submission, findings),
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      return { sent: false, error: `${response.status} ${await response.text()}` };
    }
    return { sent: true, error: undefined };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function sendDecisionEmail(
  submission: SubmissionRow,
  decision: 'approved' | 'rejected'
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Ampo <onboarding@resend.dev>',
        to: [process.env.REVIEW_EMAIL || 'develop.sumit@gmail.com'],
        subject: `Ampo submission ${decision}: ${submission.station_name}`,
        html: `<p>Submission <strong>${submission.station_name}</strong> was ${decision}.</p>`,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    console.error('Decision email failed:', error);
  }
}

export async function deleteSubmissionPhotos(urls: string[]): Promise<void> {
  if (!urls.length) return;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  try {
    await del(urls, { token });
  } catch (error) {
    console.error('Failed to delete submission photos:', error);
  }
}

export async function publishSubmission(submission: SubmissionRow, findings: Partial<ReviewFindings>) {
  const db = createStationDb();
  const mapsUrl = findings.google?.matches?.[0]?.url;
  await db.upsert([
    {
      station_name: submission.station_name,
      provider: submission.provider || 'Community',
      latitude: submission.latitude,
      longitude: submission.longitude,
      address: submission.address || '',
      external_id: `community:${submission.id}`,
      connector_types: submission.connector_types,
      availability_status: 'unknown',
      source_name: 'Community submission',
      source_url: mapsUrl || '',
      maps_link: mapsUrl || '',
      data_as_of: new Date().toISOString(),
      location_quality: 'suspect',
      station_type: 'charging',
      connectors: [],
      max_kw_by_standard: {},
      vehicle_classes: [],
      payment_modes: [],
      contact_numbers: [],
    },
  ]);
  await db.close();
}

export async function runReview(id: string) {
  const db = createSubmissionDb();
  try {
    const submission = await db.get(id);
    if (!submission) throw new Error(`Submission ${id} not found`);

    const findings = await verifySubmission(submission);
    const email = await sendReviewEmail(submission, findings);
    await db.updateReview(
      id,
      { google: findings.google, osm: findings.osm, recommendation: findings.recommendation },
      { ...findings, email },
      email.sent
    );

    return { submission, findings, email };
  } finally {
    await db.close();
  }
}
