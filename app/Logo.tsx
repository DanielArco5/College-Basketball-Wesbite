/**
 * The site mark: a ball with its seams, beside a condensed "CBB"
 * wordmark. Colors come from the site palette, so the
 * mark reads on the dark hardwood background everywhere it appears.
 * app/icon.svg is the same mark, for the browser tab.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className="logo-mark"
    >
      <circle cx="16" cy="16" r="15" fill="#D04A32" />
      <g fill="none" stroke="#191512" strokeWidth="1.7" strokeLinecap="round">
        <path d="M16 1v30" />
        <path d="M1 16h30" />
        <path d="M5.4 5.4c3.6 3.2 5.4 6.8 5.4 10.6s-1.8 7.4-5.4 10.6" />
        <path d="M26.6 5.4c-3.6 3.2-5.4 6.8-5.4 10.6s1.8 7.4 5.4 10.6" />
      </g>
    </svg>
  );
}

export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-word" style={{ fontSize: size * 0.82 }}>
        CBB
      </span>
    </span>
  );
}
