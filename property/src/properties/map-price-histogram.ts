/** Bars in the filter's price histogram. */
export const PRICE_HISTOGRAM_BARS = 60;

/** The most prices read for one histogram: enough for its shape. */
export const PRICE_HISTOGRAM_SAMPLE = 5000;

/**
 * How many of `prices` fall in each of `PRICE_HISTOGRAM_BARS` equal steps
 * from 0 to `upTo`; the last bar also holds everything above `upTo`, as the
 * slider's top means "and more".
 */
export function priceHistogram(prices: number[], upTo: number): number[] {
  const counts = new Array<number>(PRICE_HISTOGRAM_BARS).fill(0);
  const step = upTo / PRICE_HISTOGRAM_BARS;
  for (const price of prices) {
    if (!(price >= 0)) continue;
    const bar = Math.min(Math.floor(price / step), PRICE_HISTOGRAM_BARS - 1);
    counts[bar]++;
  }
  return counts;
}
