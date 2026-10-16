/**
 * @file Accounts type spine — the shared contracts every phase of the module
 * binds to: studio accounts (roles + credentials), the profile engine (avatar,
 * bio, custom fields), presence, the messenger's threads/messages, and the
 * administrator-controlled permission grants BootedHost enforces.
 *
 * Pure types + tiny pure helpers, NO node imports — imported by client
 * surfaces, API routes and the stores alike. Persistence lives in
 * `./accounts` (and the later stores) under the env-driven root in `./paths`.
 *
 * This is the STUDIO-WIDE account system (mirrored from the proven
 * module-scoped one in `../../amberxvid/lib/` — read, never imported): a
 * username here is the identity `kvUser()` resolves and core's SessionStore
 * reflects, not an AmberX Vid membership.
 */

/* --------------------------------- accounts --------------------------------- */

export type AccountRole = "member" | "administrator";

/**
 * A studio account. `passwordHash` is the only stored credential, in the
 * `scrypt$…` format of `./passwords`; no plaintext password exists anywhere.
 */
export interface Account {
  username: string;
  role: AccountRole;
  /** `scrypt$n=…,r=…,p=…$<salt b64>$<key b64>` — never a plaintext. */
  passwordHash: string;
  /** True while an admin-issued temp password is in force: the next login is
   *  forced through change-password before anything else. */
  mustChangePassword: boolean;
  /** Display name; null until chosen (the seed admin ships with one). */
  screenname: string | null;
  createdAt: string;
  updatedAt: string;
  /** "seed" for the bootstrapped administrator, else the issuing admin. */
  createdBy: string;
  disabled?: boolean;
  lastLoginAt?: string;
  /**
   * True for an account created by a MIGRATION rather than by a person — it
   * has a placeholder hash nothing can match, so it cannot be signed into
   * until an administrator issues a temp password (`reset-password`), which
   * clears this.
   *
   * It exists because the alternative is worse in both directions: minting a
   * usable password for a migrated member would be inventing a credential
   * nobody chose, and re-using the old module hash would silently move the
   * account onto a different scrypt ladder. This says "there is no password
   * here yet" out loud, which is the only honest third option.
   *
   * Read as an ordinary flag: it grants nothing and blocks nothing on its own
   * — the unusable hash is what refuses the login.
   */
  forcePasswordReset?: boolean;
}

/** What any signed-in user may see of any account (no credentials). */
export interface AccountPublic {
  username: string;
  role: AccountRole;
  screenname: string | null;
  createdAt: string;
  disabled: boolean;
}

/** The caller's own account, with the flags that drive the entry flow. */
export interface AccountMe extends AccountPublic {
  mustChangePassword: boolean;
  /** True until a screenname is chosen — the last gate before entry. */
  needsScreenname: boolean;
  lastLoginAt: string | null;
}

/** Every account mutation reports one of these — routes map them onto status
 *  codes. The store never throws for a policy refusal, only for real faults. */
export type AccountResult =
  | { ok: true; account: Account }
  | { ok: false; error: string; status: number };

/* --------------------------------- profiles ---------------------------------- */

/** Bio cap — shared by the editor UI and the store's validation. */
export const BIO_MAX = 2000;
/** Avatar image cap — a data-URL, 256 KB. The store refuses anything larger,
 *  so a runaway upload cannot fill the kv-adjacent store. */
export const AVATAR_IMAGE_MAX = 262_144;
/** Custom-field caps — label and value, per field, and fields per profile. */
export const FIELD_LABEL_MAX = 40;
export const FIELD_VALUE_MAX = 400;
export const CUSTOM_FIELDS_MAX = 20;

/** One owner-authored profile row ("Location: the garage"). Ordered. */
export interface ProfileField {
  label: string;
  value: string;
}

/**
 * The designed avatar — an initials disc over a colour, or an uploaded image.
 * `imageDataUrl` is required exactly when `kind` is "image", and is capped at
 * {@link AVATAR_IMAGE_MAX} by the store.
 */
export interface ProfileAvatar {
  kind: "initials" | "image";
  /** CSS colour — the initials disc fill / the image's accent ring. */
  color: string;
  imageDataUrl?: string;
}

