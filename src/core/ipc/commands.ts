/**
 * Typed wrappers around Tauri commands. This is the only module that calls
 * `invoke` directly; features import these functions instead, so the IPC
 * contract with src-tauri/src/commands.rs lives in one place.
 */
import { invoke } from "@tauri-apps/api/core";
import { isGameId, type GameId } from "@/core/game-context/games";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface DiagnosticsSnapshot {
  appVersion: string;
  pid: number;
  uptimeSecs: number;
  hostMemoryBytes: number;
  hostCpuPercent: number;
  webviewProcesses: number;
  webviewMemoryBytes: number;
  webviewCpuPercent: number;
  dbSchemaVersion: number;
  dbSizeBytes: number | null;
}

export async function getLastGame(): Promise<GameId | null> {
  const value = await invoke<unknown>("get_last_game");
  return isGameId(value) ? value : null;
}

export function setLastGame(game: GameId | null): Promise<void> {
  return invoke("set_last_game", { game });
}

export function getAppSetting<T extends JsonValue>(key: string): Promise<T | null> {
  return invoke<T | null>("get_app_setting", { key });
}

export function setAppSetting(key: string, value: JsonValue): Promise<void> {
  return invoke("set_app_setting", { key, value });
}

export function getGameSetting<T extends JsonValue>(game: GameId, key: string): Promise<T | null> {
  return invoke<T | null>("get_game_setting", { game, key });
}

export function setGameSetting(game: GameId, key: string, value: JsonValue): Promise<void> {
  return invoke("set_game_setting", { game, key, value });
}

export function getDiagnostics(): Promise<DiagnosticsSnapshot> {
  return invoke<DiagnosticsSnapshot>("get_diagnostics");
}

// ---------- market data (src-tauri/src/market) ----------

export interface MarketCategory {
  id: string;
  label: string;
  endpoint: "exchange" | "item";
}

export interface MarketLeague {
  name: string;
  displayName: string;
  hardcore: boolean;
  indexed: boolean;
}

export interface MarketItemRow {
  itemId: string;
  name: string;
  variant: string | null;
  icon: string | null;
  /** In the game's base unit (snapshot.baseUnit). */
  value: number;
  divineValue: number | null;
  /** Ratio over 7 days, e.g. 0.042 = +4.2 %. */
  change7d: number | null;
  /** Source sparkline: % change vs. 7 days ago per day; null where unknown. */
  sparkline: (number | null)[];
  volumeValue: number | null;
  listings: number | null;
  /** Base type of unique items (poe.ninja stash endpoints); null for exchange categories. */
  baseType?: string | null;
}

export interface MarketSnapshot {
  category: string;
  baseUnit: string;
  source: "poe.ninja";
  items: MarketItemRow[];
  /** Unix seconds of the last successful fetch; null if never fetched. */
  fetchedAt: number | null;
  expiresAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  refreshing: boolean;
}

export interface MarketHistoryPoint {
  ts: number;
  value: number;
}

export interface MarketStats {
  http: { requests: number; notModified: number; errors: number; bytes: number; lastRequestAt: number | null };
  inFlight: number;
  watchedResources: number;
}

export interface MarketUpdatedEvent {
  game: GameId;
  league: string;
  category: string;
  ok: boolean;
}

export const MARKET_UPDATED_EVENT = "market:updated";

export function marketCategories(game: GameId): Promise<MarketCategory[]> {
  return invoke("market_categories", { game });
}

export function marketLeagues(game: GameId): Promise<MarketLeague[]> {
  return invoke("market_leagues", { game });
}

export function marketOverview(game: GameId, league: string, category: string): Promise<MarketSnapshot> {
  return invoke("market_overview", { game, league, category });
}

export function marketRefresh(game: GameId, league: string, category: string): Promise<boolean> {
  return invoke("market_refresh", { game, league, category });
}

export function marketHistory(game: GameId, league: string, category: string, itemId: string, days: number): Promise<MarketHistoryPoint[]> {
  return invoke("market_history", { game, league, category, itemId, days });
}

export function marketStats(): Promise<MarketStats> {
  return invoke("market_stats");
}

// ---------- official trade (src-tauri/src/trade) ----------

export interface TradeStatEntry {
  id: string;
  text: string;
  type: string;
  options?: boolean;
}

export interface TradeListing {
  id: string;
  amount: number | null;
  currency: string | null;
  priceType: string | null;
  /** Converted with cached poe.ninja rates; null when no rate was available. */
  amountBase: number | null;
  account: string;
  character: string | null;
  status: "online" | "afk" | "offline";
  /** ISO timestamp. */
  indexed: string | null;
  priceSource: "item" | "stash" | "unknown";
  whisper: string | null;
  /** PoE 1 3.30 instant-buyout listing: buyable without the seller online. */
  instantBuyout?: boolean;
  item: { name: string; typeLine: string; ilvl: number | null; corrupted: boolean; icon: string | null; mods: string[] };
}

export interface TradePriceCheck {
  searchId: string;
  total: number;
  tradeUrl: string;
  listings: TradeListing[];
  hasMore: boolean;
  baseUnit: string;
  ratesAvailable: boolean;
}

/** Gem addressed on Trade as base type + discriminator (transfigured gems). */
export interface TradeGemVariant {
  /** Name shown in game, e.g. "Static Strike of Gathering Lightning". */
  text: string;
  /** Base gem, e.g. "Static Strike". */
  type: string;
  /** e.g. "alt_x". */
  disc: string;
}

export function tradeGemVariants(game: GameId): Promise<TradeGemVariant[]> {
  return invoke("trade_gem_variants", { game });
}

export function tradeStats(game: GameId): Promise<TradeStatEntry[]> {
  return invoke("trade_stats", { game });
}

export function tradePriceCheck(game: GameId, league: string, query: Record<string, unknown>, count = 10): Promise<TradePriceCheck> {
  return invoke("trade_price_check", { game, league, query, count });
}

export function tradeFetchMore(game: GameId, searchId: string, offset: number, count = 10): Promise<{ listings: TradeListing[]; hasMore: boolean }> {
  return invoke("trade_fetch_more", { game, searchId, offset, count });
}

export const TRADE_CONTACT_KEY = "trade.contact";

// ---------- Path of Building (src-tauri/src/pob.rs) ----------

export interface PobInstall {
  exe: string;
  dir: string;
  version: string | null;
  branch: string | null;
  source: "configured" | "registry" | "scan";
}

export interface PobStatus {
  game: GameId;
  product: string;
  install: PobInstall | null;
  configuredProblem: string | null;
  running: boolean;
  buildsDir: string | null;
  downloadUrl: string;
  projectUrl: string;
}

export interface PobBuild {
  name: string;
  folder: string;
  modified: number | null;
  size: number;
}

export const pobStatus = (game: GameId) => invoke<PobStatus>("pob_status", { game });
/** Opens a native file picker in the host; resolves null if cancelled. */
export const pobChooseExe = (game: GameId) => invoke<PobStatus | null>("pob_choose_exe", { game });
export const pobClearPath = (game: GameId) => invoke<PobStatus>("pob_clear_path", { game });
export const pobLaunch = (game: GameId) => invoke<void>("pob_launch", { game });
export const pobBuilds = (game: GameId) => invoke<PobBuild[]>("pob_builds", { game });
export const pobOpenBuildsFolder = (game: GameId) => invoke<void>("pob_open_builds_folder", { game });

