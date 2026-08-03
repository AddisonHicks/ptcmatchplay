import {
  resolveGroupLogoUrl,
  resolveGroupName,
  splitBrandName,
} from "../lib/appSettings.js";

export function BrandMark({ size = 40, showText = true, groupName, groupLogoUrl }) {
  const name = resolveGroupName({ groupName });
  const logo = resolveGroupLogoUrl({ groupLogoUrl });
  const { lead, trail } = splitBrandName(name);

  return (
    <div className="mp-topbar-logo">
      <img src={logo} alt={name} width={size} height={size} />
      {showText && (
        <div className="mp-topbar-logo-text">
          {lead}{trail ? <>{" "}<span>{trail}</span></> : null}
        </div>
      )}
    </div>
  );
}
