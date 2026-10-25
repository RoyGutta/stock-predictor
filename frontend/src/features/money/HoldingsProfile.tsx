import { useState, type FormEvent } from "react";

import { Button, Callout, Card } from "../../components/ui";
import type { Profile } from "./planning";

type Risk = Profile["risk_tolerance"];
type Experience = Profile["experience"];

function wholeOrNull(text: string, max: number): number | null | "invalid" {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : "invalid";
}

export function ProfileCard({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (p: Profile) => void;
}) {
  const [risk, setRisk] = useState<Risk>(profile.risk_tolerance);
  const [horizon, setHorizon] = useState(
    profile.horizon_years == null ? "" : String(profile.horizon_years),
  );
  const [months, setMonths] = useState(
    profile.emergency_months_target == null
      ? ""
      : String(profile.emergency_months_target),
  );
  const [excluded, setExcluded] = useState(profile.excluded_sectors.join(", "));
  const [experience, setExperience] = useState<Experience>(profile.experience);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const h = wholeOrNull(horizon, 100);
    const m = wholeOrNull(months, 60);
    const problems: string[] = [];
    if (h === "invalid")
      problems.push("Horizon must be whole years, 0 to 100.");
    if (m === "invalid")
      problems.push("Months must be a whole number, 0 to 60.");
    setErrors(problems);
    setSaved(false);
    if (problems.length) return;
    const sectors = [
      ...new Set(
        excluded
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    onSave({
      risk_tolerance: risk,
      horizon_years: h as number | null,
      emergency_months_target: m as number | null,
      excluded_sectors: sectors,
      experience,
    });
    setSaved(true);
  };

  return (
    <Card title="Your profile (optional)">
      <p className="money-basis">
        Every field is optional and stays in this browser. It is used only as
        context: excluded sectors are pointed out in the concentration section.
        Nothing here changes how values are computed.
      </p>
      <form className="money-form" onSubmit={submit} noValidate>
        <label>
          Comfort with ups and downs
          <select
            value={risk ?? ""}
            onChange={(e) => setRisk((e.target.value || null) as Risk)}
          >
            <option value="">Not set</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          Years until you expect to use this money
          <input
            value={horizon}
            inputMode="numeric"
            onChange={(e) => setHorizon(e.target.value)}
          />
        </label>
        <label>
          Months of essential spending to keep in reserve
          <input
            value={months}
            inputMode="numeric"
            onChange={(e) => setMonths(e.target.value)}
          />
        </label>
        <label>
          Investing experience
          <select
            value={experience ?? ""}
            onChange={(e) =>
              setExperience((e.target.value || null) as Experience)
            }
          >
            <option value="">Not set</option>
            <option value="new">New to it</option>
            <option value="some">Some</option>
            <option value="experienced">Experienced</option>
          </select>
        </label>
        <label className="money-form__wide">
          Sectors you want to avoid (comma-separated)
          <input
            value={excluded}
            maxLength={400}
            onChange={(e) => setExcluded(e.target.value)}
          />
        </label>
        {errors.length > 0 && (
          <div className="money-form__wide">
            <Callout tone="error" role="alert">
              {errors.join(" ")}
            </Callout>
          </div>
        )}
        <div className="money-actions money-form__wide">
          <Button type="submit">Save profile</Button>
          {saved && (
            <span className="money-basis" role="status">
              Saved.
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}