// ---------- built-in browser (src-tauri/src/browser.rs) ----------

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrowserEvent =
  | { kind: "navigated"; tab: string; url: string }
  | { kind: "loading"; tab: string; loading: boolean; url: string }
  | { kind: "title"; tab: string; title: string }
  | { kind: "newTab"; url: string };

export const BROWSER_EVENT = "browser:event";
export const browserOpen = (tab: string, url: string, bounds: BrowserBounds) => invoke<void>("browser_open", { tab, url, bounds });
export const browserSetBounds = (tab: string, bounds: BrowserBounds) => invoke<void>("browser_set_bounds", { tab, bounds });
export const browserShowOnly = (tab: string | null) => invoke<void>("browser_show_only", { tab });
export const browserAction = (tab: string, action: "back" | "forward" | "reload") => invoke<void>("browser_action", { tab, action });
export const browserClose = (tab: string) => invoke<void>("browser_close", { tab });
export const browserOpenExternal = (tab: string) => invoke<void>("browser_open_external", { tab });

// ---------- crafting (src-tauri/src/crafting.rs, PoE 1) ----------

/** Typed as `unknown` here; the PoE 1 crafting module owns the data shape. */
export const craftingData = (game: GameId, force = false) => invoke<unknown>("crafting_data", { game, force });

// ---------- regex (src-tauri/src/regex_library.rs) ----------

export type RegexEntry = {
  id: string;
  name: string;
  category: string;
  regex: string;
  description: string;
  tags: string[];
  notes: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
};
export type RegexSaveOutcome = { status: "saved"; entry: RegexEntry } | { status: "nameTaken"; existingId: string };
export type RegexSlot = { slot: number; label: string; regex: string; libraryId: string | null };

export const regexList = (game: GameId) => invoke<RegexEntry[]>("regex_list", { game });
export const regexSave = (game: GameId, entry: RegexEntry, overwrite = false) => invoke<RegexSaveOutcome>("regex_save", { game, entry, overwrite });
export const regexSetFavorite = (game: GameId, id: string, favorite: boolean) => invoke<void>("regex_set_favorite", { game, id, favorite });
export const regexDelete = (game: GameId, id: string) => invoke<void>("regex_delete", { game, id });
export const regexSlots = (game: GameId) => invoke<RegexSlot[]>("regex_slots", { game });
export const regexSetSlot = (game: GameId, slot: number, value: RegexSlot | null) => invoke<void>("regex_set_slot", { game, slot, value });
/** Opens a save dialog; false = cancelled. */
export const regexExport = (fileName: string, contents: string) => invoke<boolean>("regex_export", { fileName, contents });
/** Opens a file dialog; null = cancelled. */
export const regexImport = () => invoke<string | null>("regex_import");

// ---------- session intelligence (src-tauri/src/session) ----------

export type SessionTrackState = "not_detected" | "detected" | "tracking" | "reading_log" | "reconnecting" | "paused" | "completed" | "error";
export type AreaKind = "hideout" | "town" | "map" | "campaign" | "content" | "unknown";

export interface SessionConfig {
  autoDetect: boolean;
  autoTrack: boolean;
  autoDiscover: boolean;
  attachToRunning: boolean;
  keepShortSessions: boolean;
  pollSecs: number;
  debugLogging: boolean;
  notifyOnSummary: boolean;
  /** 0 = keep forever. */
  retentionDays: number;
}

/** One game session (one run of the PoE 2 client). Times are Unix seconds. */
export interface SessionSummary {
  id: number;
  startedAt: number;
  endedAt: number | null;
  lastActivityAt: number;
  status: "active" | "completed";
  endReason: "game_closed" | "recovered" | null;
  /** False when Client.txt couldn't be read: area/map figures are unknown, not zero. */
  logTracked: boolean;
  durationSecs: number;
  mapsEntered: number;
  areasEntered: number;
  mapSecs: number;
  hideoutSecs: number;
  townSecs: number;
  campaignSecs: number;
  contentSecs: number;
  unknownSecs: number;
  loadingSecs: number;
  afkSecs: number;
  deaths: number;
  levelUps: number;
}

export interface SessionVisit {
  id: number;
  areaId: string;
  areaName: string | null;
  areaLevel: number | null;
  seed: number | null;
  kind: AreaKind;
  enteredAt: number;
  exitedAt: number | null;
  loadingSecs: number | null;
}

export type SessionEventKind =
  | "game_started"
  | "game_closed"
  | "tracking_resumed"
  | "recovered"
  | "client_log_opened"
  | "death"
  | "level_up"
  | "afk_on"
  | "afk_off"
  | "disconnect"
  | "paused"
  | "resumed"
  | "log_reset"
  | "log_unavailable";

export interface SessionEvent {
  id: number;
  at: number;
  kind: SessionEventKind;
  detail: string | null;
}

/** One map instance (area + seed). `completed` is always null: Client.txt has no reliable completion line. */
export interface SessionMapRun {
  areaId: string;
  areaName: string | null;
  areaLevel: number | null;
  firstEnteredAt: number;
  lastExitedAt: number | null;
  entries: number;
  insideSecs: number;
  completed: boolean | null;
}

export interface SessionDetail {
  summary: SessionSummary;
  visits: SessionVisit[];
  events: SessionEvent[];
  mapRuns: SessionMapRun[];
}

export interface SessionStatus {
  state: SessionTrackState;
  message: string | null;
  paused: boolean;
  process: { pid: number; startedAt: number } | null;
  activeSession: SessionSummary | null;
  currentArea: SessionVisit | null;
  lastCompletedId: number | null;
  log: { found: boolean; label: string | null; manual: boolean; confirmedPoe2: boolean; error: string | null };
  config: SessionConfig;
}

export interface SessionDiagnostics {
  state: SessionTrackState;
  message: string | null;
  processName: string | null;
  processId: number | null;
  processStartedAt: number | null;
  logPath: string | null;
  logManual: boolean;
  logExists: boolean;
  logCheck: string | null;
  logSize: number;
  offset: number;
  backlogBytes: number;
  fileKey: string | null;
  lastReadAt: number | null;
  lastLineAt: number | null;
  linesRead: number;
  eventsParsed: number;
  parseErrors: number;
  skippedLongLines: number;
  logResets: number;
  lastError: string | null;
  sessionId: number | null;
  pollSecs: number;
  scans: number;
  lastScanAt: number | null;
  lastScanMs: number | null;
}

export type SessionSort = "newest" | "oldest" | "longest" | "shortest" | "most_maps" | "fewest_maps";
export interface SessionHistoryQuery {
  from?: number | null;
  to?: number | null;
  search?: string | null;
  sort?: SessionSort;
  limit?: number;
}

export const SESSION_UPDATED_EVENT = "session:updated";
export const SESSION_COMPLETED_EVENT = "session:completed";
export interface SessionCompletedEvent {
  game: GameId;
  sessionId: number;
  notify: boolean;
}

