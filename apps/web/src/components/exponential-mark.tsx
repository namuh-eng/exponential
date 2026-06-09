type ExponentialMarkProps = {
  size?: number;
  className?: string;
  label?: string;
};

export function ExponentialMark({
  size = 18,
  className = "",
  label = "exponential logo",
}: ExponentialMarkProps) {
  return (
    <span
      aria-label={label}
      role="img"
      style={{
        minWidth: Math.round(size * 1.55),
        height: size,
        fontSize: Math.round(size * 0.88),
      }}
      className={`inline-flex shrink-0 items-center font-mono font-bold leading-none tracking-normal text-current ${className}`}
    >
      <span aria-hidden="true">e</span>
      <span
        aria-hidden="true"
        style={{
          fontSize: Math.round(size * 0.46),
          marginLeft: Math.round(size * -0.02),
          transform: `translateY(${Math.round(size * -0.26)}px)`,
        }}
        className="text-[var(--editorial-accent)]"
      >
        ^
      </span>
      <span
        aria-hidden="true"
        style={{
          fontSize: Math.round(size * 0.46),
          marginLeft: Math.round(size * -0.16),
          transform: `translateY(${Math.round(size * -0.26)}px)`,
        }}
      >
        x
      </span>
    </span>
  );
}
