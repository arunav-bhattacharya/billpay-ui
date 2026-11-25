import { flagEmoji } from './lib'

/* ---------- Line icons ----------

   One family: 24×24, drawn on the same grid at the same weight, so a pencil
   and a bin sitting in the same row of action buttons match. */

export function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

/* ---------- The check mark ----------

   One geometry, drawn everywhere something is done, so every tick on the page
   matches rather than falling back to whatever glyph a font supplies. */

const CHECK_PATH = 'M5.6 12.5 10.1 17 18.4 7.8'

function CheckPath({ stroke = 'currentColor' }: { stroke?: string }) {
  return (
    <path
      d={CHECK_PATH}
      fill="none"
      stroke={stroke}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

/** Bare check. Takes its colour from `currentColor`. */
export function CheckMark({ className }: { className?: string }) {
  return (
    <svg
      className={`check-mark${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <CheckPath />
    </svg>
  )
}

/** The same check on a filled disc — "already onboarded", "step complete". */
export function TickIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`tick-icon${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      {/* Same path, inset so it sits comfortably inside the disc. */}
      <g transform="translate(12 12) scale(0.78) translate(-12 -12)">
        <CheckPath stroke="#fff" />
      </g>
    </svg>
  )
}

export type SelectionState = 'none' | 'partial' | 'all'

/**
 * The box that governs a whole list — the same rounded square the rows use,
 * carrying all three states it can be in: empty, a dash for a partial
 * selection, and the shared check once everything is on.
 */
export function SelectionBox({ state }: { state: SelectionState }) {
  return (
    <svg className={`selection-box sel-${state}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      {state === 'all' && (
        <g transform="translate(12 12) scale(0.6) translate(-12 -12)">
          <CheckPath stroke="#fff" />
        </g>
      )}
      {state === 'partial' && (
        <path d="M8 12h8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      )}
    </svg>
  )
}

/* ---------- The arrow ----------

   One geometry, rotated to point where it is needed. There were three: two
   near-identical CSS constructions built from borders at different sizes, and
   a printed ↗ that came from the system font and matched neither. Drawn at
   the same weight as the check mark so the two read as one family. */

export type ArrowDirection = 'right' | 'left' | 'up-right'

export function Arrow({
  direction = 'right',
  className,
}: {
  direction?: ArrowDirection
  className?: string
}) {
  return (
    <svg
      className={`arrow arrow-${direction}${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M4.5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path
        d="M12.8 6.3 18.5 12l-5.7 5.7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* ---------- Flag ---------- */

export function Flag({ code, size = 22 }: { code: string; size?: number }) {
  return (
    <span className="flag" style={{ fontSize: size }} role="img" aria-label={`${code} flag`}>
      {flagEmoji(code)}
    </span>
  )
}

/**
 * The console's mark: three bars stepping down, one per environment a release passes through, on the brand gradient.
 * Drawn here so it carries no one else's logo.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 34 34" aria-hidden="true">
      <defs>
        <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00175a" />
          <stop offset="0.55" stopColor="#0a4fa8" />
          <stop offset="1" stopColor="#2b8ce6" />
        </linearGradient>
      </defs>
      <rect width="34" height="34" rx="9" fill="url(#brand-grad)" />
      <rect x="8" y="9" width="18" height="3.2" rx="1.6" fill="#fff" />
      <rect x="8" y="15.4" width="13" height="3.2" rx="1.6" fill="#fff" opacity="0.86" />
      <rect x="8" y="21.8" width="8" height="3.2" rx="1.6" fill="#fff" opacity="0.72" />
    </svg>
  )
}