export const sessionStatus = (game: GameId) => invoke<SessionStatus>("session_status", { game });
export const sessionDiagnostics = (game: GameId) => invoke<SessionDiagnostics>("session_diagnostics", { game });
export const sessionList = (game: GameId, query: SessionHistoryQuery) => invoke<SessionSummary[]>("session_list", { game, query });
export const sessionDetail = (game: GameId, id: number) => invoke<{ detail: SessionDetail; previous: SessionSummary | null } | null>("session_detail", { game, id });
export const sessionDelete = (game: GameId, ids: number[]) => invoke<number>("session_delete", { game, ids });
export const sessionSetConfig = (game: GameId, config: SessionConfig) => invoke<SessionStatus>("session_set_config", { game, config });
export const sessionSetPaused = (game: GameId, paused: boolean) => invoke<SessionStatus>("session_set_paused", { game, paused });
export const sessionCheckNow = (game: GameId) => invoke<SessionStatus>("session_check_now", { game });
/** Opens a file dialog; null = cancelled. */
export const sessionChooseLog = (game: GameId) => invoke<SessionStatus | null>("session_choose_log", { game });
export const sessionClearLog = (game: GameId) => invoke<SessionStatus>("session_clear_log", { game });
export const sessionReset = (game: GameId) => invoke<SessionStatus>("session_reset", { game });
/** Opens a save dialog; false = cancelled. Empty `ids` exports every session. */
export const sessionExport = (game: GameId, ids: number[], format: "json" | "csv") => invoke<boolean>("session_export", { game, ids, format });

// ---------- loot journal (src-tauri/src/loot) ----------

export type LootDuplicateMode = "merge" | "cooldown" | "always";
export type LootValueStatus = "pending" | "priced" | "unsupported" | "no_market_data" | "manual";
export type LootStatus = "captured" | "kept" | "sold" | "discarded";
export type LootOrigin = "unknown" | "user_confirmed_drop" | "user_not_a_drop";

export interface LootConfig {
  enabled: boolean;
  duplicateMode: LootDuplicateMode;
  cooldownMinutes: number;
  autoValue: boolean;
  /** 0 = no automatic revaluation. */
  revalueMinutes: number;
  minConfidence: "low" | "medium" | "high";
  maxRequests: number;
  notifyCaptures: boolean;
  notifyUnique: boolean;
  /** Base unit (PoE 2: exalted); 0 = off. */
  notifyThreshold: number;
  notifyValueChanges: boolean;
  notifyErrors: boolean;
  retentionDays: number;
  /** Loot Tracker overlay. */
  overlayOpacity: number;
  overlayScale: number;
  overlayMode: "compact" | "expanded";
  overlayCollapsed: boolean;
  overlayRows: number;
  overlayAlwaysOnTop: boolean;
  /** Registered only while PoE 2 is in the foreground; "" = off. */
  hotkeys: LootHotkeys;
}

export interface LootHotkeys {
  toggleOverlay: string;
  collapseOverlay: string;
  startMap: string;
  finishMap: string;
  screenshot: string;
}
export type LootHotkeyAction = "toggleOverlay" | "collapseOverlay" | "startMap" | "finishMap" | "screenshot";

export interface LootCaptureStatus {
  enabled: boolean;
  /** Windows clipboard listener registered right now (PoE 2 focused). */
  listening: boolean;
  registered: boolean;
  gameFocused: boolean;
  available: boolean;
  capturedThisRun: number;
  lastCaptureAt: number | null;
  lastItemName: string | null;
  lastError: string | null;
}

export interface LootItem {
  id: number;
  fingerprint: string;
  itemClass: string;
  rarity: string;
  itemName: string | null;
  baseType: string;
  category: string;
  icon: string | null;
  itemLevel: number | null;
  stackSize: number | null;
  quality: number | null;
  corrupted: boolean;
  unidentified: boolean;
  parserConfidence: "high" | "medium" | "low";
  parserWarnings: string[];
  capturedAt: number;
  lastCapturedAt: number;
  captureCount: number;
  source: "clipboard" | "import";
  sessionId: number | null;
  captureAreaName: string | null;
  captureAreaKind: string | null;
  sessionElapsedSecs: number | null;
  originStatus: LootOrigin;
  originNote: string | null;
  status: LootStatus;
  favorite: boolean;
  notes: string | null;
  tags: string[];
  valueStatus: LootValueStatus;
  /** Whole stack, game base unit. */
  valueTotal: number | null;
  valueCheckedAt: number | null;
  /** Note of the latest valuation (e.g. the price range of an unidentified unique). */
  valueNote: string | null;
  /** Latest valuation's source ("poe.ninja", "user"), confidence, market data time and league. */
  valueSource: string | null;
  valueConfidence: "high" | "medium" | "low" | null;
  valueFetchedAt: number | null;
  valueLeague: string | null;
  /** First known value (at capture time); market changes never overwrite it. */
  valueAtCapture: number | null;
  mapRunId: number | null;
  /** "auto" = copied inside that map, "user" = assigned by the user. */
  mapAssignment: "auto" | "user" | null;
  verified: boolean;
  /** Set when the user corrected the recognised category / quantity (the recognised value). */
  originalCategory: string | null;
  originalStackSize: number | null;
}

export interface LootValuation {
  id: number;
  at: number;
  status: Exclude<LootValueStatus, "pending">;
  unitValue: number | null;
  quantity: number;
  totalValue: number | null;
  unit: string;
  source: string;
  marketCategory: string | null;
  league: string | null;
  confidence: "high" | "medium" | "low" | null;
  dataFetchedAt: number | null;
  note: string | null;
}

export type LootSort = "newest" | "oldest" | "value_desc" | "value_asc" | "quantity" | "category";
export interface LootQuery {
  search?: string | null;
  category?: string | null;
  rarity?: string | null;
  status?: LootStatus | null;
  valueStatus?: LootValueStatus | null;
  minValue?: number | null;
  maxValue?: number | null;
  sessionId?: number | null;
  from?: number | null;
  to?: number | null;
  favoritesOnly?: boolean;
  unpricedOnly?: boolean;
  verifiedOnly?: boolean;
  mapRunId?: number | null;
  sort?: LootSort;
  limit?: number;
}

export interface LootEdit {
  notes?: string;
  tags?: string[];
  status?: LootStatus;
  favorite?: boolean;
  originStatus?: LootOrigin;
  originNote?: string;
  verified?: boolean;
  /** Corrections of what was recognised (the raw copy never changes). */
  category?: string;
  stackSize?: number;
  resetCorrections?: boolean;
}

/** A map record (src-tauri/src/loot/maps.rs): an instance detected by Session Intelligence ("auto") or the user's own ("manual"). */
export interface LootMapRun {
  id: number;
  sessionId: number | null;
  source: "auto" | "manual";
  areaId: string | null;
  areaName: string | null;
  areaLevel: number | null;
  seed: number | null;
  startedAt: number;
  endedAt: number | null;
  status: "active" | "paused" | "finished";
  strategy: string | null;
  notes: string | null;
  userConfirmed: boolean;
  /** Time in the map (auto: inside the instance; manual: minus pauses), at query time. */
  durationSecs: number;
  /** While counting: duration = now − runningSince. */
  runningSince: number | null;
  /** 1-based number within its session. */
  ordinal: number;
  items: number;
  quantity: number;
  itemTypes: number;
  /** Known values only (base unit). */
  value: number;
  unpriced: number;
  bestItemId: number | null;
  bestItemName: string | null;
  bestItemValue: number | null;
  bestItemIcon: string | null;
}

export interface LootCaptureEventRow {
  at: number;
  kind: "captured" | "duplicate" | "error";
  itemId: number | null;
  detail: string | null;
}

