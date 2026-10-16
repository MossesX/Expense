"use client";

/**
 * @file Settings › AI — the assistant's connection (subscription first, API
 * key as backup, each verifiable), persona and instructions. Ported from
 * xGallery's `AssistantSettingsPage` into the settings dialog's AI tab; the
 * model and connection-mode rows beneath it come from the decl like any other
 * setting. Secrets are sent once and only ever come back masked.
 */
import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { MONO } from "../bits";

interface View {
  settings: {
    assistantName: string;
    extraInstructions: string;
    subscriptionVerifiedAt: number | null;
    subscriptionVerifiedDetail: string;
    apiVerifiedAt: number | null;
    apiVerifiedDetail: string;
    hasSubscriptionToken: boolean;
    hasApiKey: boolean;
    subscriptionMasked: string | null;
    apiKeyMasked: string | null;
    sources: { subscription: "none" | "settings" | "env"; api: "none" | "settings" | "env" };
    usage: { subscription: number; api: number; lastBackend: string | null; lastAt: number | null };
  };
  cliInstalled: boolean;
  sourceVersion: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

function ConnRow({ title, hint, has, masked, source, verifiedAt, detail, extra, busy, onVerify }: { title: string; hint: string; has: boolean; masked: string | null; source: "none" | "settings" | "env"; verifiedAt: number | null; detail: string; extra?: string; busy: boolean; onVerify: () => void }) {
  const state = extra ? "blocked" : !has ? "missing" : verifiedAt ? "connected" : detail ? "failed" : "unverified";
  const color = state === "connected" ? token("ok") : state === "failed" ? token("err") : state === "missing" || state === "blocked" ? token("dim") : token("accent");
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", p: 1, border: `1px solid ${token("edge")}`, borderRadius: 1 }}>
      <Box sx={{ width: 10, height: 10, borderRadius: "50%", background: color, mt: 0.6, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.6} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{title}</Typography>
          <Chip size="small" variant="outlined" label={state === "connected" ? "Connected" : state === "unverified" ? "Saved · not verified" : state === "failed" ? "Failed" : state === "blocked" ? "Unavailable" : "Not set"} sx={{ height: 18, color }} />
          {source === "env" && <Chip size="small" variant="outlined" label="from environment" sx={{ height: 18 }} />}
          {masked && <Typography sx={{ fontSize: 11, color: token("dim"), ...MONO }}>{masked}</Typography>}
        </Stack>
        <Typography sx={{ fontSize: 11.5, color: token("dim") }}>{hint}</Typography>
        {(extra || detail) && (
          <Typography sx={{ fontSize: 11.5, color: state === "connected" ? token("ok") : token("dim") }}>
            {extra || detail}
            {verifiedAt ? ` · verified ${new Date(verifiedAt).toLocaleString()}` : ""}
          </Typography>
        )}
      </Box>
      <Button size="small" variant="outlined" onClick={onVerify} disabled={busy || !has || !!extra}>
        {busy ? "Verifying…" : "Verify"}
      </Button>
    </Stack>
  );
}

export default function AiSettingsPanel() {
  const [view, setView] = React.useState<View | null>(null);
  const [name, setName] = React.useState("");
  const [extra, setExtra] = React.useState("");
  const [subToken, setSubToken] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const load = React.useCallback(async () => {
    try {
      const v = await call<View>("/api/ai/settings");
      setView(v);
      setName(v.settings.assistantName);
      setExtra(v.settings.extraInstructions);
    } catch (e) {
      setNote({ tone: "error", text: (e as Error).message });
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Record<string, unknown>, ok: string) => {
    setBusy("save");
    try {
      const v = await call<View>("/api/ai/settings", { method: "PUT", body: JSON.stringify(patch) });
      setView(v);
      setSubToken("");
      setApiKey("");
      setNote({ tone: "success", text: ok });
    } catch (e) {
      setNote({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const verify = async (which: "subscription" | "api" | "both") => {
    setBusy(which);
    try {
      const r = await call<View & { subscription?: { ok: boolean; detail: string }; api?: { ok: boolean; detail: string } }>("/api/ai/settings/test", { method: "POST", body: JSON.stringify({ which }) });
      setView(r);
      const bits = [r.subscription && `Subscription: ${r.subscription.ok ? "connected" : "failed"}`, r.api && `API: ${r.api.ok ? "connected" : "failed"}`].filter(Boolean);
      setNote({ tone: (r.subscription?.ok ?? true) && (r.api?.ok ?? true) ? "success" : "error", text: bits.join(" · ") });
    } catch (e) {
      setNote({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (!view) return <Typography sx={{ fontSize: 12.5, color: token("dim") }}>Loading…</Typography>;
  const s = view.settings;

  return (
    <Stack spacing={1.6} data-axf-ai-settings>
      <Typography sx={{ fontSize: 12, color: token("dim") }}>
        A built-in Claude assistant that knows this app and its source (snapshot {view.sourceVersion}). It runs on your Claude subscription first and falls back to the API; the image reader uses the same connection.
      </Typography>
      {note && (
        <Alert severity={note.tone} sx={{ py: 0 }} onClose={() => setNote(null)}>
          {note.text}
        </Alert>
      )}

      <Box>
        <Stack direction="row" sx={{ alignItems: "center", mb: 0.6 }}>
          <Typography sx={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: token("dim") }}>Connection</Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={() => void verify("both")} disabled={!!busy}>
            {busy === "both" ? "Verifying…" : "Verify both"}
          </Button>
        </Stack>
        <Stack spacing={0.8}>
          <ConnRow title="1 · Claude subscription" hint="Primary. Turns run through Claude Code on your plan; no API charges." has={s.hasSubscriptionToken} masked={s.subscriptionMasked} source={s.sources.subscription} verifiedAt={s.subscriptionVerifiedAt} detail={s.subscriptionVerifiedDetail} extra={!view.cliInstalled ? "Claude Code CLI is missing in this container" : ""} busy={busy === "subscription" || busy === "both"} onVerify={() => void verify("subscription")} />
          <ConnRow title="2 · Backup: Anthropic API" hint="Used when the subscription is missing or fails. Billed per token." has={s.hasApiKey} masked={s.apiKeyMasked} source={s.sources.api} verifiedAt={s.apiVerifiedAt} detail={s.apiVerifiedDetail} busy={busy === "api" || busy === "both"} onVerify={() => void verify("api")} />
        </Stack>
        <Typography sx={{ fontSize: 11, color: token("dim"), mt: 0.6 }}>
          Used so far: {s.usage.subscription} subscription turn{s.usage.subscription === 1 ? "" : "s"}, {s.usage.api} API turn{s.usage.api === 1 ? "" : "s"}
          {s.usage.lastBackend ? ` · last reply via ${s.usage.lastBackend}${s.usage.lastAt ? ` ${new Date(s.usage.lastAt).toLocaleString()}` : ""}` : ""}.
        </Typography>
      </Box>

      <Box>
        <Typography sx={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: token("dim"), mb: 0.6 }}>Credentials</Typography>
        <Stack spacing={1}>
          <TextField size="small" type="password" autoComplete="off" label="Claude subscription token" value={subToken} onChange={(e) => setSubToken(e.target.value)} placeholder={s.hasSubscriptionToken ? "Paste a new token to replace it" : "sk-ant-oat01-…"} slotProps={{ htmlInput: { "data-axf-ai-sub": "" } }} />
          <Typography sx={{ fontSize: 11, color: token("dim") }}>
            On your own computer: <Box component="code" sx={{ ...MONO }}>npm install -g @anthropic-ai/claude-code</Box>, then <Box component="code" sx={{ ...MONO }}>claude login</Box>, then <Box component="code" sx={{ ...MONO }}>claude setup-token</Box>. Paste the token here. Or set CLAUDE_CODE_OAUTH_TOKEN on the server.
          </Typography>
          <TextField size="small" type="password" autoComplete="off" label="Anthropic API key (backup)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={s.hasApiKey ? "Paste a new key to replace it" : "sk-ant-api03-…"} slotProps={{ htmlInput: { "data-axf-ai-key": "" } }} />
          <Typography sx={{ fontSize: 11, color: token("dim") }}>From console.anthropic.com → API keys. Or set ANTHROPIC_API_KEY on the server.</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Button size="small" variant="contained" disabled={!!busy || (!subToken.trim() && !apiKey.trim())} onClick={() => void save({ subscriptionToken: subToken || undefined, apiKey: apiKey || undefined }, "Credentials saved — press Verify")}>
              Save credentials
            </Button>
            {s.sources.subscription === "settings" && (
              <Button size="small" color="inherit" onClick={() => void save({ clearSubscriptionToken: true }, "Subscription token removed")} sx={{ color: token("dim") }}>
                Remove token
              </Button>
            )}
            {s.sources.api === "settings" && (
              <Button size="small" color="inherit" onClick={() => void save({ clearApiKey: true }, "API key removed")} sx={{ color: token("dim") }}>
                Remove API key
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>

      <Box>
        <Typography sx={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: token("dim"), mb: 0.6 }}>Persona</Typography>
        <Stack spacing={1}>
          <TextField size="small" label="Assistant name" value={name} onChange={(e) => setName(e.target.value)} sx={{ maxWidth: 240 }} />
          <TextField size="small" label="Extra instructions (added to the system prompt)" multiline minRows={3} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="House style, things to avoid, how you like changes explained…" />
          <Box>
            <Button size="small" variant="outlined" disabled={!!busy || (name === s.assistantName && extra === s.extraInstructions)} onClick={() => void save({ assistantName: name, extraInstructions: extra }, "Persona saved")}>
              Save persona
            </Button>
          </Box>
        </Stack>
      </Box>
    </Stack>
  );
}
