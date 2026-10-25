import { useState, type FormEvent } from "react";

import { Button, Callout, Card } from "../../components/ui";
import { holdingAccounts } from "./holdings";
import { isIsoDate, newId, parseMoney, todayIso, type Account } from "./model";
import { ASSET_CLASS_LABELS, type AssetClass, type Holding } from "./planning";

const centsText = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));

export function HoldingForm({
  initial,
  accounts,
  onSave,
  onCancel,
}: {
  initial: Holding | null;
  accounts: Account[];
  onSave: (h: Holding) => void;
  onCancel: () => void;
}) {
  const choices = holdingAccounts(accounts, initial?.account_id ?? null);
  const [accountId, setAccountId] = useState(
    initial?.account_id ?? choices[0]?.id ?? "",
  );
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [quantity, setQuantity] = useState(
    initial ? String(initial.quantity) : "",
  );
  const [cost, setCost] = useState(
    centsText(initial?.cost_basis_cents ?? null),
  );
  const [acquired, setAcquired] = useState(initial?.acquired_date ?? "");
  const [price, setPrice] = useState(centsText(initial?.price_cents ?? null));
  const [priceDate, setPriceDate] = useState(initial?.price_date ?? "");
  const [assetClass, setAssetClass] = useState<AssetClass>(
    initial?.asset_class ?? "us_stock",
  );
  const [sector, setSector] = useState(initial?.sector ?? "");
  const [errors, setErrors] = useState<string[]>([]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const today = todayIso();
    const problems: string[] = [];
    if (!choices.some((a) => a.id === accountId))
      problems.push("Choose the account that holds it.");
    if (!symbol.trim() && !name.trim())
      problems.push("Enter a symbol or a name.");
    const qty = Number(quantity.trim());
    if (quantity.trim() === "" || !Number.isFinite(qty) || qty <= 0)
      problems.push("Quantity must be a number above zero, e.g. 12.5.");
    const costCents = cost.trim() === "" ? null : parseMoney(cost);
    if (cost.trim() !== "" && costCents === null)
      problems.push("Cost basis must be an amount such as 1500.00.");
    const priceCents = price.trim() === "" ? null : parseMoney(price);
    if (price.trim() !== "" && priceCents === null)
      problems.push("Price must be an amount such as 101.25.");
    if (priceCents !== null && !isIsoDate(priceDate))
      problems.push("Enter the date the price applies to.");
    if (priceCents === null && priceDate !== "")
      problems.push("A price date needs a price; enter both or neither.");
    if (isIsoDate(priceDate) && priceDate > today)
      problems.push("The price date cannot be in the future.");
    if (acquired !== "" && !isIsoDate(acquired))
      problems.push("Enter a valid acquired date or leave it blank.");
    setErrors(problems);
    if (problems.length) return;
    onSave({
      id: initial?.id ?? newId(),
      account_id: accountId,
      symbol: symbol.trim().toUpperCase(),
      name: name.trim(),
      quantity: qty,
      cost_basis_cents: costCents,
      acquired_date: acquired || null,
      price_cents: priceCents,
      price_date: priceCents === null ? null : priceDate,
      asset_class: assetClass,
      sector: sector.trim(),
    });
  };

  return (
    <Card
      title={
        initial ? `Edit ${initial.symbol || initial.name}` : "Add a holding"
      }
    >
      <form className="money-form" onSubmit={submit} noValidate>
        <label>
          Account
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {choices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Symbol (optional if named)
          <input
            value={symbol}
            maxLength={20}
            onChange={(e) => setSymbol(e.target.value)}
          />
        </label>
        <label>
          Name
          <input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Quantity (shares or units)
          <input
            value={quantity}
            inputMode="decimal"
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label>
          Total cost basis (optional)
          <input
            value={cost}
            inputMode="decimal"
            placeholder="0.00"
            onChange={(e) => setCost(e.target.value)}
          />
        </label>
        <label>
          Acquired on (optional)
          <input
            type="date"
            value={acquired}
            onChange={(e) => setAcquired(e.target.value)}
          />
        </label>
        <label>
          Price per unit you looked up
          <input
            value={price}
            inputMode="decimal"
            placeholder="0.00"
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <label>
          Date of that price
          <input
            type="date"
            value={priceDate}
            onChange={(e) => setPriceDate(e.target.value)}
          />
        </label>
        <label>
          Asset class
          <select
            value={assetClass}
            onChange={(e) => setAssetClass(e.target.value as AssetClass)}
          >
            {Object.entries(ASSET_CLASS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sector (optional, e.g. Technology)
          <input
            value={sector}
            maxLength={60}
            onChange={(e) => setSector(e.target.value)}
          />
        </label>
        <p className="money-basis money-form__wide">
          Without a price and its date, the holding is listed as needing a price
          and is left out of totals and allocation.
        </p>
        {errors.length > 0 && (
          <div className="money-form__wide">
            <Callout tone="error" role="alert">
              {errors.join(" ")}
            </Callout>
          </div>
        )}
        <div className="money-actions money-form__wide">
          <Button type="submit" variant="primary">
            Save holding
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