export const LOOT_UPDATED_EVENT = "loot:updated";
export const LOOT_CAPTURED_EVENT = "loot:captured";
export const LOOT_STATUS_EVENT = "loot:status";
export type LootCapturedEvent =
  | { itemId: number; name: string; rarity: string; valueStatus: LootValueStatus; valueTotal: number | null; unit: string; notify: string | null }
  | { error: string }
  | { valueChange: { itemId: number; from: number; to: number } };

export const lootStatus = (game: GameId) => invoke<LootCaptureStatus>("loot_status", { game });
export const lootConfig = (game: GameId) => invoke<LootConfig>("loot_config", { game });
export const lootSetConfig = (game: GameId, config: LootConfig) => invoke<LootConfig>("loot_set_config", { game, config });
export const lootList = (game: GameId, query: LootQuery) => invoke<LootItem[]>("loot_list", { game, query });
export const lootDetail = (game: GameId, id: number) => invoke<{ item: LootItem; rawText: string; valuations: LootValuation[] } | null>("loot_detail", { game, id });
export const lootEdit = (game: GameId, id: number, edit: LootEdit) => invoke<void>("loot_edit", { game, id, edit });
/** Empty `ids` runs a scheduler pass now (e.g. after the market league changed). */
export const lootRevalue = (game: GameId, ids: number[]) => invoke<number>("loot_revalue", { game, ids });
/** `null` returns the item to automatic pricing. */
export const lootSetManualValue = (game: GameId, id: number, value: number | null, note: string | null) => invoke<void>("loot_set_manual_value", { game, id, value, note });
export const lootDelete = (game: GameId, ids: number[]) => invoke<number>("loot_delete", { game, ids });
export const lootClear = (game: GameId) => invoke<number>("loot_clear", { game });
export const lootEvents = (game: GameId, limit: number) => invoke<LootCaptureEventRow[]>("loot_events", { game, limit });
/** Opens a save dialog; false = cancelled. Empty `ids` exports everything. */
export const lootExport = (game: GameId, ids: number[], format: "json" | "csv") => invoke<boolean>("loot_export", { game, ids, format });
/** Opens a file dialog; null = cancelled. */
export const lootImport = (game: GameId) => invoke<{ imported: number; skippedDuplicates: number; rejected: number } | null>("loot_import", { game });
export const lootMaps = (game: GameId, sessionId: number | null, limit: number) => invoke<LootMapRun[]>("loot_maps", { game, sessionId, limit });
export const lootMapCounts = (game: GameId) => invoke<{ maps: number; sessions: number }>("loot_map_counts", { game });
export const lootMapControl = (game: GameId, action: "start" | "pause" | "resume" | "finish", id: number | null, name: string | null = null) =>
  invoke<LootMapRun | null>("loot_map_control", { game, action, id, name });
export const lootMapEdit = (game: GameId, id: number, edit: { strategy?: string; notes?: string; confirmed?: boolean }) =>
  invoke<void>("loot_map_edit", { game, id, strategy: edit.strategy ?? null, notes: edit.notes ?? null, confirmed: edit.confirmed ?? null });
export const lootMapDelete = (game: GameId, id: number) => invoke<number>("loot_map_delete", { game, id });
export const lootAssignMap = (game: GameId, itemIds: number[], mapId: number | null) => invoke<number>("loot_assign_map", { game, itemIds, mapId });

/** Everything the Loot Tracker overlay shows (`loot::TrackerSummary`). */
export interface LootTrackerSummary {
  now: number;
  sessionId: number | null;
  sessionStartedAt: number | null;
  areaName: string | null;
  areaKind: string | null;
  openMap: LootMapRun | null;
  lastMap: LootMapRun | null;
  mapsFinished: number;
  sessionTotals: { items: number; quantity: number; itemTypes: number; value: number; unpriced: number };
  recent: LootItem[];
  capture: LootCaptureStatus;
  /** Snapshot assigned to the last map: [snapshot id, estimated inventory gain, lines needing review]. */
  lastMapInventory: [number, number, number] | null;
  /** Counters start at the user's "Reset session" (unix s) instead of the game session. */
  resetAt: number | null;
  /** The latest inventory snapshot of this session. */
  inventory: {
    snapshotId: number;
    takenAt: number;
    status: "review" | "confirmed" | "cancelled";
    value: number;
    toReview: number;
    unpriced: number;
    /** Estimated gain since the previous confirmed snapshot. */
    change: number | null;
    items: { name: string; quantity: number; value: number | null; icon: string | null; uncertain: boolean }[];
  } | null;
}
export interface LootTrackerWindowState {
  open: boolean;
  visible: boolean;
  clickThrough: boolean;
}
export const LOOT_TRACKER_STATE_EVENT = "loot-tracker:state";
/** Payload: the saved LootConfig (emitted by every lootSetConfig). */
export const LOOT_CONFIG_EVENT = "loot:config";
export const LOOT_TRACKER_COLLAPSE_EVENT = "loot-tracker:collapse";
export const LOOT_HOTKEY_EVENT = "loot:hotkey";
export interface LootHotkeyEvent {
  action: LootHotkeyAction;
  ok: boolean;
  message: string;
}
export const lootTrackerSummary = (game: GameId, recent: number) => invoke<LootTrackerSummary>("loot_tracker_summary", { game, recent });
export const lootTrackerState = (game: GameId) => invoke<LootTrackerWindowState>("loot_tracker_state", { game });
export const lootTrackerWindow = (game: GameId, action: "open" | "hide" | "toggle" | "close") => invoke<LootTrackerWindowState>("loot_tracker_window", { game, action });
export const lootTrackerSetClickThrough = (game: GameId, on: boolean) => invoke<LootTrackerWindowState>("loot_tracker_set_click_through", { game, on });
// Inventory snapshots (src-tauri/src/loot/inventory)
export type InventoryConfidence = "high" | "medium" | "low" | "unknown";
export interface InventorySnapshot {
  id: number;
  takenAt: number;
  source: "hotkey" | "file";
  status: "review" | "confirmed" | "cancelled";
  isBaseline: boolean;
  sessionId: number | null;
  mapRunId: number | null;
  mapAssignment: "auto" | "user" | null;
  screenW: number;
  screenH: number;
  league: string | null;
  note: string | null;
  confirmedAt: number | null;
  recognizerVersion: number;
  cells: number;
  toReview: number;
}
export interface InventoryEntry {
  id: number;
  col: number;
  row: number;
  recognizedName: string | null;
  recognizedCategory: string | null;
  iconScore: number;
  tierStrokes: number;
  recognizedQuantity: number | null;
  quantityConfidence: number;
  confidence: InventoryConfidence;
  alternatives: string[];
  name: string | null;
  quantity: number | null;
  excluded: boolean;
  corrected: boolean;
}
export interface InventoryDeltaLine {
  name: string;
  category: string | null;
  before: number;
  after: number;
  change: number;
  status: "confirmed" | "estimated" | "needs_review";
  unitValue: number | null;
  value: number | null;
}
export interface InventoryDelta {
  snapshotId: number;
  againstId: number | null;
  lines: InventoryDeltaLine[];
  estimatedGain: number;
  needsReview: number;
}
export interface InventorySnapshotDetail {
  snapshot: InventorySnapshot;
  entries: InventoryEntry[];
  /** data: URL of the stored inventory crop. */
  image: string | null;
  /** Grid in the crop's pixels. */
  grid: { left: number; top: number; cell: number; score: number } | null;
  delta: InventoryDelta;
}
export const LOOT_INVENTORY_EVENT = "loot:inventory";
export interface LootInventoryEvent {
  kind: "working" | "captured" | "error";
  message: string;
  snapshotId: number | null;
  cells: number | null;
  toReview: number | null;
}
export const lootInventorySnapshots = (game: GameId, limit: number) => invoke<InventorySnapshot[]>("loot_inventory_snapshots", { game, limit });
export const lootInventoryDetail = (game: GameId, id: number, against: number | null = null) => invoke<InventorySnapshotDetail | null>("loot_inventory_detail", { game, id, against });
export const lootInventoryEditEntry = (game: GameId, entryId: number, edit: { name?: string; quantity?: number; excluded?: boolean; reset?: boolean }) =>
  invoke<void>("loot_inventory_edit_entry", { game, entryId, edit });
