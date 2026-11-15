import { useState, useEffect } from "react";
import { Toast } from "./Toast.jsx";
import {
  isDiscordWebhookUrl,
  isDiscordThreadId,
  normalizeDiscordThreadId,
  postDiscordTestMessage,
} from "../lib/discord.js";
import {
  DEFAULT_COLORS,
  DEFAULT_GROUP_LOGO_URL,
  DEFAULT_GROUP_NAME,
  COLOR_FIELDS,
  isHexColor,
  normalizeHex,
  resolveColors,
  resolveGroupLogoUrl,
  resolveGroupName,
} from "../lib/appSettings.js";

export default function AdminAppSettings({
  db,
  onBack,
  onSaveDiscordWebhook,
  onSaveAppSettings,
}) {
  const [groupName, setGroupName] = useState(db.groupName || "");
  const [groupLogoUrl, setGroupLogoUrl] = useState(db.groupLogoUrl || "");
  const [colors, setColors] = useState(() => resolveColors(db));
  const [webhookDraft, setWebhookDraft] = useState(db.discordWebhookUrl || "");
  const [threadIdDraft, setThreadIdDraft] = useState(db.discordThreadId || "");
  const [brandBusy, setBrandBusy] = useState(false);
  const [colorsBusy, setColorsBusy] = useState(false);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [toast, setToast] = useState(null);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => {
    setGroupName(db.groupName || "");
    setGroupLogoUrl(db.groupLogoUrl || "");
    setColors(resolveColors(db));
    setWebhookDraft(db.discordWebhookUrl || "");
    setThreadIdDraft(db.discordThreadId || "");
  }, [db]);

  const previewName = groupName.trim() || DEFAULT_GROUP_NAME;
  const previewLogo = groupLogoUrl.trim() || DEFAULT_GROUP_LOGO_URL;

  async function saveBrand() {
    setBrandBusy(true);
    const ok = await onSaveAppSettings?.({
      groupName: groupName.trim() || null,
      groupLogoUrl: groupLogoUrl.trim() || null,
    });
    setBrandBusy(false);
    if (ok === false) showToast("Couldn't save brand — try again");
    else showToast("Brand settings saved ✓");
  }

  async function saveColors() {
    const next = {};
    for (const { key } of COLOR_FIELDS) {
      const raw = (colors[key] || "").trim();
      if (!raw) continue;
      if (!isHexColor(raw)) {
        showToast(`Invalid color for ${key} — use #RGB or #RRGGBB`);
        return;
      }
      const normalized = normalizeHex(raw);
      if (normalized !== DEFAULT_COLORS[key]) next[key] = normalized;
    }
    setColorsBusy(true);
    const ok = await onSaveAppSettings?.({
      colors: Object.keys(next).length ? next : null,
    });
    setColorsBusy(false);
    if (ok === false) showToast("Couldn't save colors — try again");
    else showToast("App colors saved ✓");
  }

  async function resetColors() {
    setColors({ ...DEFAULT_COLORS });
    setColorsBusy(true);
    const ok = await onSaveAppSettings?.({ colors: null });
    setColorsBusy(false);
    if (ok === false) showToast("Couldn't reset colors — try again");
    else showToast("Colors reset to defaults ✓");
  }

  async function saveWebhook() {
    const trimmed = webhookDraft.trim();
    const threadTrimmed = threadIdDraft.trim();
    if (trimmed && !isDiscordWebhookUrl(trimmed)) {
      showToast("Enter a valid Discord webhook URL");
      return;
    }
    if (threadTrimmed && !isDiscordThreadId(threadTrimmed)) {
      showToast("Thread ID must be digits only (Discord snowflake)");
      return;
    }
    setWebhookBusy(true);
    const ok = await onSaveDiscordWebhook?.({
      url: trimmed,
      threadId: threadTrimmed || null,
    });
    setWebhookBusy(false);
    if (ok === false) showToast("Couldn't save webhook — try again");
    else showToast(trimmed ? "Discord webhook saved ✓" : "Discord webhook cleared");
  }

  async function clearWebhook() {
    setWebhookDraft("");
    setThreadIdDraft("");
    setWebhookBusy(true);
    const ok = await onSaveDiscordWebhook?.({ url: "", threadId: null });
    setWebhookBusy(false);
    if (ok === false) showToast("Couldn't clear webhook — try again");
    else showToast("Discord webhook cleared");
  }

  async function testWebhook() {
    const url = webhookDraft.trim() || db.discordWebhookUrl || "";
    const threadTrimmed = threadIdDraft.trim() || db.discordThreadId || "";
    if (!isDiscordWebhookUrl(url)) {
      showToast("Save a valid Discord webhook URL first");
      return;
    }
    if (threadTrimmed && !isDiscordThreadId(threadTrimmed)) {
      showToast("Thread ID must be digits only (Discord snowflake)");
      return;
    }
    setWebhookBusy(true);
    try {
      await postDiscordTestMessage(url, {
        groupName: resolveGroupName(db),
        threadId: normalizeDiscordThreadId(threadTrimmed),
      });
      showToast("Test message sent ✓");
    } catch (e) {
      console.error(e);
      showToast(
        threadTrimmed
          ? "Test failed — check the webhook URL and thread ID"
          : "Test failed — check the webhook URL"
      );
    }
    setWebhookBusy(false);
  }

  function setColor(key, value) {
    setColors(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div className="mp-page">
      {toast && <Toast message={toast} />}
      <button type="button" className="mp-back-btn mb-16" onClick={onBack}>
        ← Admin panel
      </button>
      <div className="mp-section-eyebrow">Admin</div>
      <div className="mp-section-title">App settings</div>
      <div className="mp-section-sub">
        Brand, colors, and Discord — apply across the public app and admin.
      </div>

      {/* Brand */}
      <div className="mp-card mb-20">
        <div className="mp-card-title">Brand</div>
        <div className="mp-settings-preview mb-16">
          <img src={previewLogo} alt={previewName} width={48} height={48} />
          <div>
            <div className="font-meta t-muted mb-4">Preview</div>
            <div className="t-heading fw-700">{previewName}</div>
          </div>
        </div>

        <div className="font-label t-muted mb-6">Group name</div>
        <input
          className="mp-input mb-12"
          type="text"
          value={groupName}
          onChange={e => setGroupName(e.target.value)}
          placeholder={DEFAULT_GROUP_NAME}
          autoComplete="off"
        />

        <div className="font-label t-muted mb-6">Group logo URL</div>
        <input
          className="mp-input mb-8"
          type="url"
          value={groupLogoUrl}
          onChange={e => setGroupLogoUrl(e.target.value)}
          placeholder={DEFAULT_GROUP_LOGO_URL}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="font-meta-sm t-muted mb-12">
          Paste a public image URL, or leave blank for the built-in logo
          ({DEFAULT_GROUP_LOGO_URL}). You can also replace that file in the repo under{" "}
          <code className="mp-inline-code">public/brand/</code>.
        </div>

        <button
          type="button"
          className="mp-btn mp-btn-primary"
          onClick={saveBrand}
          disabled={brandBusy}
          style={{ width: "auto" }}
        >
          Save brand
        </button>
      </div>

      {/* Colors */}
      <div className="mp-card mb-20">
        <div className="mp-card-title">App colors</div>
        <div className="mp-section-sub mb-12" style={{ marginBottom: 12 }}>
          These update the shared CSS variables used throughout the UI.
        </div>
        <div className="mp-color-grid mb-12">
          {COLOR_FIELDS.map(({ key, label, hint }) => (
            <label key={key} className="mp-color-field">
              <span className="font-label t-muted">{label}</span>
              <span className="font-meta-sm t-faint">{hint}</span>
              <div className="mp-color-row">
                <input
                  type="color"
                  className="mp-color-swatch"
                  value={normalizeHex(colors[key]) || DEFAULT_COLORS[key]}
                  onChange={e => setColor(key, e.target.value)}
                  aria-label={label}
                />
                <input
                  className="mp-input"
                  type="text"
                  value={colors[key] || ""}
                  onChange={e => setColor(key, e.target.value)}
                  placeholder={DEFAULT_COLORS[key]}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </label>
          ))}
        </div>
        <div className="mp-discord-actions">
          <button
            type="button"
            className="mp-btn mp-btn-primary"
            onClick={saveColors}
            disabled={colorsBusy}
          >
            Save colors
          </button>
          <button
            type="button"
            className="mp-btn mp-btn-ghost"
            onClick={resetColors}
            disabled={colorsBusy}
          >
            Reset defaults
          </button>
        </div>
        {!db.colors && (
          <div className="font-meta-sm t-muted mt-10">Using built-in theme defaults</div>
        )}
      </div>

      {/* Discord */}
      <div className="mp-card mp-discord-card mb-20">
        <div className="mp-card-title">Discord notifications</div>
        <div className="mp-section-sub mb-12">
          Posts when a match result is validated or overridden. App-wide for all tournaments.
        </div>
        <div className="font-label t-muted mb-6">Webhook URL</div>
        <input
          className="mp-input mb-12"
          type="url"
          value={webhookDraft}
          onChange={e => setWebhookDraft(e.target.value)}
          placeholder="https://discord.com/api/webhooks/…"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="font-label t-muted mb-6">Thread ID (optional)</div>
        <input
          className="mp-input mb-8"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={threadIdDraft}
          onChange={e => setThreadIdDraft(e.target.value)}
          placeholder="e.g. 1234567890123456789"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="font-meta-sm t-muted mb-12">
          For a Discord forum channel, paste an existing thread/post ID. Leave blank to post in the channel.
          We append <code className="mp-inline-code">?thread_id=…</code> for you — no need to edit the webhook URL.
        </div>
        <div className="mp-discord-actions">
          <button type="button" className="mp-btn mp-btn-primary" onClick={saveWebhook} disabled={webhookBusy}>
            Save
          </button>
          <button type="button" className="mp-btn mp-btn-ghost" onClick={testWebhook} disabled={webhookBusy}>
            Send test
          </button>
          <button
            type="button"
            className="mp-btn mp-btn-ghost"
            onClick={clearWebhook}
            disabled={
              webhookBusy ||
              (!webhookDraft && !threadIdDraft && !db.discordWebhookUrl && !db.discordThreadId)
            }
          >
            Clear
          </button>
        </div>
        {db.discordWebhookUrl && (
          <div className="font-meta-sm t-muted mt-10">
            Webhook configured — notifications are on
            {db.discordThreadId ? ` · thread ${db.discordThreadId}` : ""}
          </div>
        )}
      </div>

      <div className="font-meta-sm t-faint">
        Current live brand: {resolveGroupName(db)} · logo {resolveGroupLogoUrl(db)}
      </div>
    </div>
  );
}
