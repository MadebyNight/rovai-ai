/** Shared execution identity; status glyphs keep their own state-specific shapes. */
export function ExecutionIcon({ className }: { className?: string }): React.JSX.Element {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </svg>
}

export function ExecutionOverviewMark({ className }: { className: string }): React.JSX.Element {
  return <span className={className} aria-hidden="true">
    <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="4" width="6" height="6" rx="1.2" />
      <rect x="14" y="4" width="6" height="6" rx="1.2" />
      <rect x="4" y="14" width="6" height="6" rx="1.2" />
      <rect x="14" y="14" width="6" height="6" rx="1.2" />
    </svg>
  </span>
}
