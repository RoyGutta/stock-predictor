import { Button } from "./components/ui";
import { SessionBadge } from "./features/market/MarketPanels";
import { NavLink, RouteProvider } from "./app/router";
import { useRoute, type Page } from "./app/routes";
import { AnalyzePage } from "./pages/AnalyzePage";
import { ComparePage } from "./pages/ComparePage";
import { DashboardPage } from "./pages/DashboardPage";
import { LearnPage } from "./pages/LearnPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { useMarketStatus } from "./hooks/useMarketData";
import { useTheme } from "./hooks/useTheme";
import "./App.css";

/**
 * Application shell: brand, primary navigation, the routed page, and the
 * standing educational disclaimer. All product logic lives in the pages.
 */

const NAV_ITEMS: { page: Page; label: string }[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "analyze", label: "Analyze" },
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
      // Explore ships with the preference-matching engine; until then the
      // router already treats it as a known page so links can be added first.
      return <DashboardPage />;
    default:
      return <DashboardPage />;
  }
}

function App() {
  const { theme, toggleTheme } = useTheme();
  const marketStatus = useMarketStatus();

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

        {/* tabIndex -1 lets route changes move focus here without adding the
            landmark to the tab order. */}
        <main id="main" className="app__main" tabIndex={-1}>
          <CurrentPage />
        </main>

        <footer className="app__footer">
          <p>
            Educational tool. Not investment advice. Market data may be delayed or incomplete,
            and every figure shown describes the past — none of it predicts what happens next.
            Investing involves risk, including loss of principal.
          </p>
        </footer>
      </div>
    </RouteProvider>
  );
}

export default App;
