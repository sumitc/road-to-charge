-- Community-submitted charging stations, queued for review before publishing.
CREATE TABLE IF NOT EXISTS public.station_submissions (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'approved', 'rejected')),
  station_name text NOT NULL,
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  address text,
  provider text,
  connector_types text[] NOT NULL DEFAULT '{}',
  connector_text text,
  ocr_text text,
  notes text,
  submitter_email text,
  photo_urls text[] NOT NULL DEFAULT '{}',
  maps_findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_email_sent_at timestamptz,
  reviewed_at timestamptz,
  review_decision text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS station_submissions_status_created_at_idx
  ON public.station_submissions (status, created_at DESC);