export const lootInventoryUpdate = (game: GameId, id: number, change: { status?: InventorySnapshot["status"]; baseline?: boolean; mapId?: number | null }) =>
  invoke<void>("loot_inventory_update", {
    game,
    id,
    status: change.status ?? null,
    baseline: change.baseline ?? null,
    mapId: change.mapId ?? null,
    clearMap: "mapId" in change && change.mapId === null,
  });
export const lootInventoryReprocess = (game: GameId, id: number) => invoke<void>("loot_inventory_reprocess", { game, id });
export const lootInventoryDelete = (game: GameId, id: number) => invoke<void>("loot_inventory_delete", { game, id });
export const lootInventoryFromFile = (game: GameId) => invoke<number | null>("loot_inventory_from_file", { game });
export const lootInventoryItemNames = (game: GameId) => invoke<[string, string][]>("loot_inventory_item_names", { game });

/** "Reset session": the Loot Tracker counters start now (nothing is deleted); clear = follow the game session again. */
export const lootResetSession = (game: GameId, clear: boolean) => invoke<number | null>("loot_reset_session", { game, clear });

/** null = the key can be used; otherwise why not. */
export const lootHotkeyProblem = (game: GameId, key: string) => invoke<string | null>("loot_hotkey_problem", { game, key });

// ---------- campaign intelligence (src-tauri/src/campaign) ----------

export interface CampaignStatus {
  /** Character the live reader attributes new log lines to. */
  activeCharacterId: number | null;
  /** `poe2_production/tags/<tag>` last seen in Client.txt. */
  clientTag: string | null;
  clientTagAt: number | null;
  /** Events waiting for their login's character to be identified. */
  unassignedEvents: number;
  /** Change token (newest campaign event id); characters/events are re-read only when it changes. */
  revision: number;
}

export interface CampaignCharacter {
  id: number;
  name: string;
  /** Latest class seen (the Ascendancy after ascending). */
  class: string;
  baseClass: string;
  level: number;
  firstSeenAt: number;
  lastSeenAt: number;
  hidden: boolean;
  /** Campaign zone entries recorded (0 = never seen in the campaign). */
  campaignZones: number;
}

export interface CampaignMark {
  objectiveId: string;
  mark: "done" | "skipped" | "not-done";
  choice: string | null;
  at: number;
}

/** One normalised campaign log event (`campaign::store::EventRow`). */
export interface CampaignEventRow {
  at: number;
  /** `passives` / `respec_points`: PoE 1 only (Act Tracker) — a `/passives` output line and respec point grants. */
  kind: "zone" | "passive_points" | "weapon_set_points" | "level" | "ascended" | "death" | "passives" | "respec_points";
  areaId: string | null;
  areaName: string | null;
  areaLevel: number | null;
  amount: number | null;
  detail: string | null;
}

export const campaignStatus = (game: GameId) => invoke<CampaignStatus>("campaign_status", { game });
export const campaignCharacters = (game: GameId) => invoke<CampaignCharacter[]>("campaign_characters", { game });
export const campaignEvents = (game: GameId, characterId: number) =>
  invoke<CampaignEventRow[]>("campaign_events", { game, characterId });
export const campaignMarks = (game: GameId, characterId: number) => invoke<CampaignMark[]>("campaign_marks", { game, characterId });
/** `mark = null` removes the player's mark (back to automatic detection). */
export const campaignSetMark = (game: GameId, characterId: number, objectiveId: string, mark: CampaignMark["mark"] | null, choice: string | null = null) =>
  invoke<void>("campaign_set_mark", { game, characterId, objectiveId, mark, choice });
export const campaignSetHidden = (game: GameId, characterId: number, hidden: boolean) => invoke<void>("campaign_set_hidden", { game, characterId, hidden });
export const campaignDeleteCharacter = (game: GameId, characterId: number) => invoke<void>("campaign_delete_character", { game, characterId });
/** Reads the whole Client.txt once (explicit user action). */
export const campaignImportLog = (game: GameId) => invoke<{ lines: number; eventsStored: number; characters: number }>("campaign_import_log", { game });

/** Location Atlas (PoE 1): result of reading what was appended to the PoE 1 Client.txt. */
export interface AtlasSyncSummary {
  lines: number;
  eventsStored: number;
  /** The log was replaced or truncated since the last read. */
  reset: boolean;
  /** Bytes still waiting (a very large backlog is read over several calls). */
  remaining: number;
}
/** Opens (or focuses) the Location Atlas window, optionally on a campaign area id. */
export const atlasOpen = (game: GameId, area: string | null = null) => invoke<void>("atlas_open", { game, area });
/** Reads new PoE 1 log lines through the shared reader/parser/campaign hook (read-only). */
export const atlasSync = (game: GameId) => invoke<AtlasSyncSummary>("atlas_sync", { game });
/** Chooses the PoE 1 Client.txt (validated as a PoE 1 log). */
export const atlasSetLogPath = (game: GameId, path: string) => invoke<void>("atlas_set_log_path", { game, path });

export type CampaignRewardStage = "not-claimed" | "boss-defeated" | "item-acquired" | "submitted" | "applied" | "complete";
export interface CampaignRewardMark {
  rewardId: string;
  stage: CampaignRewardStage;
  choice: string | null;
  at: number;
}
export const campaignRewardMarks = (game: GameId, characterId: number) => invoke<CampaignRewardMark[]>("campaign_reward_marks", { game, characterId });
/** `stage = null` removes the player's reward mark. */
export const campaignSetRewardMark = (game: GameId, characterId: number, rewardId: string, stage: CampaignRewardStage | null, choice: string | null = null) =>
  invoke<void>("campaign_set_reward_mark", { game, characterId, rewardId, stage, choice });

/** Planned-build numbers read from a PoB (PoE 2) build file (`campaign::build_stats`). */
export interface CampaignBuildStats {
  name: string;
  className: string | null;
  ascendClassName: string | null;
  level: number | null;
  stats: Record<string, number>;
}
/** `rel` = "folder/name" as listed by `pobBuilds` (folder may be empty). */
export const campaignBuildStats = (game: GameId, rel: string) => invoke<CampaignBuildStats>("campaign_build_stats", { game, rel });

// ---------- Act Tracker (PoE 1) overlay window (src-tauri/src/act_tracker.rs) ----------

