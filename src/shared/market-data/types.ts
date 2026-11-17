/** Currency unit used to express market values (e.g. chaos, exalted, divine). */
export interface CurrencyUnit {
  id: string;
  /** Short label shown next to numbers, e.g. "c", "div", "ex". */
  short: string;
  name: string;
}
