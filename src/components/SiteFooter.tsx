import React from 'react';
import { ExternalLink, MessageSquarePlus } from 'lucide-react';

const FEEDBACK_URL = `https://github.com/sumitc/road-to-charge/issues/new?${new URLSearchParams({
  title: 'Ruvo feedback',
  body: [
    'App / page:',
    '',
    'What happened:',
    '',
    'Expected behaviour:',
    '',
    'Screenshot (if any):',
  ].join('\n'),
}).toString()}`;

/** Compact, shared footer for every Ruvo screen. */
export const SiteFooter: React.FC = () => (
  <footer className="mt-6 border-t border-border/70 px-4 py-4 text-center text-[11px] leading-relaxed text-muted-foreground">
    <p>© 2026 Fibuladreams Pvt Ltd. All rights reserved.</p>
    <a
      href={FEEDBACK_URL}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"
    >
      <MessageSquarePlus className="h-3.5 w-3.5" />
      Feedback
      <ExternalLink className="h-3 w-3" />
    </a>
  </footer>
);
