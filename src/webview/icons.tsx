interface IconProps {
  readonly size?: number;
}

export function SearchIcon({ size = 14 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" />
      <path d="M10 10l4 4" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronIcon({ size = 12 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RefreshIcon({ size = 14 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13 7a5 5 0 10-1.6 3.7M13 3.5V7h-3.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TerminalIcon({ size = 14 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" />
      <path d="M4 6l2.5 2L4 10M8.5 10.5H12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WarningIcon({ size = 14 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2l6.5 11.5h-13L8 2z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M8 6.5v3.2M8 11.6v.4" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 12 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8h10M9 4.5L12.5 8 9 11.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PackageIcon({ size = 15 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7L8 1.5z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M2.5 4.5L8 7.5l5.5-3M8 7.5v7" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  );
}
