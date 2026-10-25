import { EMPTY } from "../../lib/format";
import type {
  ScreenerRow,
  ScreenerSortKey,
  SortOrder,
} from "../../types/screener";
import { formatReported } from "../sec/secFormat";
import { SIZE_BAND_LABELS } from "./savedCriteria";

interface Column {
  key: ScreenerSortKey;
  label: string;
  render: (row: ScreenerRow) => string;
}

function pct(value: number | null): string {
  return value == null || !Number.isFinite(value)
    ? EMPTY
    : `${value.toFixed(1)}%`;
}

function usd(value: number | null): string {
  return formatReported(value, "USD");
}

const COLUMNS: Column[] = [
  { key: "revenue", label: "Revenue", render: (r) => usd(r.revenue) },
  {
    key: "revenue_growth_pct",
    label: "Revenue growth",
    render: (r) => pct(r.revenue_growth_pct),
  },
  { key: "net_income", label: "Net income", render: (r) => usd(r.net_income) },
  {
    key: "net_margin_pct",
    label: "Net margin",
    render: (r) => pct(r.net_margin_pct),
  },
  {
    key: "operating_cash_flow",
    label: "Operating cash flow",
    render: (r) => usd(r.operating_cash_flow),
  },
  {
    key: "ocf_margin_pct",
    label: "OCF margin",
    render: (r) => pct(r.ocf_margin_pct),
  },
  {
    key: "free_cash_flow",
    label: "Free cash flow",
    render: (r) => usd(r.free_cash_flow),
  },
  {
    key: "liabilities_to_assets",
    label: "Liabilities / assets",
    render: (r) =>
      r.liabilities_to_assets == null
        ? EMPTY
        : r.liabilities_to_assets.toFixed(2),
  },
];

function ariaSort(
  key: ScreenerSortKey,
  sort: ScreenerSortKey,
  order: SortOrder,
): "ascending" | "descending" | "none" {
  if (key !== sort) return "none";
  return order === "asc" ? "ascending" : "descending";
}

function SortButton({
  column,
  label,
  sort,
  order,
  onSort,
}: {
  column: ScreenerSortKey;
  label: string;
  sort: ScreenerSortKey;
  order: SortOrder;
  onSort: (key: ScreenerSortKey) => void;
}) {
  const glyph = column === sort ? (order === "asc" ? " ▲" : " ▼") : "";
  return (
    <button
      type="button"
      className="sec-table__measure"
      onClick={() => onSort(column)}
    >
      {label}
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/** Results with sortable headers. Unknown figures show a dash, never 0. */
export function ScreenerTable({
  rows,
  sort,
  order,
  onSort,
  caption,
}: {
  rows: ScreenerRow[];
  sort: ScreenerSortKey;
  order: SortOrder;
  onSort: (key: ScreenerSortKey) => void;
  caption: string;
}) {
  return (
    <div className="sec-table-scroll">
      <table className="sec-table screener-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" aria-sort={ariaSort("name", sort, order)}>
              <SortButton
                column="name"
                label="Company"
                sort={sort}
                order={order}
                onSort={onSort}
              />
            </th>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={ariaSort(column.key, sort, order)}
              >
                <SortButton
                  column={column.key}
                  label={column.label}
                  sort={sort}
                  order={order}
                  onSort={onSort}
                />
              </th>
            ))}
            <th scope="col">Size band</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.cik}>
              <th scope="row">
                <a
                  href={row.edgar_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {row.name ?? `CIK ${row.cik}`}{" "}
                  <span className="visually-hidden">
                    (EDGAR, opens in a new tab)
                  </span>
                </a>
                <span className="sec-table__tag">
                  CIK {row.cik}
                  {row.period_end ? ` · period ended ${row.period_end}` : ""}
                </span>
              </th>
              {COLUMNS.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
              <td>{row.size_band ? SIZE_BAND_LABELS[row.size_band] : EMPTY}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
