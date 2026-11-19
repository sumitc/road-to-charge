import React, { useState } from 'react';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CONNECTOR_FILTER_OPTIONS } from '@/lib/connectorLabels';
import { cn } from '@/lib/utils';

interface ConnectorFilterProps {
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

/** Multi-select connector dropdown shared by Near Me and Trip Planner. */
export const ConnectorFilter: React.FC<ConnectorFilterProps> = ({
  selected,
  onChange,
  className,
}) => {
  const [open, setOpen] = useState(false);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter(item => item !== value)
        : [...selected, value]
    );
  };

  const singleLabel = selected.length === 1
    ? CONNECTOR_FILTER_OPTIONS.find(option => option.value === selected[0])?.label
    : undefined;
  const summary = selected.length === 0
    ? 'All connectors'
    : singleLabel ?? `${selected.length} types selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-expanded={open}
          className={cn(
            'h-11 w-full justify-between gap-2 rounded-xl px-3 text-sm font-medium sm:w-64',
            selected.length > 0 && 'border-primary/50 bg-primary/5 text-primary',
            className
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span className="truncate">{summary}</span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 opacity-60 transition-transform',
              open && 'rotate-180'
            )}
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-2 shadow-xl"
      >
        <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Charging speed
        </p>
        <div className="space-y-0.5">
          {CONNECTOR_FILTER_OPTIONS.map(option => {
            const checked = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={checked}
                onClick={() => toggle(option.value)}
                className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-accent"
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                    checked
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background'
                  )}
                >
                  {checked && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-tight">
                    {option.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between border-t px-2 pt-2">
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={selected.length === 0}
            className="text-xs font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            Clear selection
          </button>
          <Button size="sm" className="h-9 rounded-lg" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
