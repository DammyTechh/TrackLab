/**
 * Material Symbols Rounded, as a real font. Never emoji.
 * Decorative by default; pass `label` when the glyph is the only thing said.
 */
export function Icon({
  name,
  filled = false,
  size = 20,
  className = '',
  label,
}: {
  name: string;
  filled?: boolean;
  size?: 18 | 20 | 28 | 40;
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={`select-none align-middle font-icon leading-none ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
      }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {name}
    </span>
  );
}
