/**
 * The statement model.
 *
 * A scenario is one company's balance sheet and income statement for a few
 * periods, as versioned data. Line items carry the numbers. Totals carry a
 * formula and, where the exhibit prints one, the printed figure to check the
 * formula against. Totals are never stored as editable numbers.
 */

export type StatementKind = 'balance_sheet' | 'income_statement';

export type NormalBalance = 'debit' | 'credit';

export interface Period {
  /** Short stable id, for example "FY2021". */
  readonly id: string;
  /** Label as shown to students. */
  readonly label: string;
  /** Period end date as printed in the exhibit, ISO format. */
  readonly endDate: string;
  /** Transcription note, for example a column that is mislabeled in the exhibit. */
  readonly note?: string;
}

export interface LineItem {
  readonly id: string;
  readonly label: string;
  readonly statement: StatementKind;
  readonly section: string;
  readonly normalBalance: NormalBalance;
  /**
   * Whole $ millions by period id, in the item's natural orientation: an
   * expense of 52 is stored as 52. A period the exhibit does not report is
   * absent. A dash in the exhibit is stored as 0.
   */
  readonly values: Readonly<Record<string, number>>;
  /** The exhibit table this item was transcribed from. */
  readonly sourceRef: string;
}

export interface Term {
  /** Id of a line item or of another total. */
  readonly ref: string;
  /** 1 to add, -1 to subtract. */
  readonly sign: 1 | -1;
}

export interface Total {
  readonly id: string;
  readonly label: string;
  readonly statement: StatementKind;
  readonly section: string;
  readonly normalBalance: NormalBalance;
  readonly terms: readonly Term[];
  /**
   * The figure printed in the exhibit, by period id. Absent when the exhibit
   * prints no such line and the total exists only for the engine's use.
   */
  readonly printed?: Readonly<Record<string, number>>;
  readonly sourceRef: string;
}

export type FactUnit = 'usd_millions' | 'usd_per_share' | 'shares_millions';

/** A reported figure that is not a statement line, such as a share count. */
export interface Fact {
  readonly id: string;
  readonly label: string;
  readonly unit: FactUnit;
  readonly values: Readonly<Record<string, number>>;
  readonly sourceRef: string;
}

/** A printed per-share figure that should equal numerator / denominator. */
export interface PerShareCheck {
  /** Id of the fact holding the printed result, for example "eps_basic". */
  readonly result: string;
  /** Id of a line item or total. */
  readonly numerator: string;
  /** Id of a fact, for example a weighted share count. */
  readonly denominator: string;
  /** Decimal places the exhibit prints. */
  readonly decimals: number;
}

export interface BalanceIdentity {
  /** Id of the total for assets. */
  readonly assets: string;
  /** Id of the total for liabilities plus equity. */
  readonly liabilitiesAndEquity: string;
}

export interface ScenarioSource {
  /** For example "Exhibit 1". */
  readonly exhibit: string;
  /** Path of the source document in this repository. */
  readonly file: string;
  readonly citation: string;
}

export interface AlteredNotice {
  /**
   * Periods whose figures were invented for teaching. Such a period is not
   * expected to be internally consistent, so nothing in this repository
   * asserts that it foots.
   */
  readonly periods: readonly string[];
  /** The notice every screen and export must show with those figures. */
  readonly notice: string;
}

export interface Scenario {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly company: string;
  /** "exhibit" data is transcribed from a source document. "synthetic" data is invented for tests. */
  readonly kind: 'exhibit' | 'synthetic';
  readonly unit: 'USD millions';
  readonly source: ScenarioSource;
  readonly altered?: AlteredNotice;
  readonly periods: readonly Period[];
  readonly lineItems: readonly LineItem[];
  readonly totals: readonly Total[];
  readonly facts: readonly Fact[];
  readonly perShareChecks: readonly PerShareCheck[];
  readonly balanceIdentity: BalanceIdentity;
}
