import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { createSubmissionDb, type SubmissionRow } from './lib/submission-db.js';
import { runReview } from './lib/submission-review.js';

export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_PHOTO_BYTES = 1_500_000;
const MAX_PHOTOS = 3;

interface IncomingPhoto {
  dataUrl?: string;
  name?: string;
}

interface IncomingSubmission {
  stationName?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  provider?: string;
  connectorTypes?: string[];
  connectorText?: string;
  ocrText?: string;
  notes?: string;
  submitterEmail?: string;
  photos?: IncomingPhoto[];
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  return {
    contentType: match[1] === 'image/jpg' ? 'image/jpeg' : match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as IncomingSubmission;
    const stationName = String(body.stationName ?? '').trim();
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);

    if (!stationName || stationName.length > 200) {
      return jsonResponse({ success: false, error: 'A station name of up to 200 characters is required' }, 400);
    }
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      return jsonResponse({ success: false, error: 'Valid latitude and longitude are required' }, 400);
    }

    const photos = body.photos ?? [];
    if (photos.length > MAX_PHOTOS) {
      return jsonResponse({ success: false, error: `At most ${MAX_PHOTOS} photos are allowed` }, 400);
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (photos.length > 0 && !token) {
      return jsonResponse({ success: false, error: 'Photo uploads are not configured yet' }, 503);
    }

    const id = randomUUID();
    const photoUrls: string[] = [];
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      if (!photo?.dataUrl) continue;
      const decoded = decodeDataUrl(photo.dataUrl);
      if (!decoded) {
        return jsonResponse({ success: false, error: 'Photos must be JPEG, PNG, or WebP data URLs' }, 400);
      }
      if (decoded.buffer.length > MAX_PHOTO_BYTES) {
        return jsonResponse({ success: false, error: 'Each photo must be under 1.5 MB' }, 400);
      }
      const extension = decoded.contentType.split('/')[1].replace('jpeg', 'jpg');
      const safeName = String(photo.name ?? `photo-${index + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || `photo-${index + 1}`;
      const uploaded = await put(`submissions/${id}/${index + 1}-${safeName}.${extension}`, decoded.buffer, {
        access: 'public',
        contentType: decoded.contentType,
        token,
      });
      photoUrls.push(uploaded.url);
    }

    const submission: SubmissionRow = {
      id,
      status: 'pending',
      station_name: stationName,
      latitude,
      longitude,
      address: String(body.address ?? '').slice(0, 500),
      provider: String(body.provider ?? '').slice(0, 200),
      connector_types: Array.isArray(body.connectorTypes)
        ? body.connectorTypes.map(value => String(value).slice(0, 80)).slice(0, 10)
        : [],
      connector_text: String(body.connectorText ?? '').slice(0, 500),
      ocr_text: String(body.ocrText ?? '').slice(0, 2000),
      notes: String(body.notes ?? '').slice(0, 2000),
      submitter_email: String(body.submitterEmail ?? '').slice(0, 200),
      photo_urls: photoUrls,
      maps_findings: {},
      review_findings: {},
    };

    const db = createSubmissionDb();
    try {
      await db.create(submission);
    } finally {
      await db.close();
    }

    let reviewError: string | undefined;
    try {
      await runReview(id);
    } catch (error) {
      reviewError = error instanceof Error ? error.message : String(error);
      console.error('Submission review failed:', error);
    }

    return jsonResponse({
      success: true,
      id,
      status: reviewError ? 'pending' : 'reviewed',
      reviewError,
    });
  } catch (error) {
    console.error('Submission failed:', error);
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}
