import React from 'react';
import { cn } from '@/lib/utils';

interface BrandTitleProps {
  /** Short descriptor shown on the same line as the Ampo wordmark. */
  subtitle: string;
  className?: string;
}

/**
 * Shared header title so the list and detail screens always use the same
 * Ampo wordmark styling. Keep it on one line — it adds no vertical chrome.
 */
export const BrandTitle: React.FC<BrandTitleProps> = ({ subtitle, className }) => (
  <h1 className={cn(
    'flex min-w-0 items-baseline gap-1.5 whitespace-nowrap text-base font-bold sm:text-xl',
    className,
  )}>
    <span className="shrink-0">Ampo</span>
    <span className="min-w-0 truncate text-[11px] font-medium opacity-90 sm:text-sm">
      {subtitle}
    </span>
  </h1>
);
