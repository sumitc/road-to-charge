import React from 'react';
import { CONNECTOR_FILTER_OPTIONS } from '@/lib/connectorLabels';
import { cn } from '@/lib/utils';

interface ConnectorFilterProps {
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

/**
 * Touch-friendly, multi-select connector chips shared by Near Me and
 * Trip Planner. An empty selection shows every connector.
 */
export const ConnectorFilter: React.FC<ConnectorFilterProps> = ({
  selected,
  onChange,
  className,
}) => {
  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter(item => item !== value)
        : [...selected, value]
    );
  };

  return (
    <div
      role="group"
      aria-label="Connector and charging speed"
      className={cn('flex flex-wrap gap-2', className)}
    >
      <button
        type="button"
        aria-pressed={selected.length === 0}
        onClick={() => onChange([])}
        className={cn(
          'min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium transition-colors',
          selected.length === 0
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-input bg-background hover:bg-accent'
        )}
      >
        All
      </button>
      {CONNECTOR_FILTER_OPTIONS.map(option => {
        const active = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(option.value)}
            className={cn(
              'min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-background hover:bg-accent'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};
