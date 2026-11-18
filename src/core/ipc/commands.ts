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

// ---------- farming lab (src-tauri/src/farming.rs) ----------

/** Shape owned by the PoE 1 Farming Lab module; the host validates and stores it. */
export interface FarmingSessionRecord {
  id: string;
  league: string;
  strategy: string;
  startedAt: number;
  durationSecs: number;
  maps: number;
  data: JsonValue;
  savedAt: number;
}

export const farmingSessions = (game: GameId, league: string) => invoke<FarmingSessionRecord[]>("farming_sessions", { game, league });
export const farmingSaveSession = (game: GameId, session: FarmingSessionRecord) => invoke<void>("farming_save_session", { game, session });
export const farmingDeleteSession = (game: GameId, id: string) => invoke<void>("farming_delete_session", { game, id });

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
}

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

export type LootSort = "newest" | "oldest" | "value_desc" | "value_asc" | "category";
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
  kind: "zone" | "passive_points" | "weapon_set_points" | "level" | "ascended" | "death";
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
