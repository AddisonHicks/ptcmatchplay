import { useState } from "react";
import {
  resolveGroupLogoUrl,
  resolveGroupName,
  splitBrandName,
} from "../lib/appSettings.js";

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "";

export function AdminPasswordScreen({ onUnlock, groupName, groupLogoUrl }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const name = resolveGroupName({ groupName });
  const logo = resolveGroupLogoUrl({ groupLogoUrl });
  const { lead, trail } = splitBrandName(name);

  function handleSubmit() {
    if (pw.toLowerCase() === ADMIN_PASSWORD.toLowerCase()) onUnlock();
    else { setError(true); setTimeout(() => setError(false), 2000); }
  }
  return (
    <div className="mp-pw-screen">
      <button
        type="button"
        className="mp-pw-back"
        onClick={()=>{ window.location.hash = ""; }}
      >
        ← Back to tournament
      </button>
      <img className="mp-pw-crest" src={logo} alt={name} />
      <div className="mp-pw-title">
        {lead}{trail ? <>{" "}<span>{trail}</span></> : null}{" "}Admin
      </div>
      <div className="mp-pw-sub">Commissioner access only</div>
      <div className="mp-pw-form">
        <input type="password" placeholder="password"
          value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
          autoFocus className={error ? "mp-pw-input error shake" : "mp-pw-input"} />
        {error && <div className="mp-error ta-center">Incorrect password</div>}
        <button className="mp-btn mp-btn-primary" onClick={handleSubmit}>Enter Admin →</button>
      </div>
    </div>
  );
}
