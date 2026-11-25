import React from 'react';
import { cn } from '@/lib/utils';

const TONE: Record<string, { dot: string; ping: string; text: string }> = {
  operational: { dot: 'bg-emerald-500', ping: 'bg-emerald-400', text: 'text-emerald-700' },
  maintenance: { dot: 'bg-amber-500', ping: 'bg-amber-300', text: 'text-amber-700' },
  'out-of-service': { dot: 'bg-rose-500', ping: 'bg-rose-300', text: 'text-rose-700' },
};

const LABEL: Record<string, string> = {
  operational: 'Live',
  maintenance: 'Maintenance',
  'out-of-service': 'Offline',
  unknown: 'Status unknown',
};

/** Status pill. "Available" gets a radiating green dot like a live indicator. */
export const LiveStatus: React.FC<{ status?: string; className?: string }> = ({ status = '', className }) => {
  const key = status.toLowerCase();
  const tone = TONE[key] ?? { dot: 'bg-slate-400', ping: 'bg-slate-300', text: 'text-muted-foreground' };
  const isLive = key === 'operational';
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', tone.text, className)}
      title={isLive ? 'Available — live status' : LABEL[key] ?? status}
    >
      <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
        {isLive && (
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', tone.ping)} />
        )}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', tone.dot)} />
      </span>
      {LABEL[key] ?? status}
    </span>
  );
};
