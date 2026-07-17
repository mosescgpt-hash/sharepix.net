interface LogoProps {
  size?: number;
  /** 'navy' for light backgrounds, 'white' for navy backgrounds */
  tone?: 'navy' | 'white';
}

/** SharePix mark: a camera whose film window is a QR code. */
export default function Logo({ size = 30, tone = 'navy' }: LogoProps) {
  const body = tone === 'navy' ? '#123851' : '#FFFFFF';
  const detail = tone === 'navy' ? '#FFFFFF' : '#123851';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 34"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* viewfinder hump */}
      <rect x="12" y="1" width="12" height="7" rx="2.5" fill={body} />
      {/* camera body */}
      <rect x="1" y="5" width="38" height="28" rx="7" fill={body} />
      {/* QR window */}
      <rect x="6" y="11" width="12" height="12" rx="2" fill={detail} />
      <rect x="8" y="13" width="3.2" height="3.2" fill={body} />
      <rect x="13" y="13" width="2.2" height="2.2" fill={body} />
      <rect x="8" y="18" width="2.2" height="2.2" fill={body} />
      <rect x="12" y="17" width="3.2" height="3.2" fill={body} />
      {/* lens with play mark */}
      <circle cx="28" cy="19" r="8" stroke={detail} strokeWidth="2.4" fill="none" />
      <path d="M26 15.5l6 3.5-6 3.5v-7z" fill="#099361" />
    </svg>
  );
}