export interface ActTrackerWindowState {
  open: boolean;
  visible: boolean;
  clickThrough: boolean;
}
/** Emitted by Rust whenever the overlay is shown, hidden, closed or click-through changes. */
export const ACT_TRACKER_STATE_EVENT = "act-tracker:state";
/** Shows the overlay (created on first use) without taking focus from the game. */
export const actTrackerOpen = (game: GameId) => invoke<ActTrackerWindowState>("act_tracker_open", { game });
export const actTrackerHide = (game: GameId) => invoke<ActTrackerWindowState>("act_tracker_hide", { game });
/** Destroys the overlay window. */
export const actTrackerClose = (game: GameId) => invoke<ActTrackerWindowState>("act_tracker_close", { game });
export const actTrackerState = (game: GameId) => invoke<ActTrackerWindowState>("act_tracker_state", { game });
export const actTrackerSetClickThrough = (game: GameId, on: boolean) =>
  invoke<ActTrackerWindowState>("act_tracker_set_click_through", { game, on });
/** "" turns the show/hide hotkey off; it is registered only while PoE 1 is the foreground window. */
export const actTrackerSetHotkey = (game: GameId, hotkey: string) => invoke<void>("act_tracker_set_hotkey", { game, hotkey });
/** The foreground-only hotkeys currently registered (`overlay::OverlayStatus`). */
export interface HotkeyStatus {
  foregroundGame: GameId | null;
  registeredHotkey: string | null;
  trackerHotkey: string | null;
  /** Loot Tracker keys (PoE 2) and whether Windows accepted them. */
  lootHotkeys: { action: LootHotkeyAction; key: string; registered: boolean; error: string | null }[];
  /** Deck Intelligence ground-screenshot key (PoE 1). */
  deckHotkey?: DeckKeyState;
  /** Show/hide-Vaalytics key (`main_window`), registered while a PoE window or Vaalytics is in the foreground. */
  mainHotkey?: DeckKeyState;
}
export const HOTKEY_STATUS_EVENT = "overlay:status";
/** App setting read by `mainWindowSetHotkey`'s Rust side. */
export const MAIN_WINDOW_HOTKEY_KEY = "mainWindow.hotkey";
export const MAIN_WINDOW_HOTKEY_DEFAULT = "Insert";
/** "" turns it off. Rejects with a reason (reserved key, or used by another Vaalytics feature). Applies immediately. */
export const mainWindowSetHotkey = (hotkey: string) => invoke<void>("main_window_set_hotkey", { hotkey });
export const hotkeyStatus = () => invoke<HotkeyStatus>("overlay_status");

// ---------- Deck Intelligence (src-tauri/src/decks, PoE 1) ----------

export type DeckAcquisition = "individual" | "bulk" | "farmed" | "free" | "unknown";
export type DeckSessionStatus = "running" | "paused" | "finished";
export type DeckEventStatus = "confirmed" | "review" | "unrecognized" | "removed";
export type DeckEventSource = "ocr" | "log" | "manual" | "import";

export interface DivinationCard {
  name: string;
  stackSize: number | null;
  /** Reward text without game markup ("3x Chaos Orb"). */
  reward: string;
  rewardKind: string;
  dropLevel: number | null;
  legacy: boolean;
}
export interface DivinationCardDb {
  cards: DivinationCard[];
  checkedAt: number;
  source: string;
  sourceModified: string | null;
  staleError: string | null;
}
export interface DeckRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface DeckThresholds {
  autoConfirm: number;
  review: number;
  unrecognized: number;
}
export interface DeckConfig {
  logTracking: boolean;
  groundTracking: boolean;
  /** "" = off. Registered only while PoE 1 is in the foreground. */
  hotkey: string;
  region: DeckRegion;
  thresholds: DeckThresholds;
  dedupeSecs: number;
  dedupeTolerance: number;
  keepScreenshots: boolean;
  /** Every session also as a JSON file outside the app data folder (survives uninstalling). */
  backupEnabled: boolean;
  /** "" = Documents\\Vaalytics\\Deck Intelligence. */
  backupDir: string;
}
export interface DeckSessionInput {
  name: string;
  league: string | null;
  openedOn: string | null;
  plannedDecks: number | null;
  /** Decks opened so far, entered by the user; null = count confirmed cards. */
  openedDecks: number | null;
  acquisition: DeckAcquisition;
  /** Chaos; null = unknown. */
  costTotal: number | null;
  notes: string | null;
}
export interface DeckSession {
  id: number;
  name: string;
  league: string | null;
  createdAt: number;
  openedOn: string | null;
  status: DeckSessionStatus;
  origin: "live" | "import";
  startedAt: number;
  endedAt: number | null;
  activeSecs: number;
  resumedAt: number | null;
  plannedDecks: number | null;
  /** Decks opened so far, entered by the user; null = count confirmed cards. */
  openedDecks: number | null;
  acquisition: DeckAcquisition;
  costTotal: number | null;
  notes: string | null;
}
export interface DeckValuationLine {
  card: string;
  qty: number;
  unit: number | null;
  source: "market" | "manual" | null;
}
export interface DeckValuation {
  valuedAt: number;
  league: string | null;
  pricesAt: number | null;
  totalValue: number;
  pricedCards: number;
  unpricedCards: number;
  lines: DeckValuationLine[];
}
export interface DeckSessionSummary extends DeckSession {
  confirmed: number;
  review: number;
  unrecognized: number;
  firstCardAt: number | null;
  lastCardAt: number | null;
  valuation: DeckValuation | null;
}
export interface DeckEvent {
  id: number;
  sessionId: number;
  at: number;
  source: DeckEventSource;
  captureId: number | null;
  recognizedText: string | null;
  recognizedCard: string | null;
  confidence: number;
  bbox: DeckRegion | null;
  card: string | null;
  status: DeckEventStatus;
  reviewReason: string | null;
  corrected: boolean;
}
export interface DeckCapture {
  id: number;
  sessionId: number;
  takenAt: number;
  source: "hotkey" | "file";
  hasImage: boolean;
  width: number;
  height: number;
  ocrLines: number;
  ignoredLines: number;
  error: string | null;
}
export interface DeckSessionDetail {
  session: DeckSession;
  events: DeckEvent[];
  captures: DeckCapture[];
  valuation: DeckValuation | null;
}
export interface DeckCardTotal {
  sessionId: number;
  card: string;
  qty: number;
  firstAt: number;
  lastAt: number;
}
export interface DeckDetectedEvent {
  sessionId: number | null;
  source: "ocr" | "log";
  cards: { id: number; card: string | null; status: DeckEventStatus; unit: number | null }[];
  ignored: number;
  captureId: number | null;
  error: string | null;
  /** Estimated value of the session's confirmed cards after this change (priced only). */
  sessionValue: number | null;
  sessionCost: number | null;
}
export interface DeckLogStatus {
  path: string | null;
  watching: boolean;
  lastReadAt: number | null;
  error: string | null;
}
export interface DeckImportStatus {
  running: boolean;
  file: string | null;
  bytesDone: number;
  bytesTotal: number;
  cardsFound: number;
  sessionsCreated: number;
  cardsAdded: number;
  duplicates: number;
  finished: boolean;
  cancelled: boolean;
  error: string | null;
}
export interface DeckKeyState {
  key: string | null;
  registered: boolean;
  error: string | null;
}
/** A session changed (payload: session id, 0 = several). */
export const DECKS_UPDATED_EVENT = "decks:updated";
/** Cards arrived from Client.txt or a screenshot (or a screenshot failed). */
export const DECKS_DETECTED_EVENT = "decks:detected";
export const DECKS_IMPORT_EVENT = "decks:import";

