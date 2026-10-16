"use client";

/**
 * @file The assistant drawer — ported from xGallery's `AssistantPanel`, on
 * MUI, with the mode switch the port adds: **Chat** (reads the source),
 * **Edit source** (edits a workspace copy) and **Build** (edit + typecheck,
 * checkpointed, with a Changes list). Conversations, streamed replies, page
 * context, a workspace review strip with diff download and reset.
 */
import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { MONO } from "../bits";
import { expenseUi } from "../ui";
import { Markdown } from "./Markdown";
import { aiApi, assistantUi, streamTurn, useAssistantUi, type AiMessage, type AiStatus, type AssistantMode, type ConversationSummary, type LiveTurn, type PageContext } from "./client";

const MODE_LABEL: Record<AssistantMode, string> = { chat: "Chat", edit: "Edit source", build: "Build" };
const MODE_HINT: Record<AssistantMode, string> = {
  chat: "Reads the app's source and answers. Cannot change files.",
  edit: "Edits a private copy of the source. Review the diff, download it as a patch.",
  build: "Edits, runs the typecheck, checkpoints every turn and lists the files it changed."
};

const SUGGESTIONS: Record<AssistantMode, string[]> = {
  chat: ["How does the duplicate detection on import work?", "Where is the payday calendar computed?", "Explain the welcome dialog's sections", "What settings exist and what reads them?"],
  edit: ["Add a Notes column to the grid", "Make the statements view default to quarter", "Rename the Scan image button to Scan statement"],
  build: ["Add a CSV export of the current grid and typecheck it", "Add a keyboard shortcut Ctrl+K that focuses the filter", "Review import.ts for edge cases and fix what you find"]
};

