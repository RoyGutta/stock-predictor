import { Card } from "../../components/ui";
import { Link } from "../../app/router";
import type { Page } from "../../app/routes";
import "./education.css";

/**
 * First-run orientation: each tool named by the question it answers, then the
 * two things a newcomer deserves to know up front — why nothing here predicts,
 * and where the numbers come from. Static and always visible rather than a
 * dismissable tour: the answers stay useful after the first visit.
 */

const TOOLS: Array<{ page: Page; name: string; question: string; detail: string }> = [
  {
    page: "analyze",
    name: "Analyze",
    question: "What has this security actually done?",
    detail:
      "Price history, standard indicators, risk statistics, historical patterns, and a backtest of textbook rules -- all measured from real data, none of it a forecast.",
  },
  {
    page: "explore",
    name: "Explore",
    question: "What kinds of funds exist?",
    detail:
      "Match a fully disclosed list of 20 ETFs against preferences you choose. Every criterion shows the measurement behind it, and funds that miss are shown, not hidden.",
  },
  {
    page: "compare",
    name: "Compare",
    question: "How do these securities differ?",
    detail:
      "Two to six tickers over the identical window with the identical method. Differences and relationships -- never a ranking or a winner.",
  },
  {
    page: "portfolio",
    name: "Portfolio",
    question: "What would a mix of funds have done?",
    detail:
      "Replay fixed weights with monthly contributions through real history, against the same cash flows into an S&P 500 fund. Deposits are never counted as returns.",
  },
  {
    page: "learn",
    name: "Learn",
    question: "What do these words mean?",
    detail:
      "Plain-English explanations, each ending with what the concept cannot tell you.",
  },
];

export function ToolGuide() {
  return (
    <Card title="What each tool does" as="section">
      <ul className="toolguide">
        {TOOLS.map((tool) => (
          <li key={tool.page} className="toolguide__item">
            <Link to={tool.page} className="toolguide__name">
              {tool.name}
            </Link>
            <div className="toolguide__text">
              <span className="toolguide__question">{tool.question}</span>
              <span className="toolguide__detail">{tool.detail}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="toolguide__notes">
        <p>
          <strong>Why nothing here predicts.</strong> Tested honestly -- on data the
          rule never saw, after transaction costs -- most strategies fail to beat
          simply holding the market, and impressive-looking history is usually luck
          or leakage. Instead of pretending otherwise, this app hands you the
          instruments to see that for yourself: the backtest, the pattern scanner,
          and the <Link to="learn">Learn</Link> entries on overfitting and lookahead
          bias.
        </p>
        <p>
          <strong>Where the numbers come from.</strong> Public market-data providers
          supply the prices, news, and company data. Quotes can be delayed and carry
          their own timestamp; every statistic states its window and sample size,
          and anything missing is shown as missing -- never as zero.
        </p>
      </div>
    </Card>
  );
}
