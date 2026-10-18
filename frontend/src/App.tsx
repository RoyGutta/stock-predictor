import { Button } from "./components/ui";
import { SessionBadge } from "./features/market/MarketPanels";
import { NavLink, RouteProvider } from "./app/router";
import { useRoute, type Page } from "./app/routes";
import { AnalyzePage } from "./pages/AnalyzePage";
import { ComparePage } from "./pages/ComparePage";
import { DashboardPage } from "./pages/DashboardPage";
import { ExplorePage } from "./pages/ExplorePage";
import { LearnPage } from "./pages/LearnPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { useCapabilities, useMarketStatus } from "./hooks/useMarketData";
import { useTheme } from "./hooks/useTheme";
import "./App.css";

/**
 * Application shell: brand, primary navigation, the routed page, and the
 * standing educational disclaimer. All product logic lives in the pages.
 */

const NAV_ITEMS: { page: Page; label: string }[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "analyze", label: "Analyze" },
  { page: "explore", label: "Explore" },
  { page: "compare", label: "Compare" },
  { page: "portfolio", label: "Portfolio" },
  { page: "learn", label: "Learn" },
];

function CurrentPage() {
  const route = useRoute();
  switch (route.page) {
    case "analyze":
      return <AnalyzePage />;
    case "compare":
      return <ComparePage />;
    case "portfolio":
      return <PortfolioPage />;
    case "learn":
      return <LearnPage />;
    case "explore":
      return <ExplorePage />;
    default:
      return <DashboardPage />;
  }
}

function App() {
  const { theme, toggleTheme } = useTheme();
  const marketStatus = useMarketStatus();
  const capabilities = useCapabilities();
  const demo = capabilities.data?.demo ?? false;

  return (
    <RouteProvider>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <div className="app">
        <header className="app__bar">
          <div className="app__brand">
            <span className="app__mark" aria-hidden="true" />
            <span className="app__name">Stock Predictor</span>
            <span className="app__tag">Educational market analysis</span>
          </div>

          <nav className="app__nav" aria-label="Primary">
            {NAV_ITEMS.map(({ page, label }) => (
              <NavLink
                key={page}
                to={page}
                className="app__nav-link"
                activeClassName="app__nav-link--active"
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="app__bar-right">
            {marketStatus.data && <SessionBadge status={marketStatus.data} />}
            <Button variant="ghost" small onClick={toggleTheme}>
              {theme === "dark" ? "Light" : "Dark"} mode
            </Button>
          </div>
        </header>

        {demo && (
          <div className="app__demo" role="note">
            <strong>Demo prices.</strong> Every price on this site comes from a synthetic
            dataset frozen at 2025-12-31: not live market data and not any real security&rsquo;s
            history. SEC filings and reported financials, where shown, are real and labelled
            as such.
          </div>
        )}

        {/* tabIndex -1 lets route changes move focus here without adding the
            landmark to the tab order. */}
        <main id="main" className="app__main" tabIndex={-1}>
          <CurrentPage />
        </main>

        <footer className="app__footer">
          <p>
            Educational tool. Not investment advice.{" "}
            {demo
              ? "Prices, and every statistic computed from them, come from a synthetic demonstration dataset rather than market data; SEC filings and reported financials are companies' actual reports."
              : "Market data may be delayed or incomplete; SEC filings and reported financials are companies' own reports."}{" "}
            Every figure shown describes the past — none of it predicts what happens next.
            Investing involves risk, including loss of principal.
          </p>
        </footer>
      </div>
    </RouteProvider>
  );
}

export default App;
