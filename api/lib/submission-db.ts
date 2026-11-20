import postgres from 'postgres';

export interface SubmissionRow {
  id: string;
  status: string;
  station_name: string;
  latitude: number;
  longitude: number;
  address?: string | null;
  provider?: string | null;
  connector_types: string[];
  connector_text?: string | null;
  ocr_text?: string | null;
  notes?: string | null;
  submitter_email?: string | null;
  photo_urls: string[];
  maps_findings: Record<string, unknown>;
  review_findings: Record<string, unknown>;
  review_email_sent_at?: Date | string | null;
  reviewed_at?: Date | string | null;
  review_decision?: string | null;
  created_at?: Date | string | null;
}

export function createSubmissionDb() {
  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL / POSTGRES_URL_NON_POOLING is not configured');

  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 20,
    ssl: 'require',
    prepare: false,
  });

  return {
    async create(row: SubmissionRow): Promise<void> {
      await sql`
        INSERT INTO public.station_submissions (
          id, status, station_name, latitude, longitude, address, provider,
          connector_types, connector_text, ocr_text, notes, submitter_email,
          photo_urls, maps_findings, review_findings
        ) VALUES (
          ${row.id}, ${row.status}, ${row.station_name}, ${row.latitude}, ${row.longitude},
          ${row.address ?? null}, ${row.provider ?? null}, ${row.connector_types},
          ${row.connector_text ?? null}, ${row.ocr_text ?? null}, ${row.notes ?? null},
          ${row.submitter_email ?? null}, ${row.photo_urls}, ${JSON.stringify(row.maps_findings)}::jsonb,
          ${JSON.stringify(row.review_findings)}::jsonb
        )
      `;
    },

    async get(id: string): Promise<SubmissionRow | null> {
      const rows = await sql<SubmissionRow[]>`
        SELECT * FROM public.station_submissions WHERE id = ${id}
      `;
      return rows[0] ?? null;
    },

    async updateReview(
      id: string,
      mapsFindings: Record<string, unknown>,
      reviewFindings: Record<string, unknown>,
      emailSent: boolean
    ): Promise<void> {
      await sql`
        UPDATE public.station_submissions
        SET
          maps_findings = ${JSON.stringify(mapsFindings)}::jsonb,
          review_findings = ${JSON.stringify(reviewFindings)}::jsonb,
          review_email_sent_at = ${emailSent ? new Date().toISOString() : null},
          updated_at = now()
        WHERE id = ${id}
      `;
    },

    async setDecision(
      id: string,
      decision: 'approved' | 'rejected',
      reviewFindings: Record<string, unknown>
    ): Promise<void> {
      await sql`
        UPDATE public.station_submissions
        SET
          status = ${decision},
          review_decision = ${decision},
          review_findings = ${JSON.stringify(reviewFindings)}::jsonb,
          reviewed_at = now(),
          updated_at = now()
        WHERE id = ${id}
      `;
    },

    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}
