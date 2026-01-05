// FOMO Finder Indicator Logic

export interface FomoData {
  timestamp: string;
  spot: number;
  futures: number;
  premium: number;
  funding8h: number;
  fundingDaily: number;
  fomoIndex: number;
}

// Fetch spot price from Binance
async function fetchSpotPrice(): Promise<number> {
  const response = await fetch(
    'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'
  );
  const data = await response.json();
  return parseFloat(data.price);
}

// Fetch futures mark price from Binance
async function fetchFuturesPrice(): Promise<number> {
  const response = await fetch(
    'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'
  );
  const data = await response.json();
  return parseFloat(data.markPrice);
}

// Fetch 8-hour funding rate from Binance
async function fetchFunding8h(): Promise<number> {
  // Try premiumIndex first for current funding rate
  try {
    const response = await fetch(
      'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'
    );
    const data = await response.json();
    if (data && data.lastFundingRate !== undefined) {
      // Binance returns as decimal fraction (-0.0000079 = -0.00079%)
      // Convert to CSV format (-0.00079) by multiplying by 100
      return parseFloat(data.lastFundingRate) * 100;
    }
  } catch (error) {
    console.error('Error fetching premiumIndex:', error);
  }
  
  // Fallback to fundingRate endpoint
  const response = await fetch(
    'https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1'
  );
  const data = await response.json();
  // Binance returns as decimal fraction, convert to CSV format (multiply by 100)
  return parseFloat(data[0].fundingRate) * 100;
}

// Calculate FOMO Index based on fundingDaily
// Rules reverse-engineered from actual CSV data
// fundingDaily = funding8h * 3
// Note: funding8h should be in CSV format (percentage decimal like -0.063 = -6.3%)
export function calculateFomoIndex(premium: number, funding8h: number): number {
  const fundingDaily = funding8h * 3;

  // Thresholds derived from CSV analysis
  if (fundingDaily >= 0.18) {
    return 3;  // Extreme long FOMO
  } else if (fundingDaily >= 0.11) {
    return 2;  // Strong greed
  } else if (fundingDaily >= 0.07) {
    return 1;  // Mild bullish
  } else if (fundingDaily >= 0) {
    return -1; // Neutral/mild bearish
  } else if (fundingDaily >= -0.14) {
    return -2; // Strong short bias
  } else {
    return -3; // Extreme panic/short
  }
}

// Main function to update the FOMO indicator
export async function updateFomoIndicator(): Promise<FomoData> {
  try {
    // Fetch all data in parallel
    const [spot, futures, funding8h] = await Promise.all([
      fetchSpotPrice(),
      fetchFuturesPrice(),
      fetchFunding8h(),
    ]);

    // Calculate premium
    const premium = ((futures - spot) / spot) * 100;

    // Convert funding to daily (for display purposes)
    const fundingDaily = funding8h * 3;

    // Calculate FOMO index using 8-hour funding
    const fomoIndex = calculateFomoIndex(premium, funding8h);

    return {
      timestamp: new Date().toISOString(),
      spot,
      futures,
      premium,
      funding8h,
      fundingDaily,
      fomoIndex,
    };
  } catch (error) {
    console.error('Error updating FOMO indicator:', error);
    throw error;
  }
}

// Convert FOMO index (-3 to +3) to speedometer value (0 to 100)
export function fomoIndexToSpeedometerValue(fomoIndex: number): number {
  // Map -3 to +3 range to 0 to 100
  // -3 = 0%, 0 = 50%, +3 = 100%
  return ((fomoIndex + 3) / 6) * 100;
}

