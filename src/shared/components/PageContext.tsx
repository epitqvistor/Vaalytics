import { createContext, useContext } from "react";

/** Where the current page sits (set by the game shell); PageHeader shows it as an eyebrow. */
export interface PageContextValue {
  /** e.g. "Market" */
  group?: string;
  /** e.g. "PoE 1" */
  game?: string;
  /** Registry id of the module on screen. */
  moduleId?: string;
}

export const PageContext = createContext<PageContextValue>({});
export const usePageContext = () => useContext(PageContext);
