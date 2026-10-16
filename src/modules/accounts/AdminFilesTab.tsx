/**
 * @file The Files tab — **a read-only browser over one member's registered data
 * roots**: the rail and tree on the left, one file's preview on the right.
 *
 * ## The banner is part of the feature, not decoration
 *
 * A persistent, undismissable line at the top of the tab says that every view
 * and every download here is written to the audit log. The GUARANTEE is the
 * server's — `app/api/accounts/admin/files` records the act before a byte moves
 * and refuses with a 500 if the record cannot be written — and nothing on this
 * side could weaken it if it tried. What this side owes is that an
 * administrator cannot look at somebody's private data while forgetting that
 * the looking is itself on the record. So the banner has no close button, and
 * it must not grow one.
 *
 * ## Read-only, and the UI must not hint otherwise
 *
 * There is no rename, no delete, no upload, no new-folder, and no disabled
 * button promising one later. A greyed-out delete is a promise that the reach
 * is temporarily read-only; it is not. Destroying a member's data stays on the
 * Dashboard tab's typed-confirmation dialog, which is a different act with a
 * different gate.
 *
 * ## Lazy by construction
 *
 * A root's contents are fetched when it is expanded, a directory's when IT is
 * expanded, and never recursively — `listDir` stats one level, so opening a
 * folder costs the folder rather than the subtree. A member with a deep vault
 * is therefore as cheap to open as an empty one, and — the reason that matters
 * here — an administrator who expands nothing has read nothing, so the trail
 * carries exactly the directories they actually opened.
 *
 * Shared roots (`profile`, `credits`, `messages`) come back `flat: true`: one
 * directory of everybody's documents, filtered to this member by the registry's
 * own `owns` predicate. They have no subdirectories, so the tree does not offer
 * one, and the rail says whose bytes they also are.
 *
 * ## What "preview" means per kind
 *
 * - **text** — the head of the file, rendered as text; JSON is re-indented when
 *   it parses, and left exactly as it is when it does not, because a file that
 *   fails to parse is the one you most need to see verbatim.
 * - **images** — inline, through the download endpoint. That WRITES a download
 *   record, and it should: the bytes genuinely left the machine.
 * - **anything else** — its stat and a download button. No hex dump, no
 *   attempt to render bytes that have no rendering.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, PaneLayout, definePanes, token } from "@axf/core";

import { onAccountsCtx } from "./accounts.commands";
import {
  fetchDirListing,
  fetchFilePreview,
  fetchFileRoots,
  fetchUserPage,
  fileDownloadUrl,
  fmtBytes,
  fmtWhen,
  type BrowseEntryWire,
  type FilePreviewWire,
  type RootInfoWire,
} from "./adminApi";

/** Module-scope, as the layout contract requires — a tree built in the render
 *  body is a new object every pass and the latch never settles. */
const TREE = definePanes({
  kind: "split",
  direction: "row",
  weights: [42, 58],
  children: [
    { kind: "pane", id: "tree", minSize: 300 },
    { kind: "pane", id: "preview", minSize: 320 },
  ],
});

/** How many members the picker lists. The roster's own order, and it says so
 *  when it stopped short — a truncated picker that stays quiet reads as "those
 *  are all the members". */
const ROSTER_LIMIT = 200;

/** Extensions the preview pane renders as a picture. Deliberately the subset of
 *  `lib/browse.ts`'s content-type map that a browser draws in an `<img>`; SVG is
 *  in it because an `<img>` will not run script in one, which is the property
 *  that makes it safe to show a member's own file. */
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

const extOf = (p: string): string => {
  const dot = p.lastIndexOf(".");
  const slash = p.lastIndexOf("/");
  return dot > slash ? p.slice(dot).toLowerCase() : "";
};

const isImage = (p: string): boolean => IMAGE_EXT.has(extOf(p));

/** The cache and expansion key for one directory. `""` is the root itself. */
const keyOf = (rootId: string, rel: string): string => `${rootId}:${rel}`;

const baseName = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/**
 * A directory's mark; files get none.
 *
 * The branding contract (`REQUIRED_GLYPH_IDS`) has one storage glyph —
 * `icon-folder` — and no per-type file icons, and a surface may name CONTRACT
 * ids only. Inventing `icon-json` here would have passed `check:glyphs`, which
 * only sees a glyph id spelled as a literal in the JSX, and then rendered
 * nothing at all in the browser: a scanner-shaped hole rather than a caught
 * mistake — which is how this comment came to be written. Dressing a PNG
 * in the nearest available drawing would be worse — a wrong icon reads as a
 * fact. So the row says what it is with its name, its size and its extension,
 * and only folders carry a mark.
 */