export default function AssistantPanel() {
  const ui = useAssistantUi();
  const [status, setStatus] = React.useState<AiStatus | null>(null);
  const [conversations, setConversations] = React.useState<ConversationSummary[]>([]);
  const [messages, setMessages] = React.useState<AiMessage[]>([]);
  const [text, setText] = React.useState("");
  const [context, setContext] = React.useState<PageContext>({});
  const [live, setLive] = React.useState<LiveTurn | null>(null);
  const [showList, setShowList] = React.useState(false);
  const [workspace, setWorkspace] = React.useState<{ files: string[]; diff: string } | null>(null);
  const [showDiff, setShowDiff] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    assistantUi.hydrate();
  }, []);

  const refreshList = React.useCallback(async () => {
    try {
      setConversations((await aiApi.conversations(ui.mode)).conversations);
    } catch {
      setConversations([]);
    }
  }, [ui.mode]);

  const refreshWorkspace = React.useCallback(async () => {
    if (ui.mode === "chat") return void setWorkspace(null);
    try {
      const w = await aiApi.workspace();
      setWorkspace({ files: w.files, diff: w.diff });
    } catch {
      setWorkspace(null);
    }
  }, [ui.mode]);

  React.useEffect(() => {
    if (!ui.open) return;
    void aiApi.status().then(setStatus).catch(() => setStatus(null));
    void refreshList();
    void refreshWorkspace();
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [ui.open, refreshList, refreshWorkspace]);

  React.useEffect(() => {
    if (!ui.open || ui.conversationId === null) return void setMessages([]);
    let cancelled = false;
    void aiApi
      .get(ui.conversationId)
      .then((r) => {
        if (cancelled) return;
        setMessages(r.messages);
        if (r.conversation.mode !== ui.mode) assistantUi.setMode(r.conversation.mode);
      })
      .catch(() => {
        if (!cancelled) assistantUi.setConversation(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.open, ui.conversationId]);

  React.useEffect(() => {
    if (ui.draft && ui.open) {
      setText((t) => (t ? `${t}\n${ui.draft!.text}` : ui.draft!.text));
      setContext(ui.draft.context);
      assistantUi.clearDraft();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [ui.draft, ui.open]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live?.text, live?.tools.length, ui.open]);

  const changeMode = (mode: AssistantMode) => {
    if (mode === ui.mode) return;
    assistantUi.setMode(mode);
    // A conversation belongs to a mode (its tools and working directory);
    // switching starts a fresh one rather than re-labelling the old.
    assistantUi.setConversation(null);
    setMessages([]);
    setShowList(false);
  };

  const newConversation = async () => {
    const r = await aiApi.create(ui.mode);
    assistantUi.setConversation(r.conversation.id);
    setMessages([]);
    setShowList(false);
    void refreshList();
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = text.trim();
    if (!content || live) return;
    let id = ui.conversationId;
    if (id === null) {
      const r = await aiApi.create(ui.mode);
      id = r.conversation.id;
      assistantUi.setConversation(id);
    }
    const ctx: PageContext = { ...context, url: context.url ?? location.pathname + location.search, title: context.title ?? document.title };
    setText("");
    setContext({});
    setMessages((m) => [...m, { id: -Date.now(), role: "user", content, createdAt: Date.now(), meta: { context: ctx } }]);
    const turn: LiveTurn = { text: "", status: "Connecting…", tools: [], error: null, changed: [] };
    setLive({ ...turn });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await streamTurn(
        id,
        content,
        ctx,
        (event, data) => {
          if (event === "text") turn.text += String(data.text ?? "");
          else if (event === "status") turn.status = String(data.text ?? "");
          else if (event === "tool") turn.tools.push({ name: String(data.name ?? ""), input: String(data.input ?? "") });
          else if (event === "error") turn.error = String(data.message ?? "Something went wrong");
          else if (event === "done") {
            turn.text = String(data.text ?? turn.text);
            turn.changed = Array.isArray(data.changed) ? (data.changed as string[]) : [];
          }
          setLive({ ...turn, tools: [...turn.tools] });
        },
        ac.signal
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") turn.error = (err as Error).message;
    } finally {
      abortRef.current = null;
      try {
        setMessages((await aiApi.get(id)).messages);
      } catch {
        /* keep the optimistic list */
      }
      void refreshList();
      void refreshWorkspace();
      if (turn.error) expenseUi.say(turn.error);
      setLive(null);
    }
  };

  const name = status?.assistantName ?? "Assistant";
  const backend = status ? (status.backends.subscription ? "Claude subscription" : status.backends.api ? "Claude API" : "not connected") : "";
  const connected = !!status && (status.backends.subscription || status.backends.api);

  return (
    <Drawer anchor="right" open={ui.open} onClose={() => assistantUi.close()} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 460 }, maxWidth: "100vw", background: token("page"), color: token("ink") } } }}>
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }} data-axf-assistant>
        {/* ---------------------------------------------------------- header */}
        <Stack direction="row" spacing={0.6} sx={{ alignItems: "center", p: "8px 8px 6px", borderBottom: `1px solid ${token("edge")}` }}>
          <Tooltip title="Conversations">
            <IconButton size="small" onClick={() => setShowList((v) => !v)} aria-label="Conversations" sx={{ color: showList ? token("accent") : token("ink") }}>
              <Glyph id="icon-history" size={16} />
            </IconButton>
          </Tooltip>
          <Glyph id="icon-sparkle" size={16} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.1 }}>{name}</Typography>
            <Typography sx={{ fontSize: 10.5, color: token("dim"), ...MONO }}>
              {backend}
              {status ? ` · ${status.model}` : ""}
            </Typography>
          </Box>
          <Tooltip title="New conversation">
            <IconButton size="small" onClick={() => void newConversation()} aria-label="New conversation">
              <Glyph id="icon-plus" size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Settings › AI">
            <IconButton
              size="small"
              onClick={() => {
                assistantUi.close();
                expenseUi.openSettings();
              }}
              aria-label="Assistant settings"
            >
              <Glyph id="icon-gear" size={16} />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={() => assistantUi.close()} aria-label="Close assistant">
            <Glyph id="icon-close" size={14} />
          </IconButton>
        </Stack>

        {/* ------------------------------------------------------ mode switch */}
        <Box sx={{ p: "6px 8px", borderBottom: `1px solid ${token("edge")}` }}>
          <ToggleButtonGroup size="small" exclusive value={ui.mode} onChange={(_, v: AssistantMode | null) => v && changeMode(v)} aria-label="Assistant mode" data-axf-assistant-mode={ui.mode} fullWidth sx={{ "& .MuiToggleButton-root": { textTransform: "none", fontSize: 12, py: 0.4 } }}>
            <ToggleButton value="chat">Chat</ToggleButton>
            <ToggleButton value="edit">Edit source</ToggleButton>
            <ToggleButton value="build">Build</ToggleButton>
          </ToggleButtonGroup>
          <Typography sx={{ fontSize: 10.5, color: token("dim"), mt: 0.4 }}>{MODE_HINT[ui.mode]}</Typography>
        </Box>

        {/* -------------------------------------------------- workspace strip */}
        {ui.mode !== "chat" && workspace && (
          <Box sx={{ px: 1, py: 0.6, borderBottom: `1px solid ${token("edge")}`, background: token("panel") }}>
            <Stack direction="row" spacing={0.8} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography sx={{ fontSize: 11.5 }}>
                Workspace:{" "}
                <Box component="span" sx={{ ...MONO, color: workspace.files.length ? token("warn") : token("dim") }}>
                  {workspace.files.length} file{workspace.files.length === 1 ? "" : "s"} changed
                </Box>
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" disabled={!workspace.files.length} onClick={() => setShowDiff((v) => !v)} sx={{ fontSize: 11, py: 0 }}>
                {showDiff ? "Hide diff" : "Diff"}
              </Button>
              <Button size="small" disabled={!workspace.files.length} component="a" href="/api/ai/workspace/patch" sx={{ fontSize: 11, py: 0 }}>
                Patch
              </Button>
              <Button
                size="small"
                color="inherit"
                disabled={!workspace.files.length}
                onClick={() => {
                  if (confirm("Discard every change in the workspace?")) void aiApi.resetWorkspace().then(refreshWorkspace);
                }}
                sx={{ fontSize: 11, py: 0, color: token("dim") }}
              >
                Reset
              </Button>
            </Stack>
            {showDiff && workspace.diff && (
              <Box component="pre" sx={{ m: "6px 0 0", maxHeight: 220, overflow: "auto", fontSize: 11, ...MONO, background: token("panel2"), p: 1, borderRadius: 1, whiteSpace: "pre" }}>
                {workspace.diff.slice(0, 60000)}
              </Box>
            )}
          </Box>
        )}

        {/* --------------------------------------------------------- body */}
        {showList ? (
          <Box sx={{ flex: 1, overflow: "auto" }}>
            {conversations.length === 0 ? (
              <Typography sx={{ p: 2, fontSize: 12.5, color: token("dim") }}>No {MODE_LABEL[ui.mode].toLowerCase()} conversations yet.</Typography>
            ) : (
              conversations.map((c) => (
                <Stack key={c.id} direction="row" sx={{ alignItems: "center", px: 1, py: 0.5, borderBottom: `1px solid ${token("edge")}`, background: c.id === ui.conversationId ? token("panel") : undefined }}>
                  <Box
                    component="button"
                    onClick={() => {
                      assistantUi.setConversation(c.id);
                      setShowList(false);
                    }}
                    sx={{ flex: 1, textAlign: "left", background: "none", border: 0, color: "inherit", cursor: "pointer", p: 0.4, font: "inherit" }}
                  >
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</Typography>
                    <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
                      {c.messages} messages · {new Date(c.updatedAt).toLocaleDateString()}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    aria-label="Delete conversation"
                    onClick={() => {
                      if (confirm("Delete this conversation?"))
                        void aiApi.remove(c.id).then(() => {
                          if (ui.conversationId === c.id) assistantUi.setConversation(null);
                          void refreshList();
                        });
                    }}
                  >
                    <Glyph id="icon-trash" size={13} />
                  </IconButton>
                </Stack>
              ))
            )}
          </Box>
        ) : (
          <Box sx={{ flex: 1, overflow: "auto", p: 1.2, display: "flex", flexDirection: "column", gap: 1 }}>
            {status && !connected && (
              <Alert
                severity="warning"
                sx={{ fontSize: 12 }}
                action={
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => {
                      assistantUi.close();
                      expenseUi.openSettings();
                    }}
                  >
                    Settings
                  </Button>
                }
              >
                Not connected yet. Add a Claude subscription token or an API key in Settings › AI.
              </Alert>
            )}
            {messages.length === 0 && !live && (
              <Box sx={{ textAlign: "center", py: 3, px: 1 }}>
                <Glyph id="icon-sparkle" size={28} />
                <Typography sx={{ fontSize: 14, fontWeight: 700, mt: 1 }}>Ask {name} anything about this app</Typography>
                <Typography sx={{ fontSize: 12, color: token("dim"), mt: 0.5 }}>
                  {MODE_HINT[ui.mode]} It reads the real source{status ? ` (snapshot ${status.sourceVersion})` : ""}.
                </Typography>
                <Stack direction="row" spacing={0.6} useFlexGap sx={{ flexWrap: "wrap", justifyContent: "center", mt: 1.5 }}>
                  {SUGGESTIONS[ui.mode].map((s) => (
                    <Chip key={s} size="small" variant="outlined" label={s} onClick={() => setText(s)} sx={{ height: "auto", "& .MuiChip-label": { whiteSpace: "normal", py: 0.4 } }} />
                  ))}
                </Stack>
              </Box>
            )}
            {messages.map((m) => (
              <Bubble key={m.id} role={m.role} selection={m.meta.context?.selection} meta={m.role === "assistant" ? m.meta : undefined}>
                {m.role === "assistant" ? <Markdown text={m.content} /> : <Typography sx={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.content}</Typography>}
              </Bubble>
            ))}
            {live && (
              <Bubble role="assistant">
                {live.tools.length > 0 && (
                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap", mb: 0.6 }}>
                    {live.tools.slice(-6).map((t, i) => (
                      <Chip key={i} size="small" variant="outlined" label={`${t.name}${t.input ? `: ${t.input}` : ""}`} sx={{ height: 20, fontSize: 10.5, maxWidth: 260 }} />
                    ))}
                  </Stack>
                )}
                {live.text ? <Markdown text={live.text} /> : <Typography sx={{ fontSize: 12, color: token("dim") }}>{live.status}</Typography>}
                {live.error && <Typography sx={{ fontSize: 12, color: token("err") }}>{live.error}</Typography>}
              </Bubble>
            )}
            <div ref={endRef} />
          </Box>
        )}

        {/* -------------------------------------------------------- compose */}
        <Box component="form" onSubmit={(e: React.FormEvent) => void send(e)} sx={{ p: 1, borderTop: `1px solid ${token("edge")}` }}>
          {(context.selection || context.element) && (
            <Chip size="small" variant="outlined" onDelete={() => setContext({})} label={context.element ? `Element: ${context.element}` : `Selection: “${context.selection!.slice(0, 80)}”`} sx={{ mb: 0.6, maxWidth: "100%" }} />
          )}
          <Stack direction="row" spacing={0.8} sx={{ alignItems: "flex-end" }}>
            <TextField
              inputRef={inputRef}
              multiline
              minRows={2}
              maxRows={6}
              size="small"
              fullWidth
              value={text}
              disabled={!!live}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={`Message ${name}… (Enter to send, Shift+Enter for a new line)`}
              slotProps={{ htmlInput: { "data-axf-assistant-input": "" } }}
            />
            {live ? (
              <Tooltip title="Stop">
                <IconButton onClick={() => abortRef.current?.abort()} aria-label="Stop">
                  <Glyph id="icon-stop" size={16} />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip title="Send">
                <span>
                  <IconButton type="submit" disabled={!text.trim()} aria-label="Send" sx={{ color: token("accent") }}>
                    <Glyph id="icon-send" size={16} />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Stack>
        </Box>
      </Box>
    </Drawer>
  );
}

