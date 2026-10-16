/**
 * @file MESSAGES — the studio's internal messenger: a thread list down the
 * left, the open conversation on the right, and a members picker that turns
 * "somebody I have never written to" into a thread.
 *
 * The shape is the proven one from the reference module (GizmoX
 * `src/modules/amberxvid/Messenger.tsx`, read never imported) with its engine
 * half removed — that engine is the P3 store, which already holds the SSE
 * stream, the summaries, the unread total, the open conversation and the
 * optimistic send. This file is the surface over it and holds no channel of
 * its own.
 *
 * ── who marks a thread read ─────────────────────────────────────────────────
 *
 * The store, both times, and that is on purpose. Opening a conversation goes
 * through `openThread()` (`markRead=1` on the same request that fetches the
 * history — the window is open on it, which is what reading IS), and a message
 * arriving on the stream while the window is open is stamped by
 * `#applyMessage` before it is ever rendered. A pane that also fired a
 * mark-read would be a second writer racing the first for no gain.
 *
 * The one thing this pane MUST do is `closeThread()` on unmount — see the
 * comment on that effect. "Open" is a claim about a window, and the store
 * cannot see windows.
 *
 * ── the two channels, and what this pane adds ───────────────────────────────
 *
 * The presence stream is primary; the store's poll loop is the fallback and
 * refreshes the thread SUMMARIES. The open conversation is this pane's, so
 * while `streamLive` is false it re-reads the open thread on the same
 * `messagePollSeconds` cadence — otherwise the list would tick over while the
 * conversation being read sat still. The header says which channel is live,
 * because "my message never arrived" and "the socket is down" look identical
 * from the outside otherwise.
 *
 * Settings honoured: `denseTables` tightens the thread rows and the bubbles.
 * `showOfflineMembers` filters the NEW-MESSAGE picker only — never the thread
 * list. A conversation hidden because its owner logged off is a message the
 * reader cannot find, and this setting is about screen space, not delivery.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";

import { Glyph, token } from "@axf/core";

import { AvatarView, loadProfiles, type ProfileRow } from "./profileClient";
import { useAccountsSettings } from "./settings";
import { accountsStore, useAccountsState, type ThreadRow } from "./store";
import { MESSAGE_MAX, type Message } from "./lib/types";

const lower = (u: string): string => u.trim().toLowerCase();

/** Clock for a message, date only when it is not today — the reference's rule:
 *  a timestamp on every bubble is noise, a date on yesterday's is the point. */