export const decksCards = (game: GameId, force = false) => invoke<DivinationCardDb>("decks_cards", { game, force });
export const decksConfig = (game: GameId) => invoke<DeckConfig>("decks_config", { game });
export const decksSetConfig = (game: GameId, config: DeckConfig) => invoke<DeckConfig>("decks_set_config", { game, config });
export const decksSessions = (game: GameId) => invoke<DeckSessionSummary[]>("decks_sessions", { game });
export const decksSession = (game: GameId, id: number) => invoke<DeckSessionDetail>("decks_session", { game, id });
export const decksCardTotals = (game: GameId) => invoke<DeckCardTotal[]>("decks_card_totals", { game });
export const decksCreate = (game: GameId, input: DeckSessionInput) => invoke<number>("decks_create", { game, input });
export const decksUpdate = (game: GameId, id: number, input: DeckSessionInput) => invoke<void>("decks_update", { game, id, input });
export const decksPause = (game: GameId, id: number) => invoke<void>("decks_pause", { game, id });
/** null = count confirmed cards again. */
export const decksSetOpened = (game: GameId, id: number, opened: number | null) => invoke<void>("decks_set_opened", { game, id, opened });
export const decksResume = (game: GameId, id: number) => invoke<void>("decks_resume", { game, id });
export const decksFinish = (game: GameId, id: number) => invoke<DeckValuation>("decks_finish", { game, id });
export const decksDelete = (game: GameId, id: number) => invoke<void>("decks_delete", { game, id });
export const decksEventConfirm = (game: GameId, id: number) => invoke<void>("decks_event_confirm", { game, id });
export const decksEventRemove = (game: GameId, id: number) => invoke<void>("decks_event_remove", { game, id });
export const decksEventRestore = (game: GameId, id: number) => invoke<void>("decks_event_restore", { game, id });
export const decksEventCorrect = (game: GameId, id: number, card: string) => invoke<void>("decks_event_correct", { game, id, card });
export const decksAddManual = (game: GameId, sessionId: number, card: string, qty: number) => invoke<number>("decks_add_manual", { game, sessionId, card, qty });
/** Opens a file dialog; null = cancelled. */
export const decksRecognizeFile = (game: GameId, sessionId: number) => invoke<DeckDetectedEvent | null>("decks_recognize_file", { game, sessionId });
export const decksRetryCapture = (game: GameId, captureId: number) => invoke<DeckDetectedEvent>("decks_retry_capture", { game, captureId });
/** data: URL of the kept screenshot, or null when it wasn't kept. */
export const decksCaptureImage = (game: GameId, captureId: number) => invoke<string | null>("decks_capture_image", { game, captureId });
export const decksPriceOverrides = (game: GameId, league: string) => invoke<Record<string, number>>("decks_price_overrides", { game, league });
export const decksSetPriceOverride = (game: GameId, league: string, card: string, value: number | null) =>
  invoke<void>("decks_set_price_override", { game, league, card, value });
export const decksLogStatus = (game: GameId) => invoke<DeckLogStatus>("decks_log_status", { game });
/** Opens a file dialog; false = cancelled. Progress arrives as DECKS_IMPORT_EVENT. */
export const decksImportStart = (game: GameId, options: { league: string | null; splitGapMinutes: number }) =>
  invoke<boolean>("decks_import_start", { game, options });
export const decksImportCancel = (game: GameId) => invoke<void>("decks_import_cancel", { game });
export const decksImportStatus = (game: GameId) => invoke<DeckImportStatus>("decks_import_status", { game });
export const decksHotkeyStatus = (game: GameId) => invoke<DeckKeyState>("decks_hotkey_status", { game });
/** Save dialog for a CSV / JSON export; false = cancelled. */
export const decksSaveExport = (game: GameId, fileName: string, contents: string) => invoke<boolean>("decks_save_export", { game, fileName, contents });

// ---------- Update Center (src-tauri/src/updates) ----------

export type UpdReliability = "official" | "structured" | "community" | "unverified";
export type UpdValidation = "passed" | "warnings" | "review" | "failed";
export type UpdDatasetKind = "versioned" | "managed" | "bundled";
export type UpdGroup = "gameData" | "leagues" | "patchNotes" | "market" | "bundled";
export type UpdChangeType =
  | "added"
  | "modified"
  | "removed"
  | "deprecated"
  | "reclassified"
  | "price_updated"
  | "description_updated"
  | "metadata_updated"
  | "structural"
  | "unknown";
export type UpdConfidence = "confirmed" | "high" | "review" | "unverified";

export interface UpdProviderMeta {
  id: string;
  name: string;
  reliability: UpdReliability;
  games: GameId[];
  categories: string[];
  website: string;
  endpoints: string[];
  auth: string;
  rateLimit: string;
  cachePolicy: string;
  terms: string;
  via: string | null;
}

export interface UpdSourceState {
  providerId: string;
  enabled: boolean;
  status: "unknown" | "ok" | "warning" | "error";
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastErrorKind: string | null;
  lastDurationMs: number | null;
  lastBytes: number | null;
}

export interface UpdDatasetDef {
  id: string;
  game: GameId;
  label: string;
  category: string;
  providerId: string;
  kind: UpdDatasetKind;
  policy: "auto" | "review";
  group: UpdGroup;
  format: number;
  minEntries: number;
  requiredFields: string[];
  description: string;
}

export interface UpdValidationNote {
  level: UpdValidation;
  message: string;
}

export interface UpdVersion {
  id: number;
  datasetId: string;
  game: GameId;
  league: string | null;
  format: number;
  label: string;
  contentHash: string;
  entryCount: number;
  providerId: string;
  sourceUrl: string | null;
  sourceVersion: string | null;
  retrievedAt: number;
  createdAt: number;
  installedAt: number | null;
  status: "staged" | "installed" | "previous" | "discarded";
  origin: "source" | "partial" | "imported";
  validation: UpdValidation;
  validationNotes: UpdValidationNote[];
  parentId: number | null;
  hasContent: boolean;
}

export interface UpdDatasetState {
  etag?: string | null;
  sourceModified: string | null;
  lastCheckedAt: number | null;
  lastError: string | null;
}

export interface UpdMarketState {
  league: string;
  categories: number;
  oldestFetch: number | null;
  newestFetch: number | null;
  errors: number;
  lastError: string | null;
  items: number;
}

export interface UpdDatasetStatus {
  def: UpdDatasetDef;
  consumers: string[];
  installed: UpdVersion | null;
  staged: UpdVersion | null;
  state: UpdDatasetState;
  pending: number;
  pendingReview: number;
  market: UpdMarketState | null;
  cacheWrittenAt: number | null;
  intervalSecs: number | null;
}

export interface UpdModuleRegistration {
  moduleId: string;
  game: GameId;
  required: string[];
  optional: string[];
  autoUpdate: boolean;
  manualReview: boolean;
  note: string;
}

export interface UpdSettings {
  schedules: { gameData: string; leagues: string; patchNotes: string };
  autoApply: boolean;
  retention: number;
}

export interface UpdProgress {
  checkId: number;
  kind: "check" | "sync";
  trigger: string;
  startedAt: number;
  operation: string;
  providerId: string | null;
  game: GameId | null;
  datasetId: string | null;
  done: number;
  total: number;
  errors: string[];
}