const DIR_GLYPH = "icon-folder";

interface Selection {
  rootId: string;
  /** Relative to the root, forward-slashed. */
  path: string;
}

/* ================================== the tree ================================== */

interface TreeRowProps {
  depth: number;
  /** Absent for a file — see {@link DIR_GLYPH}. */
  glyph?: string;
  label: string;
  /** Undefined for a leaf — no chevron, no toggle. */
  open?: boolean;
  selected?: boolean;
  busy?: boolean;
  right?: React.ReactNode;
  muted?: boolean;
  onClick: () => void;
  /**
   * What this row IS, for the context menu (P10) — the member whose tree this
   * is, the root, the path inside it, and whether it is a file or a folder.
   *
   * Carried by every row including a root, because `accounts.file-row`'s three
   * rows have to be able to say "that is a folder, not a file" rather than
   * disappearing on one. `owner` is on the row rather than harvested from an
   * ancestor for the reason the tab's own header gives about throwing the tree
   * away when the member changes: a stale row under a new name is one person's
   * filename under another person's account.
   */
  target?: { owner: string; root: string; path: string; kind: "file" | "dir" };
}

function TreeRow({ depth, glyph, label, open, selected, busy, right, muted, onClick, target }: TreeRowProps) {
  return (
    <Stack
      direction="row"
      onClick={onClick}
      /* A STATIC marker, not `target ? … : undefined`.
       *
       * `ctx-conformance` scans the tree for `data-axf-area` literals and
       * reported this area as "declared and carries rows, but no .tsx marks it
       * — a menu nobody can open", because a computed marker cannot be read
       * statically. The conditional was defensive rather than real: both
       * `<TreeRow>` call sites pass `target`, and this component's own prop
       * docblock says it is "carried by every row including a root". So the
       * branch never chose `undefined` in practice and marking unconditionally
       * changes no behaviour — it only makes the fact legible to the gate. */
      data-axf-area="accounts.file-row"
      data-axf-file-owner={target?.owner}
      data-axf-file-root={target?.root}
      data-axf-file-path={target?.path}
      data-axf-file-kind={target?.kind}
      sx={{
        alignItems: "center",
        gap: 0.75,
        pl: 0.5 + depth * 1.5,
        pr: 0.75,
        py: 0.35,
        borderRadius: token("radius"),
        cursor: "pointer",
        background: selected ? token("panel2") : "transparent",
        "&:hover": { background: token("panel2") },
      }}
    >
      <Box sx={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {busy ? (
          <CircularProgress size={10} />
        ) : open === undefined ? null : (
          <Box
            sx={{
              display: "flex",
              // The contract's chevron points DOWN, which is the open state; a
              // closed row turns it to point at the row it would reveal.
              transform: open ? "none" : "rotate(-90deg)",
              transition: "transform 120ms",
            }}
          >
            <Glyph id="icon-chevron-down" size={10} />
          </Box>
        )}
      </Box>
      <Box sx={{ width: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {glyph ? <Glyph id={glyph} size={13} /> : null}
      </Box>
      <Typography
        sx={{
          fontSize: 12,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: muted ? token("dim") : undefined,
          fontWeight: selected ? 600 : 400,
        }}
      >
        {label}
      </Typography>
      {right}
    </Stack>
  );
}

/* ================================ the preview ================================= */

/** JSON re-indented when it parses, and untouched when it does not. */
function prettyIfJson(path: string, text: string): string {
  if (extOf(path) !== ".json") return text;
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

function PreviewPane({
  user,
  selection,
  preview,
  busy,
  error,
}: {
  user: string;
  selection: Selection | null;
  preview: FilePreviewWire | null;
  busy: boolean;
  error: string | null;
}) {
  if (!selection) {
    return (
      <Typography sx={{ fontSize: 12, color: token("dim") }}>
        Pick a file on the left to read it here. Opening one records a view in the audit trail
        against your name and this member’s.
      </Typography>
    );
  }

  const href = fileDownloadUrl(user, selection.rootId, selection.path);

  return (
    <Stack sx={{ gap: 1, minHeight: 0 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, fontFamily: token("mono") }}>
          {baseName(selection.path)}
        </Typography>
        <Typography sx={{ fontSize: 10.5, color: token("dim"), fontFamily: token("mono") }}>
          {selection.rootId}/{selection.path}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Sends the bytes to your browser — and writes a download record first">
          <Button
            component="a"
            href={href}
            size="small"
            variant="outlined"
            sx={{ fontSize: 11.5, textTransform: "none" }}
          >
            Download
          </Button>
        </Tooltip>
      </Stack>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
          {error}
        </Alert>
      )}

      {busy && <CircularProgress size={18} />}

      {preview && !busy && (
        <>
          <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", alignItems: "center" }}>
            <Chip
              size="small"
              variant="outlined"
              label={fmtBytes(preview.bytes)}
              sx={{ height: 19, fontSize: 10.5 }}
            />
            <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
              modified {fmtWhen(preview.modifiedAt, "unknown")}
            </Typography>
            {preview.truncated && (
              <Typography sx={{ fontSize: 10.5, color: token("warn") }}>
                showing the head of the file only — download it for the rest
              </Typography>
            )}
          </Stack>

          {isImage(preview.path) ? (
            <Stack sx={{ gap: 0.5 }}>
              <Box
                component="img"
                src={href}
                alt={baseName(preview.path)}
                sx={{
                  maxWidth: "100%",
                  maxHeight: 420,
                  objectFit: "contain",
                  alignSelf: "flex-start",
                  border: `1px solid ${token("edge")}`,
                  borderRadius: token("radius"),
                  background: token("panel2"),
                }}
              />
              <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
                Drawing it here moved the bytes, so the trail records a download as well as a view.
              </Typography>
            </Stack>
          ) : preview.binary || preview.text === null ? (
            <Box
              sx={{
                border: `1px dashed ${token("edge")}`,
                borderRadius: token("radius"),
                p: 2,
                maxWidth: 520,
              }}
            >
              <Typography sx={{ fontSize: 12.5 }}>
                Not text, and not a picture this can draw. Its size and timestamp are above; the
                download button hands you the file itself.
              </Typography>
            </Box>
          ) : (
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.25,
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                border: `1px solid ${token("edge")}`,
                borderRadius: token("radius"),
                background: token("panel2"),
                fontFamily: token("mono"),
                fontSize: 11.5,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {prettyIfJson(preview.path, preview.text)}
            </Box>
          )}
        </>
      )}
    </Stack>
  );
}

/* ================================== the tab =================================== */

export default function AdminFilesTab() {
  const [names, setNames] = React.useState<string[]>([]);
  const [rosterTotal, setRosterTotal] = React.useState(0);
  const [rosterError, setRosterError] = React.useState<string | null>(null);
  /**
   * `?user=` — where *View files* on the member context menu lands (P10).
   *
   * The INITIALISER rather than an effect, unusually for this codebase, and for
   * a specific reason: the roots effect below keys on `user` and throws the tree
   * away whenever it changes, so setting the member one render late would fetch
   * the empty selection's nothing and then immediately discard it. Reading
   * `window.location` in an initialiser is safe here because this tab is inside
   * the admin suite, which only ever mounts on the client — but it is a
   * `useState` initialiser, so it must stay a pure read.
   */
  const [user, setUser] = React.useState(() =>
    typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("user") ?? ""),
  );

  const [roots, setRoots] = React.useState<RootInfoWire[] | null>(null);
  const [rootsError, setRootsError] = React.useState<string | null>(null);

  /** Listings, by `root:rel`. A key that is present has been read; a key that is
   *  absent has not, which is what makes the fetch happen once per directory. */
  const [listings, setListings] = React.useState<Record<string, BrowseEntryWire[]>>({});
  const [dirErrors, setDirErrors] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [preview, setPreview] = React.useState<FilePreviewWire | null>(null);
  const [previewBusy, setPreviewBusy] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  /* -------------------------------- the roster ------------------------------- */

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const res = await fetchUserPage({ limit: ROSTER_LIMIT, sort: "username", dir: "asc" });
      if (!live) return;
      if (!res.ok) {
        setRosterError(res.error);
        return;
      }
      setRosterError(null);
      setRosterTotal(res.data.total);
      setNames(res.data.rows.map((r) => r.username));
    })();
    return () => {
      live = false;
    };
  }, []);

  /* --------------------------------- the rail -------------------------------- */

  // Changing member throws the whole tree away rather than merging: a cached
  // listing belongs to the member it was read for, and a stale row here would
  // put one person's filenames under another person's name.
  React.useEffect(() => {
    setRoots(null);
    setRootsError(null);
    setListings({});
    setDirErrors({});
    setExpanded({});
    setSelection(null);
    setPreview(null);
    setPreviewError(null);
    if (!user) return;

    let live = true;
    void (async () => {
      const res = await fetchFileRoots(user);
      if (!live) return;
      if (res.ok) setRoots(res.data);
      else setRootsError(res.error);
    })();
    return () => {
      live = false;
    };
  }, [user]);

  const loadDir = React.useCallback(
    async (rootId: string, rel: string) => {
      const key = keyOf(rootId, rel);
      setLoading((m) => ({ ...m, [key]: true }));
      const res = await fetchDirListing(user, rootId, rel);
      setLoading((m) => ({ ...m, [key]: false }));
      if (res.ok) {
        setListings((m) => ({ ...m, [key]: res.data.entries }));
        setDirErrors((m) => {
          const next = { ...m };
          delete next[key];
          return next;
        });
      } else {
        setDirErrors((m) => ({ ...m, [key]: res.error }));
      }
    },
    [user],
  );

  const toggleDir = (rootId: string, rel: string) => {
    const key = keyOf(rootId, rel);
    const open = expanded[key] === true;
    setExpanded((m) => ({ ...m, [key]: !open }));
    if (!open && listings[key] === undefined && !loading[key]) void loadDir(rootId, rel);
  };

  const openFile = React.useCallback(
    async (rootId: string, rel: string) => {
      setSelection({ rootId, path: rel });
      setPreview(null);
      setPreviewError(null);
      setPreviewBusy(true);
      const res = await fetchFilePreview(user, rootId, rel);
      setPreviewBusy(false);
      if (res.ok) setPreview(res.data);
      else setPreviewError(res.error);
    },
    [user],
  );

  /**
   * *Preview* on a file's context menu (P10).
   *
   * The command carries the root and the path the click was over and this is
   * what performs it — the same `openFile` a left-click runs, so the menu row
   * cannot drift into being a second, subtly different way to read a file. It is
   * the audited route either way.
   */
  React.useEffect(
    () =>
      onAccountsCtx((s) => {
        if (s.kind === "file-preview") void openFile(s.root, s.path);
      }),
    [openFile],
  );

  /* --------------------------------- rendering ------------------------------- */

  /** One directory's children, recursively — only for keys that are expanded, so
   *  the recursion follows what has actually been opened. */
  const renderChildren = (rootId: string, rel: string, depth: number): React.ReactNode => {
    const key = keyOf(rootId, rel);
    const error = dirErrors[key];
    if (error) {
      return (
        <Typography key={`${key}!`} sx={{ fontSize: 11, color: token("err"), pl: 0.5 + depth * 1.5 }}>
          {error}
        </Typography>
      );
    }
    const entries = listings[key];
    if (entries === undefined) return null;
    if (entries.length === 0) {
      return (
        <Typography key={`${key}~`} sx={{ fontSize: 11, color: token("dim"), pl: 1 + depth * 1.5 }}>
          empty
        </Typography>
      );
    }
    return entries.map((entry) => {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childKey = keyOf(rootId, childRel);
      const open = expanded[childKey] === true;
      return (
        <React.Fragment key={childKey}>
          <TreeRow
            depth={depth}
            glyph={entry.kind === "dir" ? DIR_GLYPH : undefined}
            label={entry.name}
            open={entry.kind === "dir" ? open : undefined}
            busy={loading[childKey] === true}
            selected={
              entry.kind === "file" &&
              selection?.rootId === rootId &&
              selection.path === childRel
            }
            right={
              entry.kind === "file" ? (
                <Typography sx={{ fontSize: 10, color: token("dim"), fontFamily: token("mono") }}>
                  {fmtBytes(entry.bytes)}
                </Typography>
              ) : undefined
            }
            onClick={() =>
              entry.kind === "dir" ? toggleDir(rootId, childRel) : void openFile(rootId, childRel)
            }
            target={{ owner: user, root: rootId, path: childRel, kind: entry.kind }}
          />
          {entry.kind === "dir" && open && renderChildren(rootId, childRel, depth + 1)}
        </React.Fragment>
      );
    });
  };

  const treePane = (
    <Box sx={{ height: "100%", minHeight: 0, overflow: "auto", p: 1.25 }}>
      <Stack sx={{ gap: 1 }}>
        <TextField
          select
          size="small"
          label="Member"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          helperText={
            rosterTotal > names.length
              ? `the first ${names.length} accounts of ${rosterTotal}, in username order`
              : undefined
          }
        >
          {names.length === 0 && (
            <MenuItem value="" disabled>
              {rosterError ? "the roster could not be read" : "no accounts"}
            </MenuItem>
          )}
          {/* A `?user=` deep link can name somebody past the first page of the
              roster, and a Select whose value is in none of its options renders
              blank and warns. The member the tab is actually showing is always
              an option, whichever page they are on. */}
          {user && !names.includes(user) && (
            <MenuItem key={user} value={user} sx={{ fontSize: 12.5 }}>
              {user}
            </MenuItem>
          )}
          {names.map((n) => (
            <MenuItem key={n} value={n} sx={{ fontSize: 12.5 }}>
              {n}
            </MenuItem>
          ))}
        </TextField>

        {rosterError && (
          <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
            {rosterError}
          </Alert>
        )}
        {rootsError && (
          <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
            {rootsError}
          </Alert>
        )}

        {!user && (
          <Typography sx={{ fontSize: 12, color: token("dim") }}>
            Pick a member and their registered data roots appear here. Nothing is read until you
            open something.
          </Typography>
        )}

        {user && roots === null && !rootsError && <CircularProgress size={18} />}

        {roots?.map((root) => {
          const key = keyOf(root.id, "");
          const open = expanded[key] === true;
          return (
            <Box key={root.id}>
              <TreeRow
                depth={0}
                glyph={DIR_GLYPH}
                label={root.title}
                muted={!root.present}
                open={root.present ? open : undefined}
                busy={loading[key] === true}
                right={
                  <Stack direction="row" sx={{ gap: 0.5 }}>
                    {root.shared && (
                      <Tooltip title="These bytes belong to other members too — only this member's entries are listed">
                        <Chip
                          size="small"
                          variant="outlined"
                          label="shared"
                          sx={{ height: 17, fontSize: 9.5, color: token("warn"), borderColor: token("warn") }}
                        />
                      </Tooltip>
                    )}
                    {!root.present && (
                      <Typography sx={{ fontSize: 10, color: token("dim") }}>nothing stored</Typography>
                    )}
                  </Stack>
                }
                onClick={() => root.present && toggleDir(root.id, "")}
                // A root is a folder with an empty relative path — the same
                // shape every other row carries, so the menu does not have to
                // know that the top of the tree is a special case.
                target={{ owner: user, root: root.id, path: "", kind: "dir" }}
              />
              {root.present && open && renderChildren(root.id, "", 1)}
            </Box>
          );
        })}

        {roots?.length === 0 && (
          <Typography sx={{ fontSize: 12, color: token("dim") }}>
            No data roots are registered on this install.
          </Typography>
        )}
      </Stack>
    </Box>
  );

  const previewPane = (
    <Box sx={{ height: "100%", minHeight: 0, overflow: "auto", p: 1.5, display: "flex" }}>
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <PreviewPane
          user={user}
          selection={selection}
          preview={preview}
          busy={previewBusy}
          error={previewError}
        />
      </Box>
    </Box>
  );

  return (
    <Stack sx={{ flex: 1, minWidth: 0, minHeight: 420, gap: 1, p: 1.5 }}>
      {/* No close button, and it must not gain one — see the file header. */}
      <Alert
        severity="info"
        variant="outlined"
        icon={<Glyph id="icon-history" size={15} />}
        sx={{ fontSize: 12, flexShrink: 0 }}
      >
        Every view and download here is written to the audit log — your name, this member’s name,
        the root and the path, before the bytes move. Reading is allowed; reading unrecorded is not.
        Nothing on this tab can write, rename or delete.
      </Alert>

      <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <PaneLayout
          tree={TREE}
          storageKey="accounts-admin-files"
          renderPane={(id) => (id === "tree" ? treePane : previewPane)}
        />
      </Box>
    </Stack>
  );
}