function fmtWhen(iso: string): string {
  const at = new Date(iso);
  const today = new Date();
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  return sameDay
    ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : `${at.toLocaleDateString()} ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** One line of the last message, whoever sent it. */
function preview(m: Message | null, meUser: string): string {
  if (!m) return "No messages yet";
  const mine = lower(m.from) === lower(meUser);
  const text = m.text.replace(/\s+/g, " ").trim();
  return `${mine ? "You: " : ""}${text.length > 60 ? `${text.slice(0, 60)}…` : text}`;
}

/** The avatar with a presence dot on it — MUI's own overlap badge, so the dot
 *  sits on the crop rather than being hand-positioned beside it. */
function PresenceAvatar({
  profile,
  name,
  online,
  size,
}: {
  profile: ProfileRow | undefined;
  name: string;
  online: boolean;
  size: number;
}) {
  return (
    <Badge
      overlap="circular"
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      variant="dot"
      color={online ? "success" : "default"}
      title={online ? "Online" : "Offline"}
      sx={{
        "& .MuiBadge-badge": {
          boxShadow: `0 0 0 2px ${token("panel")}`,
          ...(online ? {} : { background: token("dim"), opacity: 0.7 }),
        },
      }}
    >
      <AvatarView avatar={profile?.avatar ?? null} name={name} size={size} />
    </Badge>
  );
}

/* ------------------------------ new-message picker ------------------------------ */

function NewMessageDialog({
  profiles,
  onPick,
  onClose,
}: {
  profiles: Map<string, ProfileRow>;
  onPick: (username: string) => void;
  onClose: () => void;
}) {
  const { users, session, presence } = useAccountsState();
  const settings = useAccountsSettings();
  const [filter, setFilter] = React.useState("");

  const onlineBy = React.useMemo(
    () => new Map(presence.map((p) => [lower(p.username), p.online])),
    [presence],
  );

  const needle = filter.trim().toLowerCase();
  const candidates = users.filter((u) => {
    if (lower(u.username) === lower(session?.username ?? "")) return false;
    // A disabled account cannot sign in, so it cannot answer — it is not a
    // recipient, whoever is looking. (Only administrators see one here at all.)
    if (u.disabled) return false;
    if (!settings.showOfflineMembers && !(onlineBy.get(lower(u.username)) ?? false)) return false;
    if (!needle) return true;
    return (
      u.username.toLowerCase().includes(needle) || (u.screenname ?? "").toLowerCase().includes(needle)
    );
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>New message</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ p: 1.5 }}>
          <TextField
            placeholder="Search members…"
            size="small"
            fullWidth
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </Box>
        <List dense disablePadding>
          {candidates.map((u) => {
            const p = profiles.get(lower(u.username));
            const name = u.screenname ?? u.username;
            return (
              <ListItemButton key={u.username} onClick={() => onPick(u.username)}>
                <ListItemAvatar sx={{ minWidth: 44 }}>
                  <PresenceAvatar
                    profile={p}
                    name={name}
                    online={onlineBy.get(lower(u.username)) ?? false}
                    size={30}
                  />
                </ListItemAvatar>
                <ListItemText
                  primary={name}
                  secondary={u.username}
                  slotProps={{
                    primary: { sx: { fontSize: 13, fontWeight: 600 } },
                    secondary: { sx: { fontSize: 11, fontFamily: token("mono") } },
                  }}
                />
              </ListItemButton>
            );
          })}
        </List>
        {candidates.length === 0 && (
          <Typography sx={{ fontSize: 12.5, color: token("dim"), p: 2 }}>
            {users.length <= 1
              ? "You are the only member so far — an administrator adds members on the Members tab."
              : needle
                ? `No member matches “${filter.trim()}”.`
                : "Nobody else is online. Switch “show offline members” back on in the module settings to write to somebody who is away — their messages queue and deliver at their next sign-in."}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* -------------------------------- the conversation ------------------------------- */

function Conversation({
  peer,
  peerName,
  online,
  profile,
  dense,
  canMessage,
}: {
  peer: string;
  peerName: string;
  online: boolean;
  profile: ProfileRow | undefined;
  dense: boolean;
  canMessage: boolean;
}) {
  const { openThread, session, saveError, streamLive } = useAccountsState();
  const settings = useAccountsSettings();
  const theme = useTheme();

  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);

  const messages = openThread?.messages ?? [];
  const count = messages.length;

  // Follow the bottom as messages land — both the optimistic send and an
  // arrival on the stream.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  // The fallback cadence for the OPEN conversation. The store's poll refreshes
  // the summaries; without this the list would tick over while the thread being
  // read sat still. `openThread` re-stamps the read mark, which is correct —
  // the window is open on it.
  React.useEffect(() => {
    if (streamLive) return;
    const seconds = Math.max(1, settings.messagePollSeconds);
    const timer = setInterval(() => void accountsStore.openThread(peer), seconds * 1000);
    return () => clearInterval(timer);
  }, [streamLive, settings.messagePollSeconds, peer]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const res = await accountsStore.sendMessage(peer, text);
    setSending(false);
    if (res.ok) {
      setDraft("");
      inputRef.current?.focus();
    }
  };

  const mineTint = alpha(theme.palette.primary.main, 0.22);
  const theirsTint = theme.palette.background.paper;
  const nearLimit = draft.length > MESSAGE_MAX * 0.8;

  return (
    <Stack sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      {/* --------------------------------- header -------------------------------- */}
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          gap: 1.25,
          px: 1.5,
          py: 1,
          borderBottom: `1px solid ${token("edge")}`,
          flexShrink: 0,
        }}
      >
        <PresenceAvatar profile={profile} name={peerName} online={online} size={32} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.2 }}>{peerName}</Typography>
          <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
            {online
              ? "online — delivery is live"
              : "offline — messages queue and deliver at their next sign-in"}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Tooltip
          title={
            streamLive
              ? "The presence stream is up — messages arrive as they are sent"
              : `The presence stream is down — polling every ${settings.messagePollSeconds}s`
          }
        >
          <Typography sx={{ fontSize: 10.5, color: streamLive ? token("ok") : token("warn") }}>
            {streamLive ? "live" : "polling"}
          </Typography>
        </Tooltip>
      </Stack>

      {/* -------------------------------- messages ------------------------------- */}
      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          p: 1.5,
          display: "flex",
          flexDirection: "column",
          gap: dense ? 0.5 : 0.9,
        }}
      >
        {messages.length === 0 && (
          <Stack sx={{ alignItems: "center", gap: 1, py: 5, opacity: 0.8 }}>
            <Glyph id="icon-chat" size={30} />
            <Typography sx={{ fontSize: 12.5, color: token("dim"), textAlign: "center", maxWidth: 380 }}>
              No messages yet — say hello. History is kept per pair, and anything you send while{" "}
              {peerName} is offline queues and delivers at their next sign-in.
            </Typography>
          </Stack>
        )}

        {messages.map((m) => {
          const mine = lower(m.from) === lower(session?.username ?? "");
          const queued = mine && m.deliveredAt === null;
          return (
            <Box
              key={m.id}
              sx={{
                alignSelf: mine ? "flex-end" : "flex-start",
                maxWidth: "82%",
                px: 1.25,
                py: dense ? 0.5 : 0.75,
                borderRadius: mine ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                background: mine ? mineTint : theirsTint,
                border: `1px solid ${mine ? alpha(theme.palette.primary.main, 0.45) : token("edge")}`,
              }}
            >
              <Typography
                sx={{ fontSize: dense ? 12 : 12.75, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {m.text}
              </Typography>
              <Typography
                sx={{
                  fontSize: 9.5,
                  color: queued ? token("warn") : token("dim"),
                  mt: 0.25,
                  textAlign: mine ? "right" : "left",
                }}
              >
                {fmtWhen(m.sentAt)}
                {mine && (queued ? " · queued" : " · delivered")}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* -------------------------------- composer ------------------------------- */}
      {saveError && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12, mx: 1.5, mb: 1 }}>
          {saveError}
        </Alert>
      )}
      {!canMessage && (
        <Alert severity="info" variant="outlined" sx={{ fontSize: 12, mx: 1.5, mb: 1 }}>
          An administrator has switched messaging off for your account — you can read this
          conversation but not add to it.
        </Alert>
      )}
      <Stack
        direction="row"
        sx={{
          gap: 1,
          alignItems: "flex-end",
          p: 1.25,
          borderTop: `1px solid ${token("edge")}`,
          flexShrink: 0,
        }}
      >
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={5}
          disabled={!canMessage}
          placeholder={`Message ${peerName}… (Enter sends, Shift+Enter for a new line)`}
          value={draft}
          inputRef={inputRef}
          onChange={(e) => setDraft(e.target.value.slice(0, MESSAGE_MAX))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          helperText={
            nearLimit ? `${draft.length} / ${MESSAGE_MAX} characters — the cap is close` : undefined
          }
        />
        {/* No `icon-send` exists in the glyph contract, and a surface may name
            CONTRACT ids only — so the send affordance is a labelled MUI button
            rather than a plausible-looking id nothing draws. */}
        <Button
          variant="contained"
          disabled={!canMessage || !draft.trim() || sending}
          onClick={() => void send()}
          sx={{ textTransform: "none", flexShrink: 0, mb: nearLimit ? 2.5 : 0 }}
        >
          Send
        </Button>
      </Stack>
    </Stack>
  );
}

/* ---------------------------------- the pane ------------------------------------ */

export default function MessengerPane() {
  const { threads, session, users, presence, permissions, openThread } = useAccountsState();
  const settings = useAccountsSettings();

  const [profiles, setProfiles] = React.useState<Map<string, ProfileRow>>(new Map());
  const [picking, setPicking] = React.useState(false);

  const canMessage = permissions?.administrator === true || permissions?.canMessage === true;

  // CLOSING THE WINDOW IS PART OF THE CONTRACT, and it cost a live run to
  // learn. `#applyMessage` decides whether an arriving message is unread by
  // asking whether its thread is the OPEN one — which is exactly right while
  // this pane is on screen and exactly wrong once it is not. Leaving the tab
  // used to leave `openThread` set, so every later message from that member
  // was silently auto-read: no badge on the rail, no badge on the row, and a
  // conversation the reader had no way to know had moved. The window is this
  // pane; when it goes, nothing is open.
  React.useEffect(() => () => accountsStore.closeThread(), []);

  // Avatars come from the profile engine, refreshed when the directory changes
  // (a new member is the only thing that adds a face this pane has never seen).
  React.useEffect(() => {
    let live = true;
    void loadProfiles().then((res) => {
      if (!live || !res.ok) return;
      setProfiles(new Map(res.profiles.map((p) => [lower(p.username), p])));
    });
    return () => {
      live = false;
    };
  }, [users.length]);

  const onlineBy = React.useMemo(() => {
    const map = new Map(presence.map((p) => [lower(p.username), p.online]));
    // Without a live stream there is no roster event, so the messages route's
    // per-thread flag is the honest fallback (the store's own note).
    for (const t of threads) {
      if (t.kind !== "dm" || map.has(lower(t.with))) continue;
      map.set(lower(t.with), t.online === true);
    }
    return map;
  }, [presence, threads]);

  const nameOf = React.useCallback(
    (username: string): string => {
      const account = users.find((u) => lower(u.username) === lower(username));
      return (
        account?.screenname ?? profiles.get(lower(username))?.screenname ?? username
      );
    },
    [users, profiles],
  );

  const open = (username: string) => {
    setPicking(false);
    void accountsStore.openThread(username);
  };

  /**
   * `?peer=` — where *Message user* on the member context menu lands (P10).
   *
   * Applied once, after the session probe answers: `openThread` is a fetch
   * against a route that needs the cookie resolved, and a conversation opened
   * before the store knows who it is would be opened as nobody. Once the person
   * has clicked a thread themselves, their click wins — the same posture
   * `AccountsModule` takes with `?surface=`.
   */
  const appliedPeer = React.useRef(false);
  React.useEffect(() => {
    if (appliedPeer.current || !session) return;
    const asked = new URLSearchParams(window.location.search).get("peer");
    appliedPeer.current = true;
    if (asked && lower(asked) !== lower(session.username)) void accountsStore.openThread(asked);
  }, [session]);

  const peer = openThread
    ? openThread.participants.find((p) => lower(p) !== lower(session?.username ?? "")) ?? null
    : null;

  // DMs only. The thread store carries groups as of P5 and the route serves
  // them, but this pane is peer-driven end to end — the row, the avatar, the
  // header and the composer all take a username. Rendering a group here would
  // be a row that opens nothing; the group skin is P6's, and until it lands a
  // group is reachable through `/api/accounts/messages?thread=<id>` and not
  // through a half-built surface.
  const sorted: ThreadRow[] = React.useMemo(
    () =>
      threads
        .filter((t) => t.kind === "dm")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [threads],
  );

  const dense = settings.denseTables;

  return (
    <Stack direction="row" sx={{ height: "100%", minHeight: 0 }}>
      {/* ------------------------------ thread list ------------------------------ */}
      <Stack
        sx={{
          width: 268,
          flexShrink: 0,
          minHeight: 0,
          borderRight: `1px solid ${token("edge")}`,
        }}
      >
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, px: 1.5, py: 1 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Conversations</Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Glyph id="icon-plus" size={12} />}
            onClick={() => setPicking(true)}
            sx={{ textTransform: "none", fontSize: 12 }}
          >
            New
          </Button>
        </Stack>
        <Divider />
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <List dense={dense} disablePadding>
            {sorted.map((t) => {
              const name = nameOf(t.with);
              return (
                <ListItemButton
                  key={t.id}
                  selected={openThread?.id === t.id}
                  onClick={() => open(t.with)}
                  // A thread row is a MEMBER (P10) — the same area the admin
                  // roster and the directory mark, so the same five rows appear
                  // wherever a person is on screen. That sameness is the point:
                  // a menu whose contents depend on which list you found
                  // somebody in is the inconsistency the area walk ended.
                  data-axf-area="accounts.user-row"
                  data-axf-user={t.with}
                  sx={{ alignItems: "flex-start", gap: 0.5 }}
                >
                  <ListItemAvatar sx={{ minWidth: 46 }}>
                    <PresenceAvatar
                      profile={profiles.get(lower(t.with))}
                      name={name}
                      online={onlineBy.get(lower(t.with)) ?? false}
                      size={dense ? 30 : 34}
                    />
                  </ListItemAvatar>
                  <ListItemText
                    primary={name}
                    secondary={preview(t.lastMessage, session?.username ?? "")}
                    slotProps={{
                      primary: { sx: { fontSize: 13, fontWeight: t.unread ? 700 : 600 } },
                      secondary: {
                        sx: {
                          fontSize: 11.5,
                          color: t.unread ? token("ink") : token("dim"),
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        },
                      },
                    }}
                  />
                  {t.unread > 0 && (
                    <Badge
                      badgeContent={t.unread}
                      color="primary"
                      sx={{ mt: 1.25, mr: 1.25, "& .MuiBadge-badge": { fontSize: 10 } }}
                    />
                  )}
                </ListItemButton>
              );
            })}
          </List>
          {sorted.length === 0 && (
            <Typography sx={{ fontSize: 12.5, color: token("dim"), p: 2 }}>
              No conversations yet. Pick a member with “New” — everyone in the studio is
              reachable, online or not.
            </Typography>
          )}
        </Box>
      </Stack>

      {/* ------------------------------ conversation ----------------------------- */}
      {peer ? (
        <Conversation
          peer={peer}
          peerName={nameOf(peer)}
          online={onlineBy.get(lower(peer)) ?? false}
          profile={profiles.get(lower(peer))}
          dense={dense}
          canMessage={canMessage}
        />
      ) : (
        <Stack sx={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 1.5, p: 4 }}>
          <Glyph id="icon-chat" size={34} />
          <Typography sx={{ fontSize: 13, color: token("dim"), textAlign: "center", maxWidth: 400 }}>
            {sorted.length === 0
              ? "Nothing here yet. Start a conversation with any member — messages sent to somebody who is offline queue and deliver at their next sign-in."
              : "Pick a conversation on the left, or start a new one."}
          </Typography>
          <Button
            variant="contained"
            startIcon={<Glyph id="icon-plus" size={12} />}
            onClick={() => setPicking(true)}
            sx={{ textTransform: "none" }}
          >
            New message
          </Button>
        </Stack>
      )}

      {picking && (
        <NewMessageDialog profiles={profiles} onPick={open} onClose={() => setPicking(false)} />
      )}
    </Stack>
  );
}
