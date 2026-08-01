export function BrandMark({ size = 40, showText = true }) {
  return (
    <div className="mp-topbar-logo">
      <img src="/brand/ptc-peach.png" alt="Peachtree Collective" width={size} height={size} />
      {showText && <div className="mp-topbar-logo-text">Peachtree <span>Collective</span></div>}
    </div>
  );
}