/** A studio user's public face — everything the profile viewer shows. */
export interface Profile {
  version: 1;
  /** Owning account (= studio username). */
  username: string;
  /** Re-synced from the account on every read — never trusted from the file. */
  screenname: string;
  bio: string;
  avatar: ProfileAvatar;
  customFields: ProfileField[];
  /** Presence timestamp — stamped by the presence registry when the member's
   *  last live connection closes; null until they have ever connected. */
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------- permissions -------------------------------- */

/**
 * Per-username grants, as `permissions.json` stores them. An ABSENT key means
 * allowed (default-allow: a single-operator studio stays fully open until an
 * administrator says otherwise); administrators always pass every check.
 */
export interface PermissionGrants {
  /** moduleId → may the user open it. Absent moduleId = allowed. */
  modules: Record<string, boolean>;
  capabilities: {
    canMessage: boolean;
    canEditProfile: boolean;
  };
}

/**
 * The flat verdict `effectivePermissions()` resolves from role + grants — what
 * the client holds and BootedHost consults. Deny lists rather than the sparse
 * grant record, so a consumer never re-implements the default-allow rule.
 */
export interface EffectivePermissions {
  username: string;
  role: AccountRole;
  /** True → every check below passes regardless of its own value. */
  administrator: boolean;
  /** moduleIds an administrator has explicitly revoked. */
  deniedModules: string[];
  canMessage: boolean;
  canEditProfile: boolean;
}

/* --------------------------------- messenger --------------------------------- */

export interface Message {
  id: string;
  threadId: string;
  from: string;
  /**
   * The single recipient of a DM. **`""` for a group message**, which is
   * addressed to the THREAD rather than to a person — see {@link ThreadMember}
   * for where a group's real per-recipient truth lives.
   */
  to: string;
  text: string;
  sentAt: string;
  /**
   * Position in the thread, assigned on send and never reused — what the
   * per-member cursors point at and what the history pager seeks by.
   *
   * OPTIONAL ON THE WIRE, always present after the store normalises: a thread
   * file written before groups existed carries no seq, and the client's
   * optimistic phantom has no server position to claim. Both get one assigned
   * on the next read, which is what makes "no migration" true.
   */
  seq?: number;
  /**
   * Null while undelivered — stamped when delivery is complete. For a DM that
   * is the moment the one recipient receives it (unchanged); for a group it is
   * the moment the LAST member has, so "still queued" keeps meaning "somebody
   * has not got this yet" on both kinds.
   */
  deliveredAt: string | null;
  /** Read by every recipient. Same aggregate rule as {@link Message.deliveredAt}. */
  readAt: string | null;
}

/** What a member may do in a thread. `owner` adds renaming and nothing else —
 *  a group is a shared room, not an administered one. */
export type ThreadRole = "owner" | "member";

/**
 * One member of a thread, and THE per-member delivery truth.
 *
 * Cursors rather than per-message stamps: a 500-message thread with 50 members
 * would otherwise carry 25 000 stamp records to say the same thing twice. Each
 * cursor is the seq this member has been carried up to, `0` for "nothing yet",
 * and both only ever move forward.
 */
export interface ThreadMember {
  username: string;
  role: ThreadRole;
  joinedAt: string;
  /** Newest seq DELIVERED to this member. Offline delivery moves this. */
  deliveredThrough: number;
  /** Newest seq this member has READ. */
  readThrough: number;
  /** When {@link ThreadMember.deliveredThrough} last moved — the stamp that
   *  proves an offline member's messages arrived. Null until their first. */
  deliveredAt: string | null;
}

/**
 * One conversation. A DM is simply the two-member case: same file, same id,
 * same fields — `kind: "dm"`, two members, `title: null`.
 *
 * `participants` is DERIVED from `members` and kept because every existing
 * reader already uses it. It is rewritten from `members` on every normalise, so
 * the two can never disagree; nothing writes to it directly.
 */
export interface Thread {
  version: 1;
  id: string;
  kind: "dm" | "group";
  /** The group's name; null for a DM, which is named by who you are talking to. */
  title: string | null;
  members: ThreadMember[];
  /** Mirror of `members[].username`, in the same order. Derived, never authored. */
  participants: string[];
  messages: Message[];
  /** The next seq to assign — a counter, so trimming the front never renumbers
   *  what a cursor already points at. */
  nextSeq: number;
  createdAt: string;
  /** Who opened it. The DM sender, or the group's creator. */
  createdBy: string;
  updatedAt: string;
}

/** Canonical thread id for a pair — order-independent. */
export function threadIdFor(a: string, b: string): string {
  return [a.toLowerCase(), b.toLowerCase()].sort().join("--");
}

/**
 * Members a thread may hold — the SITE DEFAULT, and the ceiling any policy
 * cascade is clamped to.
 *
 * The effective cap is a policy question (`setThreadMemberCapSource` in
 * `./messages`), and until a cascade installs itself this is the answer. The
 * ceiling is structural rather than editorial: one thread is one JSON document
 * rewritten per send, so an unbounded member list is an unbounded write.
 */
export const THREAD_MEMBERS_MAX = 50;
export const THREAD_MEMBERS_CEILING = 500;

/** A group's title cap — shared by the composer UI and the store. */
export const THREAD_TITLE_MAX = 80;

/** Message length cap — shared by the composer UI and the store's validation. */
export const MESSAGE_MAX = 4000;

/** Messages a thread retains — the store trims the OLDEST past this cap, both
 *  inline on send and in the admin `pruneMessages` sweep. */
export const THREAD_MESSAGES_MAX = 500;

/** One buddy-list row's worth of a thread — what the list needs, no history. */
export interface ThreadSummary {
  id: string;
  kind: "dm" | "group";
  /** The other participant's username — **`""` for a group**, which is named by
   *  {@link ThreadSummary.title} rather than by a person. */
  with: string;
  /** The group's name; null for a DM. */
  title: string | null;
  /** Every member's username, the caller included. One member for a DM's list
   *  row would be a lie by omission, so both kinds carry the full list. */
  members: string[];
  lastMessage: Message | null;
  /** Messages the caller has not read — from their own cursor, not from a scan
   *  of who each message was addressed to. */
  unread: number;
  updatedAt: string;
}

/** One page of a thread's history, newest-first. `nextCursor` is the seq to ask
 *  for next, or null at the beginning of the conversation. */
export interface MessagePage {
  messages: Message[];
  nextCursor: number | null;
  /** Messages the thread holds in total — what a "1–50 of 312" reads from. */
  total: number;
}

/* ---------------------------------- relations -------------------------------- */

/** One member as a buddy list shows them, before presence is joined on. */
export interface BuddyRow {
  username: string;
  screenname: string | null;
}

/**
 * A buddy row with presence. AWAY IS SELF-DECLARED, AIM-style — it is not an
 * idle timer, because the registry knows connections and nothing else, and a
 * timer would be inventing an activity signal that does not exist. It is held
 * in memory beside the connection and clears when the member's last stream
 * closes, so signing off always lands them at `offline`.
 */
export interface BuddyPresence extends BuddyRow {
  status: "online" | "away" | "offline";
  /** Null when the member has never connected. */
  lastSeenAt: string | null;
}

/** A member's own social graph. `blocked` is returned to its OWNER and to
 *  nobody else — no other member's view of anyone ever carries it. */
export interface RelationsView {
  username: string;
  buddies: BuddyRow[];
  /** Requests waiting for this member to accept. */
  incoming: BuddyRow[];
  /** Requests this member sent, still waiting. */
  outgoing: BuddyRow[];
  blocked: BuddyRow[];
  /** "Only my buddies may interact with me" — the sole source of the guard's
   *  `not-buddy-required` verdict (`./relations`). */
  buddiesOnly: boolean;
}

/* ---------------------------------- presence --------------------------------- */

export interface Presence {
  username: string;
  online: boolean;
  /** Self-declared away, and only ever true while `online` is — see
   *  {@link BuddyPresence}. */
  away: boolean;
  lastSeenAt: string;
}

/** What rides the presence SSE channel — roster flips, live message delivery,
 *  the relations nudge, and the route's 15-second keep-alive ping.
 *
 *  `relations` carries no payload on purpose: it says "your graph moved, ask
 *  again" rather than pushing an edge. A push would have to be computed per
 *  recipient to avoid telling one member what the other's list looks like, and
 *  a refetch is already scoped to the asker by the route. It is never sent to
 *  a member who was just blocked — silence is the whole point of a block. */
export type AccountsEvent =
  | { type: "roster"; roster: Presence[] }
  | { type: "message"; message: Message }
  | { type: "relations"; at: string }
  /** "your conversation LIST moved, ask again" — a group was opened, joined,
   *  left or renamed. Payload-free for the same reason `relations` is: a diff
   *  would have to be computed per recipient to avoid telling one member what
   *  another's list looks like, and the refetch is already scoped to the asker
   *  by the route. */
  | { type: "threads"; at: string }
  | { type: "ping"; at: string };

/* ----------------------------------- admin ----------------------------------- */

/** One roster row of the admin overview — public face + the admin-only flags. */
export interface AdminAccountRow extends AccountPublic {
  mustChangePassword: boolean;
  createdBy: string;
  lastLoginAt: string | null;
  updatedAt: string;
}

/** Counts and sizes for one conversation — deliberately never message text:
 *  the admin manages the DATA, the conversation stays between its members. */
export interface AdminThreadInfo {
  id: string;
  kind: "dm" | "group";
  /** The group's name; null for a DM. */
  title: string | null;
  participants: string[];
  messages: number;
  /** Undelivered (offline-queued) messages in the thread. */
  queued: number;
  firstAt: string;
  lastAt: string;
  sizeBytes: number;
}

/** Everything the admin control surface shows, in one snapshot. */
export interface AdminOverview {
  accounts: AdminAccountRow[];
  /** username (lowercased) → stored grants. Absent username = default-allow. */
  grants: Record<string, PermissionGrants>;
  threads: AdminThreadInfo[];
  presence: Presence[];
  generatedAt: string;
}

/* ============================== AI credits (P18) ============================== */

/**
 * How one ledger entry came to exist. Four kinds and no fifth: every movement
 * of credit is either money arriving (`purchase`), an administrator's decision
 * (`grant` — negative for a revoke), a feature charging for work (`spend`), or
 * that charge being given back (`refund`).
 *
 * They are not cosmetic. An administrator answering "why is this member at
 * zero" reads the kind column first, and a `spend` they cannot explain is a
 * different investigation from a `grant` they do not remember making.
 */
export type CreditKind = "purchase" | "grant" | "spend" | "refund";

/**
 * ONE line of the append-only ledger. Nothing here is ever edited or removed —
 * a correction is a new entry of the opposite sign, which is why `refund`
 * exists as a kind rather than as a `spend` being deleted.
 */
export interface CreditEntry {
  readonly id: string;
  /** The member the credit belongs to, lowercased. */
  readonly user: string;
  /** Signed. Positive adds, negative removes. Never zero. */
  readonly delta: number;
  readonly kind: CreditKind;
  /**
   * What this movement was FOR, in the caller's own vocabulary — a meter id, a
   * checkout id, an administrator's stated reason. Free text on purpose: the
   * ledger must be able to record a charge from a feature it has never heard
   * of, which is the whole point of the meter being an extension point.
   */
  readonly ref: string;
  /** ISO stamp. */
  readonly at: string;
  /**
   * WHO caused it: an administrator's username for a grant, the member's own
   * for a spend or a purchase, `"system"` for anything automatic. An entry
   * without an actor is an entry nobody can be asked about.
   */
  readonly actor: string;
}

/** A member's ledger as a surface reads it: the fold, and the entries behind it. */
export interface CreditStatement {
  readonly user: string;
  /** The fold over every entry. Never stored — see `lib/credits.ts`. */
  readonly balance: number;
  /** Newest first, capped by the caller's `limit`. */
  readonly entries: readonly CreditEntry[];
  /** Total entries held, so a truncated list can say it is truncated. */
  readonly total: number;
}
