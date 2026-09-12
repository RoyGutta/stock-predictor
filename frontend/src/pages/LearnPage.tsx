import { Callout } from "../components/ui";
import { LearnPanel } from "../features/education/LearnPanel";

/** Plain-English explanations of every concept the application uses. */
export function LearnPage() {
  return (
    <div className="page page--single page--narrow">
      <Callout tone="accent">
        <div>
          <p>
            <strong>Why this app refuses to predict.</strong> Every figure here
            describes the past. That is not a missing feature: when trading rules
            are tested honestly — on data they never saw, after costs — most fail
            to beat simply holding the market, and the ones that look brilliant
            usually got there through overfitting or lookahead bias. Both concepts
            are explained below, and the Analyze page's backtest and pattern tools
            let you catch them in the act.
          </p>
        </div>
      </Callout>
      <LearnPanel />
    </div>
  );
}
