import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EVStationService } from '@/services/evStationService';
import type { GoogleRefreshInfo } from '@/lib/googleArea';
import { useToast } from '@/hooks/use-toast';

const POLL_MS = 2500;
const MAX_POLLS = 12; // ~30 s, comfortably inside a Vercel function's runtime

/**
 * Watches the header emitted by /api/stations when a user query claims a
 * Google gap-fill cell, then reports the durable DB refresh result.
 */
export const GoogleRefreshNotice = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const seen = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const clearTimer = (cell: string) => {
      const timer = timers.current.get(cell);
      if (timer !== undefined) window.clearInterval(timer);
      timers.current.delete(cell);
    };

    const finish = (info: GoogleRefreshInfo) => {
      clearTimer(info.cell);
      seen.current.delete(info.cell);
      if (info.status === 'done' && (info.newCount ?? 0) > 0) {
        toast({
          title: 'Station list updated',
          description: `Google check added ${info.newCount} new station${info.newCount === 1 ? '' : 's'}.`,
        });
        void queryClient.invalidateQueries({ queryKey: ['stations'] });
      } else if (info.status === 'done') {
        toast({
          title: 'Google check complete',
          description: `${info.foundCount ?? 0} nearby station(s) matched; no new rows added.`,
        });
      } else if (info.status === 'empty') {
        toast({
          title: 'Google check complete',
          description: 'No additional charging stations found in this area.',
        });
      } else if (info.status === 'failed') {
        toast({
          title: 'Google check will retry later',
          description: info.message || 'The background refresh could not complete.',
          variant: 'destructive',
        });
      }
    };

    const poll = (cell: string) => {
      let attempts = 0;
      clearTimer(cell);
      const timer = window.setInterval(async () => {
        attempts += 1;
        const info = await EVStationService.getGoogleRefreshStatus(cell);
        if (info && info.status !== 'pending' && info.status !== 'cached') {
          finish(info);
          return;
        }
        if (attempts >= MAX_POLLS) {
          clearTimer(cell);
          seen.current.delete(cell);
          toast({
            title: 'Google check still running',
            description: 'We will include the results the next time you search here.',
          });
        }
      }, POLL_MS);
      timers.current.set(cell, timer);
    };

    const onRefresh = (event: Event) => {
      const info = (event as CustomEvent<GoogleRefreshInfo>).detail;
      if (!info?.cell || seen.current.has(info.cell)) return;
      seen.current.add(info.cell);
      if (info.status !== 'pending') return;

      toast({
        title: 'Checking Google for nearby chargers',
        description: 'This search is filling a gap in the catalog.',
      });
      poll(info.cell);
    };

    window.addEventListener('ampo-google-refresh', onRefresh);
    return () => {
      window.removeEventListener('ampo-google-refresh', onRefresh);
      for (const cell of Array.from(timers.current.keys())) clearTimer(cell);
    };
  }, [queryClient, toast]);

  return null;
};