function Bubble({ role, children, selection, meta }: { role: "user" | "assistant"; children: React.ReactNode; selection?: string; meta?: AiMessage["meta"] }) {
  const ai = role === "assistant";
  return (
    <Box sx={{ display: "flex", gap: 0.8, alignItems: "flex-start", flexDirection: ai ? "row" : "row-reverse" }}>
      <Box sx={{ width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center", background: ai ? token("panel2") : token("accent"), color: ai ? token("ink") : token("page"), flexShrink: 0, fontSize: 10, fontWeight: 700 }}>
        {ai ? <Glyph id="icon-sparkle" size={13} /> : "you"}
      </Box>
      <Box sx={{ maxWidth: "88%", minWidth: 0, p: "6px 10px", borderRadius: 1.5, background: ai ? token("panel") : `color-mix(in srgb, ${token("accent")} 16%, ${token("panel")})`, border: `1px solid ${token("edge")}` }}>
        {children}
        {selection && <Typography sx={{ fontSize: 11, color: token("dim"), mt: 0.4 }}>“{selection.slice(0, 160)}”</Typography>}
        {meta && (meta.backend || meta.tools?.length || meta.changed?.length) ? (
          <Typography sx={{ fontSize: 10.5, color: token("dim"), mt: 0.5, ...MONO }}>
            {meta.backend === "subscription" ? "subscription" : meta.backend === "api" ? "API" : ""}
            {meta.tools?.length ? ` · ${meta.tools.filter((t) => !t.startsWith("changed:")).length} tool calls` : ""}
            {meta.changed?.length ? ` · changed ${meta.changed.join(", ")}` : ""}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
