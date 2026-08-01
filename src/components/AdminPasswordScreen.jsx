import { useState } from "react";

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "";

export function AdminPasswordScreen({ onUnlock }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
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
      <img className="mp-pw-crest" src="/brand/ptc-peach.png" alt="Peachtree Collective" />
      <div className="mp-pw-title">Peachtree Admin</div>
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
