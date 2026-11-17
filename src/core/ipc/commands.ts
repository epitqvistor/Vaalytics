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
