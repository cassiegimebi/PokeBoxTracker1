const axios = require('axios');

/**
 * Parses a Japanese relative date string to "days ago" number.
 * Returns null if the date is too old to classify.
 */
function parseDaysAgo(dateStr) {
  if (!dateStr) return null;
  if (dateStr.includes('分前') || dateStr.includes('時間前')) return 0; // hours/mins ago = today
  const dayMatch = dateStr.match(/^(\d+)日前/);
  if (dayMatch) return parseInt(dayMatch[1]);
  return null; // older than tracked
}

/**
 * Fetches the latest sealed-box price + sales counts from SNKRDUNK's internal API.
 *
 * SNKRDUNK lists boxes in multiple quantity tiers (1BOX, 2BOX, 3BOX, etc.).
 * We pass `size_id` in the API request to target a specific quantity, and also
 * filter the response by size_id as a second safety net — this ensures the price
 * recorded always reflects a single-unit purchase.
 *
 * @param {number|string} productId
 * @param {number} sizeId   - SNKRDUNK size_id for "1 box" (typically 1, verify per product)
 * @returns {{ price: number|null, sales24h: number, sales7d: number, availableSizes: string[] }}
 */
async function scrapeSnkrdunkPrice(productId, sizeId = 1) {
  if (!productId) {
    console.log('[SNKRDUNK] No productId — skipping.');
    return { price: null, sales24h: 0, sales7d: 0, availableSizes: [] };
  }

  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': `https://snkrdunk.com/apparels/${productId}`,
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
  };

  let price = null;
  let sales24h = 0;
  let sales7d = 0;
  let availableSizes = [];
  let detectedSizeId = null;

  try {
    // Fetch recent sales history across all sizes so we can see what's available
    const histRes = await axios.get(
      `https://snkrdunk.com/v1/apparels/${productId}/sales-history`,
      {
        params: {
          page: 1,
          per_page: 50,
        },
        headers: commonHeaders,
        timeout: 15000,
      }
    );

    const history = histRes.data?.history || [];

    // Log all distinct sizes/quantities seen in this response (useful for debugging)
    availableSizes = [...new Set(history.map(item => item.size).filter(Boolean))];
    if (availableSizes.length > 0) {
      console.log(`[SNKRDUNK] ID ${productId}: sizes in response → ${availableSizes.join(', ')}`);
    }

    // Filter specifically for single box sales.
    // Since some products use sizes like "With Shrink" instead of explicitly "1BOX",
    // we assume it is a single box UNLESS it explicitly says 2BOX, 3BOX, Carton, etc.
    const targeted = history.filter(item => {
      if (item.size) {
        // Convert full-width to half-width (e.g. ２ＢＯＸ -> 2BOX)
        const sizeStr = String(item.size).replace(/[０-９Ａ-Ｚａ-ｚ]/g, function(s) {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        }).replace(/\s+/g, '').toUpperCase();
        
        // Check for 2BOX, 3BOX... up to 99BOX, or "カートン" (Carton)
        const isMultiBox = /([2-9]|1[0-9]+)BOX/.test(sizeStr) || sizeStr.includes('カートン');
        return !isMultiBox;
      }
      // Fallback if 'size' string is missing
      return item.size_id === sizeId || item.size_id === String(sizeId);
    });

    // If the filter yields nothing, we do NOT fall back to the full history.
    // Falling back to full history would pollute the data with a multi-box price.
    // Instead, we leave salesPool empty, which will trigger the chart API fallback later.
    const salesPool = targeted;

    if (salesPool.length === 0) {
      console.warn(`[SNKRDUNK] ID ${productId}: no 1-box sales found in recent history. Will fallback to chart API using configured size_id=${sizeId}`);
    }

    // Most recent sale price for this size
    if (salesPool.length > 0) {
      price = salesPool[0].price;
    }

    // Count sales by recency
    for (const sale of salesPool) {
      const daysAgo = parseDaysAgo(sale.date);
      if (daysAgo === null) continue;
      if (daysAgo <= 7) sales7d++;
      if (daysAgo === 0) sales24h++;
    }

    console.log(`[SNKRDUNK] ID ${productId} (size_id=${sizeId}): ¥${price?.toLocaleString() ?? '-'} | 24h: ${sales24h} | 7d: ${sales7d}`);

    if (salesPool.length > 0) {
      detectedSizeId = salesPool[0].size_id;
    }

  } catch (err) {
    console.warn(`[SNKRDUNK] sales-history failed for ID ${productId}: ${err.message}`);
  }

  // Fallback: chart API if no price from sales-history
  if (price === null) {
    const fallbackSizeId = detectedSizeId || sizeId;
    try {
      const chartRes = await axios.get(
        `https://snkrdunk.com/v1/apparels/${productId}/sales-chart/used`,
        {
          params: { range: 'all', salesChartOptionId: fallbackSizeId },
          headers: commonHeaders,
          timeout: 15000,
        }
      );
      const points = chartRes.data?.points || [];
      if (points.length > 0) {
        price = points[points.length - 1][1];
        console.log(`[SNKRDUNK] ID ${productId}: chart fallback price = ¥${price.toLocaleString()}`);
      }
    } catch (err) {
      console.error(`[SNKRDUNK ERROR] ID ${productId}:`, err.message);
    }
  }

  return { price, sales24h, sales7d, availableSizes, detectedSizeId };
}

/**
 * Fetches full price history (all-time) for a sealed box for initial seeding.
 * Uses the same sizeId to target the correct quantity tier in the chart.
 * @returns array of { date: "YYYY-MM-DD", snkrdunk_jpy: number, ... }
 */
async function fetchSnkrdunkHistory(productId, sizeId = 1) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': `https://snkrdunk.com/apparels/${productId}`,
  };
  try {
    const res = await axios.get(
      `https://snkrdunk.com/v1/apparels/${productId}/sales-chart/used`,
      { params: { range: 'all', salesChartOptionId: sizeId }, headers, timeout: 20000 }
    );
    const points = res.data?.points || [];
    return points.map(([ts, price]) => ({
      date: new Date(ts).toISOString().slice(0, 10),
      snkrdunk_jpy: price,
      snkrdunk_sales_24h: null,
      snkrdunk_sales_7d: null,
    }));
  } catch (err) {
    console.warn(`[SNKRDUNK HISTORY] ID ${productId}: ${err.message}`);
    return [];
  }
}

module.exports = { scrapeSnkrdunkPrice, fetchSnkrdunkHistory };
