/**
 * Plain-English explanations of every term the interface uses.
 *
 * Written for someone who has never invested. Rules followed throughout:
 *   - Define a word without using three more words that also need defining.
 *   - Give a concrete number wherever one helps.
 *   - Say what the thing does NOT tell you. That sentence is usually the most
 *     useful one, and it is the one most glossaries leave out.
 */

export interface GlossaryEntry {
  term: string;
  short: string;
  /** The longer explanation, shown in the learn panel. */
  full: string;
  /** What this measure cannot tell you. Required — every entry has limits. */
  limits: string;
}

export const GLOSSARY = {
  investing: {
    term: "Investing",
    short: "Buying part of a business, hoping it becomes more valuable over time.",
    full:
      "When you buy a share of a company, you own a small slice of that business. If the " +
      "business does well, your slice can become worth more. If it does badly, your slice " +
      "can become worth less — including much less than you paid.",
    limits:
      "There is no version of investing without the possibility of losing money. Anyone " +
      "who tells you otherwise is selling something.",
  },

  etf: {
    term: "ETF",
    short: "One purchase that buys you a small piece of hundreds of companies at once.",
    full:
      "An Exchange-Traded Fund is a basket of investments you can buy as a single share. " +
      "Buying one share of an S&P 500 ETF makes you a part-owner of 500 large US companies. " +
      "That is why ETFs are usually where beginners are pointed: one purchase, hundreds of " +
      "companies, so no single company failing can wipe you out.",
    limits:
      "An ETF still falls when the whole market falls. Spreading across 500 companies " +
      "protects you from one company collapsing, not from a bad year for everything.",
  },

  diversification: {
    term: "Diversification",
    short: "Not putting all your money in one place.",
    full:
      "If everything you own is one company and that company fails, you lose everything. If " +
      "you own 500 companies and one fails, you barely notice. Diversification is the one " +
      "thing in investing that reduces risk without also reducing your expected return, " +
      "which is why it gets called the only free lunch in finance.",
    limits:
      "In a serious crash, most things fall together — the protection that works in normal " +
      "times weakens exactly when you would most want it.",
  },

  marketCap: {
    term: "Market cap",
    short: "What the market thinks an entire company is worth.",
    full:
      "Share price multiplied by the number of shares. A company with 1 million shares at " +
      "$50 each has a market cap of $50 million. It is the honest way to compare company " +
      "sizes — share price alone tells you nothing, because a company can choose to have " +
      "many cheap shares or few expensive ones.",
    limits:
      "Market cap is what people are currently willing to pay, not what a company is " +
      "actually worth. Those can differ enormously, and for long stretches.",
  },

  volatility: {
    term: "Volatility",
    short: "How much the price jumps around.",
    full:
      "A stock that moves 1% on a typical day is calm. One that moves 8% is volatile. " +
      "Volatility measures the size of the swings, in both directions — it is not a " +
      "measure of whether something is going up or down.",
    limits:
      "High volatility does not mean a bad investment, and low volatility does not mean a " +
      "safe one. It only describes how bumpy the ride has been so far.",
  },

  risk: {
    term: "Risk",
    short: "The chance you end up with less money than you started with.",
    full:
      "In everyday use, risk means the possibility of losing money — especially of needing " +
      "your money at the exact moment it is worth least. Finance often measures risk as " +
      "volatility because it is easy to calculate, but the two are not the same thing.",
    limits:
      "Every risk number here is calculated from what already happened. The most damaging " +
      "events tend to be the ones with no precedent in the data.",
  },

  compounding: {
    term: "Compound growth",
    short: "Growth that earns growth of its own.",
    full:
      "Earn 7% on $1,000 and you have $1,070. Earn 7% again and you gain $74.90, not $70 — " +
      "because the previous gain is now earning too. Over 30 years at 7%, $1,000 becomes " +
      "about $7,600 without adding a penny. Nearly all of that comes from gains earning " +
      "gains, which is why starting earlier matters more than starting bigger.",
    limits:
      "It works identically in reverse. A 50% loss needs a 100% gain just to get back to " +
      "even, which is why avoiding large losses matters more than chasing large wins.",
  },

  rsi: {
    term: "RSI",
    short: "Whether recent gains have been bigger than recent losses, from 0 to 100.",
    full:
      "The Relative Strength Index compares the size of up-moves to down-moves over the " +
      "last 14 bars. Above 70 is conventionally called overbought; below 30, oversold.",
    limits:
      "'Overbought' does not mean 'about to fall'. In a strong rally RSI can sit above 70 " +
      "for months while the price keeps climbing. Traders lose money on this constantly.",
  },

  macd: {
    term: "MACD",
    short: "Whether the recent average price is pulling away from the longer-term average.",
    full:
      "MACD tracks the gap between a fast and a slow moving average. A widening gap means " +
      "recent prices are separating from the longer-run trend.",
    limits:
      "It is built from averages of past prices, so it always lags. By the time it moves, " +
      "the move it describes has already happened.",
  },

  movingAverage: {
    term: "Moving average",
    short: "The average price over a recent window, redrawn each day.",
    full:
      "A 50-day moving average is the average closing price of the last 50 days. It " +
      "smooths out daily noise so the underlying direction is easier to see.",
    limits:
      "Smoothing is the same thing as delay. A moving average always tells you about the " +
      "past, and the longer the window, the further behind it is.",
  },

  bollinger: {
    term: "Bollinger Bands",
    short: "A band showing the price's normal range of movement.",
    full:
      "Two lines drawn above and below a moving average, spaced by how volatile the stock " +
      "has been. Roughly 95% of recent closes fall inside them, so a close outside the " +
      "band is statistically unusual. The bands widen when things get choppy.",
    limits:
      "Unusual is not wrong. Prices ride the upper band for the whole of a strong rally.",
  },

  sharpe: {
    term: "Sharpe ratio",
    short: "How much return was earned for the amount of bumpiness endured.",
    full:
      "Return divided by volatility. It lets you compare a calm investment that returned " +
      "8% against a wild one that returned 12%. Higher is better; above 1 is generally " +
      "considered good.",
    limits:
      "It counts big gains as 'risk' exactly like big losses, and it is measured over one " +
      "specific past window. A different window can give a very different number.",
  },

  sortino: {
    term: "Sortino ratio",
    short: "Like Sharpe, but only counts the downside as risk.",
    full:
      "The Sharpe ratio penalises large gains as much as large losses, which most people " +
      "find odd — nobody complains about upside. Sortino fixes that by measuring only the " +
      "moves below zero.",
    limits:
      "Still entirely historical, and less standard than Sharpe, so it is harder to " +
      "compare against figures you see quoted elsewhere.",
  },

  drawdown: {
    term: "Maximum drawdown",
    short: "The worst peak-to-bottom fall in this period.",
    full:
      "If a stock climbed to $100 then fell to $60 before recovering, the maximum drawdown " +
      "was 40%. This is often the most useful risk number there is, because it describes " +
      "what you would actually have lived through — and it is what makes people sell at " +
      "the bottom.",
    limits:
      "It is the worst fall in this window only. A longer window almost always contains a " +
      "worse one.",
  },

  valueAtRisk: {
    term: "Value at Risk (95%)",
    short: "On the worst 1 day in 20, losses were at least this large.",
    full:
      "Sort every day in the period from worst to best and look at the 5% cut-off. That is " +
      "the Value at Risk: on the bad days, this is roughly the scale of the fall.",
    limits:
      "It tells you where the bad days start, not how bad they can get. The days that " +
      "cause real damage are the ones beyond this line.",
  },

  conditionalValueAtRisk: {
    term: "Expected shortfall",
    short: "On the days worse than the Value at Risk line, this was the average loss.",
    full:
      "Value at Risk tells you where the bad days start. Expected shortfall tells you how " +
      "bad they actually got, by averaging every day beyond that line. If VaR is −3% and " +
      "expected shortfall is −5%, then on a bad day you lost about 3%, but on the genuinely " +
      "bad days you lost about 5% on average.",
    limits:
      "It still only knows the losses that appear in this window. A crash worse than " +
      "anything in the sample is invisible to it, and those are the ones that do real damage.",
  },

  beta: {
    term: "Beta",
    short: "How much this moved compared to the market as a whole.",
    full:
      "A beta of 1 means it historically moved roughly in step with the market. 1.5 means " +
      "it tended to swing about 50% harder in both directions — better on the way up, worse " +
      "on the way down. Below 1 means it was calmer than the market.",
    limits:
      "Beta only means something if the market actually explains this stock's movement — " +
      "check the R² beside it. A high beta computed from an unrelated relationship is a " +
      "real-looking number with nothing behind it. It is also entirely backward-looking.",
  },

  correlation: {
    term: "Correlation",
    short: "Whether two investments tend to move up and down together.",
    full:
      "Near 1 means two things rose and fell almost as one. Near 0 means they moved " +
      "independently. Negative means one tended to rise when the other fell. It is the " +
      "number underneath diversification: owning ten things that all move together is much " +
      "closer to owning one thing than it looks.",
    limits:
      "Correlations are not fixed. They tend to rise toward 1 during a crash — meaning the " +
      "protection you were counting on weakens at exactly the moment you need it.",
  },

  monteCarlo: {
    term: "Simulation range",
    short: "How far apart outcomes could be, if the future looked like the past.",
    full:
      "This takes the stock's own past daily moves, shuffles them thousands of times, and " +
      "looks at where all those paths ended up. The width of the result is the useful part: " +
      "a wide range means high uncertainty, a narrow one means less.",
    limits:
      "It is not a forecast and cannot tell you direction. It assumes the future is drawn " +
      "from the same distribution as the past, which is false during any regime change, and " +
      "it can never produce a shock bigger than one already in the sample.",
  },

  volume: {
    term: "Volume",
    short: "How many shares changed hands.",
    full:
      "The number of shares traded in the period. High volume means a lot of people were " +
      "buying and selling, so a price move on high volume reflects more agreement than the " +
      "same move on thin trading.",
    limits: "Volume says how much trading happened, never whether the price will move.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** Terms shown in the learn panel, in teaching order rather than alphabetically. */
export const LEARNING_PATH: GlossaryKey[] = [
  "investing",
  "risk",
  "diversification",
  "etf",
  "compounding",
  "marketCap",
  "volatility",
];