export interface UpdOverview {
  now: number;
  datasets: UpdDatasetStatus[];
  sources: { meta: UpdProviderMeta; state: UpdSourceState; datasets: string[] }[];
  modules: UpdModuleRegistration[];
  lastAttempt: number | null;
  lastSuccess: number | null;
  running: UpdProgress | null;
  settings: UpdSettings;
  selectedLeagues: Record<GameId, string | null>;
  articlesUnreviewed: number;
}

export interface UpdFailure {
  providerId: string;
  datasetId: string | null;
  operation: string;
  error: string;
  kind: string;
  retryable: boolean;
  existingDataUsable: boolean;
}

export interface UpdReport {
  checkId: number;
  kind: "check" | "sync";
  status: "ok" | "partial" | "failed";
  tasks: number;
  succeeded: number;
  unchanged: string[];
  staged: { datasetId: string; versionId: number; changes: number; needsReview: boolean; validation: UpdValidation; summary: string }[];
  applied: { datasetId: string; versionId: number }[];
  failures: UpdFailure[];
  newArticles: number;
  processedArticles: number;
  durationMs: number;
}

export interface UpdChange {
  id: number;
  checkId: number;
  versionId: number | null;
  datasetId: string;
  game: GameId;
  entryKey: string;
  entryName: string;
  changeType: UpdChangeType;
  fields: string[];
  before: { name: string; data: Record<string, JsonValue> } | null;
  after: { name: string; data: Record<string, JsonValue> } | null;
  confidence: UpdConfidence;
  requiresReview: boolean;
  status: "pending" | "applied" | "ignored" | "superseded";
  reviewed: boolean;
  detectedAt: number;
  resolvedAt: number | null;
}

export interface UpdEvent {
  id: number;
  ts: number;
  checkId: number | null;
  kind: string;
  game: GameId | null;
  league: string | null;
  datasetId: string | null;
  providerId: string | null;
  modules: string[];
  fromVersion: number | null;
  toVersion: number | null;
  status: "ok" | "warning" | "error" | "info";
  message: string;
  durationMs: number | null;
}

export interface UpdEventFilter {
  since?: number;
  until?: number;
  game?: GameId;
  league?: string;
  module?: string;
  provider?: string;
  status?: string;
  limit?: number;
}

export interface UpdLeagueProfile {
  game: GameId;
  league: string;
  displayName: string;
  hardcore: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  endedDetectedAt: number | null;
  status: "active" | "ended";
  providerId: string;
}

export interface UpdLeagues {
  profiles: UpdLeagueProfile[];
  withData: { game: GameId; league: string; historyPoints: number; lastPointAt: number }[];
  installed: { datasetId: string; game: GameId; versionId: number; label: string; installedAt: number | null }[];
  selected: Record<GameId, string | null>;
}

export interface UpdImpact {
  category: string;
  lines: number;
  datasets: string[];
  modules: string[];
  action: "data" | "developer" | "info";
  recommendation: string;
  confidence: UpdConfidence;
  examples: string[];
}

export interface UpdArticleAnalysis {
  classifier: string;
  patch: string | null;
  totalLines: number;
  classifiedLines: number;
  sections: { title: string; lines: { text: string; categories: string[] }[] }[];
  impacts: UpdImpact[];
}

export interface UpdArticle {
  providerId: string;
  articleId: string;
  game: GameId | null;
  kind: "patch_notes" | "hotfix" | "announcement" | "news";
  title: string;
  url: string;
  publishedAt: number | null;
  discoveredAt: number;
  processedAt: number | null;
  processError: string | null;
  analysis: UpdArticleAnalysis | null;
  reviewed: boolean;
}

export interface UpdAnalytics {
  runs: number;
  runsOk: number;
  runsPartial: number;
  runsFailed: number;
  avgDurationSecs: number | null;
  changesDetected: number;
  changesApplied: number;
  changesIgnored: number;
  versionsInstalled: number;
  rollbacks: number;
  byDataset: [string, number][];
  activity: [number, number, number][];
}

export interface UpdAppInfo {
  version: string;
  updaterConfigured: boolean;
  distribution: string;
}

export const UPDATES_PROGRESS_EVENT = "updates:progress";
export const UPDATES_FINISHED_EVENT = "updates:finished";
export const UPDATES_DATASET_CHANGED_EVENT = "updates:dataset-changed";

export const updatesOverview = () => invoke<UpdOverview>("updates_overview");
/** `check` discovers only; `sync` also applies what the update policy allows. */
export const updatesRun = (mode: "check" | "sync", groups: ("gameData" | "leagues" | "patchNotes")[] = []) => invoke<UpdReport>("updates_run", { mode, groups });
export const updatesApply = (datasetId: string, changeIds?: number[]) => invoke<number>("updates_apply", { datasetId, changeIds: changeIds ?? null });
export const updatesRollback = (datasetId: string, versionId: number) => invoke<number>("updates_rollback", { datasetId, versionId });
export const updatesChanges = (status?: UpdChange["status"], datasetId?: string, limit?: number) =>
  invoke<UpdChange[]>("updates_changes", { status: status ?? null, datasetId: datasetId ?? null, limit: limit ?? null });
export const updatesSetChangeStatus = (ids: number[], status?: "ignored" | "pending", reviewed?: boolean) =>
  invoke<number>("updates_set_change_status", { ids, status: status ?? null, reviewed: reviewed ?? null });
export const updatesVersions = (datasetId: string) => invoke<UpdVersion[]>("updates_versions", { datasetId });
export const updatesHistory = (filter: UpdEventFilter) => invoke<UpdEvent[]>("updates_history", { filter });
export const updatesLeagues = () => invoke<UpdLeagues>("updates_leagues");
export const updatesArticles = (limit?: number) => invoke<UpdArticle[]>("updates_articles", { limit: limit ?? null });
export const updatesProcessArticle = (providerId: string, articleId: string) => invoke<UpdArticleAnalysis>("updates_process_article", { providerId, articleId });
export const updatesSetArticleReviewed = (providerId: string, articleId: string, reviewed: boolean) =>
  invoke<void>("updates_set_article_reviewed", { providerId, articleId, reviewed });
export const updatesSetSourceEnabled = (providerId: string, enabled: boolean) => invoke<void>("updates_set_source_enabled", { providerId, enabled });
export const updatesTestSource = (providerId: string) =>
  invoke<{ ok: boolean; message: string; kind: string | null; durationMs: number }>("updates_test_source", { providerId });
export const updatesSetSettings = (settings: UpdSettings) => invoke<UpdSettings>("updates_set_settings", { settings });
export const updatesRefreshManaged = (datasetId: string) => invoke<string>("updates_refresh_managed", { datasetId });
export const updatesAnalytics = () => invoke<UpdAnalytics>("updates_analytics");
export const updatesAppInfo = () => invoke<UpdAppInfo>("updates_app_info");
export interface DeckBackupStatus {
  enabled: boolean;
  dir: string;
  lastAt: number | null;
  lastError: string | null;
  files: number;
}
export interface DeckRestoreSummary {
  files: number;
  sessionsAdded: number;
  sessionsSkipped: number;
  cardsAdded: number;
  errors: string[];
}
export const decksBackupStatus = (game: GameId) => invoke<DeckBackupStatus>("decks_backup_status", { game });
export const decksBackupNow = (game: GameId) => invoke<number>("decks_backup_now", { game });
export const decksRestoreBackups = (game: GameId) => invoke<DeckRestoreSummary>("decks_restore_backups", { game });
export const decksOpenBackupDir = (game: GameId) => invoke<void>("decks_open_backup_dir", { game });
