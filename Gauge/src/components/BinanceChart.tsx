import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi } from 'lightweight-charts';
import { calculateFomoIndex } from '../utils/fomoFinder';
import { CSV_FUNDING_RATES } from '../data/fundingRates';
import { binanceWebSocket } from '../utils/binanceWebSocket';

// Map FOMO index (-3 to +3) to candle color
function fomoIndexToColor(fomo: number): string {
  switch (fomo) {
    case -3:
      return '#ec4899'; // pink (extreme panic)
    case -2:
      return '#c084fc'; // purple (strong short bias)
    case -1:
      return '#facc15'; // yellow (mild fear)
    case 1:
      return '#facc15'; // yellow (mild greed)
    case 2:
      return '#fb923c'; // orange (greed)
    case 3:
      return '#ef4444'; // red (extreme FOMO)
    default:
      return '#64748b'; // neutral gray fallback
  }
}

export const BinanceChart: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const scrollCheckIntervalRef = useRef<number | null>(null);
  const candlesRef = useRef<any[]>([]);
  const isLoadingRef = useRef(false); // Prevent multiple simultaneous loads
  const oldestCandleTimeRef = useRef<number | null>(null); // Track oldest candle timestamp
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const liveCandleRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (chartRef.current) return; // avoid duplicate init

    let chart: IChartApi | null = null;
    let isMounted = true;

    const initChart = async () => {
      try {
        const limit = 1000;
        const numBatches = 6; // Fetch 6 batches = 6000 candles total

        // LAZY LOAD: Fetch first batch for immediate display
        console.log('Fetching initial batch of 1000 candles...');
        
        // Get first batch of each (most recent) - quick initial load
        const [futuresFirstRes, spotFirstRes, fundingRes] = await Promise.all([
          fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=8h&limit=${limit}`),
          fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=8h&limit=${limit}`),
          fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=2000`)
        ]);

        const futuresFirst = await futuresFirstRes.json();
        const spotFirst = await spotFirstRes.json();
        const fundingResponse = await fundingRes.json();

        const futuresAll = [...(Array.isArray(futuresFirst) ? futuresFirst : [])];
        const spotAll = [...(Array.isArray(spotFirst) ? spotFirst : [])];
        const fundingAll = [...(Array.isArray(fundingResponse) ? fundingResponse : [])];

        console.log(`Initial load: futures: ${futuresAll.length}, spot: ${spotAll.length}, funding: ${fundingAll.length}`);
        
        // Fetch more historical data in background (without blocking initial render)
        let futuresEndTime = futuresFirst[0]?.[0] - 1;
        let spotEndTime = spotFirst[0]?.[0] - 1;
        const numAdditionalBatches = 5; // Load 5 more batches = 5000 more candles
        
        if (futuresEndTime && spotEndTime) {
          const backgroundFetches: Promise<any>[] = [];
          
          for (let i = 0; i < numAdditionalBatches; i++) {
            if (!futuresEndTime) break;
            backgroundFetches.push(
              fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=8h&limit=${limit}&endTime=${futuresEndTime}`)
                .then(r => r.json())
                .then(data => {
                  if (Array.isArray(data) && data.length > 0) {
                    futuresEndTime = data[0][0] - 1;
                    return { type: 'futures', data };
                  }
                  return { type: 'futures', data: [] };
                })
            );
          }
          
          for (let i = 0; i < numAdditionalBatches; i++) {
            if (!spotEndTime) break;
            backgroundFetches.push(
              fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=8h&limit=${limit}&endTime=${spotEndTime}`)
                .then(r => r.json())
                .then(data => {
                  if (Array.isArray(data) && data.length > 0) {
                    spotEndTime = data[0][0] - 1;
                    return { type: 'spot', data };
                  }
                  return { type: 'spot', data: [] };
                })
            );
          }
          
          // Execute background fetches without awaiting - they'll update allCandlesRef when done
          Promise.all(backgroundFetches).then(results => {
            if (!isMounted) return;
            
            for (const result of results) {
              if (result.type === 'futures') futuresAll.push(...result.data);
              else if (result.type === 'spot') spotAll.push(...result.data);
            }
            
            // Update oldest candle timestamp after background fetch completes
            const futuresMap = new Map<number, any>();
            for (const k of futuresAll) futuresMap.set(k[0] as number, k);
            const allFuturesKlines = Array.from(futuresMap.values()).sort((a, b) => a[0] - b[0]);
            if (allFuturesKlines.length > 0) {
              oldestCandleTimeRef.current = allFuturesKlines[0][0] as number;
              console.log(`Background fetch complete: total futures: ${futuresAll.length}, spot: ${spotAll.length}. Oldest candle: ${new Date(oldestCandleTimeRef.current).toISOString()}`);
            }
          }).catch(e => console.error('Background fetch error:', e));
        }
        
        // Deduplicate and sort
        const futuresMap = new Map<number, any>();
        for (const k of futuresAll) futuresMap.set(k[0] as number, k);
        const futuresKlines = Array.from(futuresMap.values()).sort((a, b) => a[0] - b[0]);

        // Store oldest candle timestamp for lazy loading
        if (futuresKlines.length > 0) {
          oldestCandleTimeRef.current = futuresKlines[0][0] as number;
        }

        const spotMap = new Map<number, any>();
        for (const k of spotAll) spotMap.set(k[0] as number, k);
        const spotKlines = Array.from(spotMap.values()).sort((a, b) => a[0] - b[0]);

        const fundingMap = new Map<number, any>();
        for (const f of fundingAll) fundingMap.set(f.fundingTime as number, f);
        const fundingHistory = Array.from(fundingMap.values()).sort(
          (a, b) => a.fundingTime - b.fundingTime
        );

        console.log(`After dedup: futures: ${futuresKlines.length}, spot: ${spotKlines.length}, funding: ${fundingHistory.length}`);

        // Build map: spot openTime -> spot open & close price
        const spotByOpenTime = new Map<number, { open: number; close: number }>();
        for (const k of spotKlines) {
          const openTime = k[0] as number;
          const openSpot = parseFloat(k[1]);
          const closeSpot = parseFloat(k[4]);
          spotByOpenTime.set(openTime, { open: openSpot, close: closeSpot });
        }

        // Prepare funding array (time, rate)
        const fundingArray = fundingHistory.map((f: any) => ({
          time: f.fundingTime as number,
          rate: parseFloat(f.fundingRate as string),
        }));

        // Get the most recent/current funding rate for the live candle
        const currentFundingRate = fundingArray.length > 0 
          ? fundingArray[fundingArray.length - 1].rate 
          : 0;

        // Merge API funding data with CSV funding data - build sorted array ONCE
        const allFundingRates = new Map<number, number>();
        
        // Add CSV funding rates first (they're historical and comprehensive)
        for (const [timestamp, rate] of Object.entries(CSV_FUNDING_RATES)) {
          allFundingRates.set(parseInt(timestamp), rate as any);
        }
        
        // Override with API data if available (more recent)
        for (const fund of fundingArray) {
          allFundingRates.set(fund.time, fund.rate);
        }
        
        // Create sorted array of [time, rate] for binary search
        const sortedFunding = Array.from(allFundingRates.entries())
          .sort((a, b) => a[0] - b[0]);
        
        console.log(`Funding data range: ${sortedFunding.length > 0 ? new Date(sortedFunding[0][0]).toISOString() : 'none'} to ${sortedFunding.length > 0 ? new Date(sortedFunding[sortedFunding.length - 1][0]).toISOString() : 'none'}`);
        console.log(`Klines data range: ${new Date(futuresKlines[0][0]).toISOString()} to ${new Date(futuresKlines[futuresKlines.length - 1][0]).toISOString()}`);
        console.log(`Current funding rate: ${currentFundingRate}`);

        // Binary search helper to find closest funding rate
        const findClosestFunding = (targetTime: number): number => {
          let left = 0;
          let right = sortedFunding.length - 1;
          
          // Edge cases
          if (sortedFunding.length === 0) return 0;
          if (targetTime < sortedFunding[0][0]) return sortedFunding[0][1];
          if (targetTime > sortedFunding[right][0]) return sortedFunding[right][1];
          
          // Binary search
          while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (sortedFunding[mid][0] < targetTime) {
              left = mid + 1;
            } else {
              right = mid;
            }
          }
          
          // Check closest neighbors
          const afterTime = sortedFunding[left][0];
          const beforeTime = left > 0 ? sortedFunding[left - 1][0] : afterTime;
          
          const diffAfter = Math.abs(afterTime - targetTime);
          const diffBefore = Math.abs(beforeTime - targetTime);
          
          return diffBefore <= diffAfter ? sortedFunding[left - 1][1] : sortedFunding[left][1];
        };

        // Build candle data with FOMO-based colors - only first 1000 initially
        const buildCandleData = (klines: any[], isMostRecent: boolean = false) => {
          const candleData: any[] = [];
          for (let i = 0; i < klines.length; i++) {
            const fk = klines[i];
            const isLastCandle = isMostRecent && i === klines.length - 1;
            const openTime = fk[0] as number;
            const open = parseFloat(fk[1]);
            const high = parseFloat(fk[2]);
            const low = parseFloat(fk[3]);
            const close = parseFloat(fk[4]);
            const closeTime = fk[6] as number; // futures close time

            // For the most recent candle, use the current funding rate from API
            // Otherwise, find closest funding rate using binary search
            const funding8h = isLastCandle 
              ? currentFundingRate 
              : findClosestFunding(closeTime);

            // Calculate FOMO index
            const fomoIndex = calculateFomoIndex(0, funding8h); // premium not used in calculation
            const color = fomoIndexToColor(fomoIndex);

            candleData.push({
              time: Math.floor(openTime / 1000) as any,
              open,
              high,
              low,
              close,
              color,
              wickColor: color,
              borderColor: color,
              fomoIndex,
            });
          }
          return candleData;
        };

        // Build initial candle data (the newest 1000)
        const startIdx = Math.max(0, futuresKlines.length - 1000);
        const candlesToBuild = futuresKlines.slice(startIdx);
        const candleData = buildCandleData(candlesToBuild, true); // true indicates these are the most recent candles
        
        console.log(`Initial render: ${candleData.length} candles`);

        // Save for CSV export
        candlesRef.current = candleData;

        if (!isMounted || !containerRef.current) return;

        // Wait a frame to ensure container has layout
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (!isMounted || !containerRef.current) return;

        const container = containerRef.current;
        container.innerHTML = '';

        const rect = container.getBoundingClientRect();
        const width = rect.width || container.offsetWidth || container.clientWidth || 1800;
        const height = 500;

        chart = createChart(container, {
          layout: {
            background: { type: ColorType.Solid, color: 'transparent' },
            textColor: '#d1d5db',
          },
          width,
          height,
          grid: {
            vertLines: { visible: false },
            horzLines: { visible: false },
          },
          timeScale: {
            timeVisible: true,
            secondsVisible: false,
            borderColor: 'transparent',
          },
          rightPriceScale: {
            borderColor: 'transparent',
          },
        });

        const candlestickSeries = chart.addCandlestickSeries();
        candlestickSeries.setData(candleData);
        candlestickSeriesRef.current = candlestickSeries;
        
        // Store latest candle for live updates
        if (candleData.length > 0) {
          liveCandleRef.current = { ...candleData[candleData.length - 1] };
        }
        
        // Fit content first, then adjust for 40px margin on right
        chart.timeScale().fitContent();
        
        // Adjust visible range to add margin after chart renders
        setTimeout(() => {
          if (!chart || !isMounted || candleData.length === 0) return;
          
          const visibleRange = chart.timeScale().getVisibleRange();
          if (!visibleRange) return;
          
          const latestTime = candleData[candleData.length - 1].time;
          const timeRange = (visibleRange.to as number) - (visibleRange.from as number);
          const chartAreaWidth = width - 60;
          const timePerPixel = timeRange / chartAreaWidth;
          const marginTime = 40 * timePerPixel;
          
          // Extend range to create right margin
          chart.timeScale().setVisibleRange({
            from: visibleRange.from,
            to: (latestTime + marginTime) as any
          });
        }, 100);

        chartRef.current = chart;
        candlesRef.current = candleData;

        // Create tooltip element
        const tooltip = document.createElement('div');
        tooltip.className = 'chart-tooltip';
        tooltip.style.display = 'none';
        container.appendChild(tooltip);
        tooltipRef.current = tooltip;

        // Handle crosshair move to show tooltip
        chart.subscribeCrosshairMove((param) => {
          if (!param.point || !param.time || !tooltip) {
            tooltip.style.display = 'none';
            return;
          }

          const candleData = candlesRef.current;
          const candle = candleData.find((c: any) => c.time === param.time);
          
          if (!candle || candle.fomoIndex === undefined) {
            tooltip.style.display = 'none';
            return;
          }

          const rect = container.getBoundingClientRect();
          const x = param.point.x;
          const y = param.point.y;
          const tooltipWidth = 200;
          const tooltipHeight = 140;
          const offset = 15;

          // Calculate position, keeping tooltip within viewport
          let left = x + rect.left + offset;
          let top = y + rect.top - tooltipHeight - offset;

          // Adjust if tooltip would go off right edge
          if (left + tooltipWidth > window.innerWidth) {
            left = x + rect.left - tooltipWidth - offset;
          }

          // Adjust if tooltip would go off top edge
          if (top < 0) {
            top = y + rect.top + offset;
          }

          // Adjust if tooltip would go off left edge
          if (left < 0) {
            left = offset;
          }

          tooltip.style.display = 'block';
          tooltip.style.left = `${left}px`;
          tooltip.style.top = `${top}px`;

          const formatPrice = (price: number) => price.toLocaleString('en-US', { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
          });

          // Map FOMO index to label
          const fomoLabels: { [key: number]: string } = {
            [-3]: 'CAPITULATION',
            [-2]: 'PANIC',
            [-1]: 'UNCERTAIN',
            [0]: 'BALANCE',
            [1]: 'CANARY',
            [2]: 'GREED',
            [3]: 'FOMO'
          };
          
          const fomoLabel = fomoLabels[candle.fomoIndex] || '';
          const indexDisplay = fomoLabel ? `${candle.fomoIndex} ${fomoLabel}` : String(candle.fomoIndex);

          tooltip.innerHTML = `
            <div class="tooltip-content">
              <div class="tooltip-row"><span class="tooltip-label">Open:</span> <span class="tooltip-value">$${formatPrice(candle.open)}</span></div>
              <div class="tooltip-row"><span class="tooltip-label">High:</span> <span class="tooltip-value">$${formatPrice(candle.high)}</span></div>
              <div class="tooltip-row"><span class="tooltip-label">Low:</span> <span class="tooltip-value">$${formatPrice(candle.low)}</span></div>
              <div class="tooltip-row"><span class="tooltip-label">Close:</span> <span class="tooltip-value">$${formatPrice(candle.close)}</span></div>
              <div class="tooltip-row"><span class="tooltip-label">Index Value:</span> <span class="tooltip-value">${indexDisplay}</span></div>
            </div>
          `;
        });

        // Add scroll listener for lazy loading more candles
        const handleVisibleRangeChange = async () => {
          if (!isMounted || !chart || !candlestickSeriesRef.current) return;
          
          const visibleRange = chart.timeScale().getVisibleRange();
          if (!visibleRange || !oldestCandleTimeRef.current) return;
          
          // visibleRange.from is a timestamp (seconds), convert to milliseconds for comparison
          const visibleFromMs = (visibleRange.from as number) * 1000;
          const oldestTimeMs = oldestCandleTimeRef.current;
          
          // When user scrolls to the LEFT (oldest candles), check if we're near the oldest candle
          // Allow a small buffer (8 hours = 1 candle) to trigger loading
          const bufferMs = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
          const isNearOldest = visibleFromMs <= oldestTimeMs + bufferMs;
          
          if (isNearOldest && !isLoadingRef.current) {
            isLoadingRef.current = true;
            
            try {
              const endTime = oldestTimeMs - 1; // Fetch candles before the oldest one
              console.log(`Fetching 1,000 more candles before ${new Date(oldestTimeMs).toISOString()}...`);
              
              const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=8h&limit=1000&endTime=${endTime}`);
              const newKlines = await response.json();
              
              if (Array.isArray(newKlines) && newKlines.length > 0) {
                // Build candle data for new candles
                const newCandlesFormatted = buildCandleData(newKlines);
                
                // Get current candles (excluding live candle if it exists)
                const currentCandles = [...candlesRef.current];
                
                // Prepend older candles to the beginning
                const allCandlesNow = [...newCandlesFormatted, ...currentCandles];
                
                // Update the series with all candles
                if (candlestickSeriesRef.current) {
                  candlestickSeriesRef.current.setData(allCandlesNow);
                  candlesRef.current = allCandlesNow;
                  
                  // Update oldest candle timestamp
                  oldestCandleTimeRef.current = newKlines[0][0] as number;
                  
                  console.log(`Loaded ${newKlines.length} more candles. Total: ${allCandlesNow.length}. Oldest now: ${new Date(oldestCandleTimeRef.current).toISOString()}`);
                }
              } else {
                console.log('No more historical candles available from API');
                oldestCandleTimeRef.current = null; // Prevent further fetches
              }
            } catch (error) {
              console.error('Error fetching more historical candles:', error);
            }
            
            isLoadingRef.current = false;
          }
        };

        // Store handler for cleanup
        (chart as any).__handleVisibleRangeChange = handleVisibleRangeChange;
        
        // Subscribe to visible range changes for better performance
        chart.timeScale().subscribeVisibleTimeRangeChange(handleVisibleRangeChange);
        
        // Also keep interval as fallback (less frequent)
        scrollCheckIntervalRef.current = setInterval(handleVisibleRangeChange, 1000);

        const resizeObserver = new ResizeObserver((entries) => {
          if (!chart || entries.length === 0) return;
          const { width: newWidth } = entries[0].contentRect;
          if (newWidth > 0) {
            chart.applyOptions({ width: newWidth });
          }
        });

        resizeObserver.observe(container);
        resizeObserverRef.current = resizeObserver;

        // Connect to WebSocket for live updates
        binanceWebSocket.connect();
        
        // Subscribe to live price updates
        const unsubscribe = binanceWebSocket.subscribe((liveData) => {
          if (!isMounted || !candlestickSeriesRef.current || !liveCandleRef.current) return;
          
          const latestCandle = liveCandleRef.current;
          const currentTime = Math.floor(Date.now() / 1000);
          const candleTime = latestCandle.time;
          
          // Calculate premium from live prices
          const premium = ((liveData.futures - liveData.spot) / liveData.spot) * 100;
          
          // Calculate FOMO index from live funding rate
          const fomoIndex = calculateFomoIndex(premium, liveData.funding8h);
          const color = fomoIndexToColor(fomoIndex);
          
          // Check if we're still in the same 8-hour candle period
          const eightHoursInSeconds = 8 * 60 * 60;
          const isSameCandle = (currentTime - candleTime) < eightHoursInSeconds;
          
          if (isSameCandle) {
            // Update existing candle with live data
            const updatedCandle = {
              time: candleTime,
              open: latestCandle.open,
              high: Math.max(latestCandle.high, liveData.futures),
              low: Math.min(latestCandle.low, liveData.futures),
              close: liveData.futures,
              color,
              wickColor: color,
              borderColor: color,
              fomoIndex,
            };
            
            liveCandleRef.current = updatedCandle;
            
            // Update the last candle in the series
            const allCandles = [...candlesRef.current];
            if (allCandles.length > 0) {
              allCandles[allCandles.length - 1] = updatedCandle;
              candlesRef.current = allCandles;
              candlestickSeriesRef.current.update(updatedCandle);
            }
          } else {
            // New candle period - create new candle
            const newCandle = {
              time: currentTime as any,
              open: liveData.futures,
              high: liveData.futures,
              low: liveData.futures,
              close: liveData.futures,
              color,
              wickColor: color,
              borderColor: color,
              fomoIndex,
            };
            
            liveCandleRef.current = newCandle;
            candlesRef.current = [...candlesRef.current, newCandle];
            candlestickSeriesRef.current.update(newCandle);
          }
        });
        
        // Store unsubscribe function for cleanup
        (chartRef.current as any).__unsubscribe = unsubscribe;
      } catch (error) {
        console.error('Error initializing chart:', error);
      }
    };

    initChart();

    return () => {
      isMounted = false;
      if (chartRef.current && (chartRef.current as any).__handleVisibleRangeChange) {
        // Unsubscribe from visible range changes
        chartRef.current.timeScale().unsubscribeVisibleTimeRangeChange((chartRef.current as any).__handleVisibleRangeChange);
      }
      if (scrollCheckIntervalRef.current) {
        clearInterval(scrollCheckIntervalRef.current);
        scrollCheckIntervalRef.current = null;
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (tooltipRef.current && containerRef.current) {
        containerRef.current.removeChild(tooltipRef.current);
        tooltipRef.current = null;
      }
      // Unsubscribe from WebSocket
      if (chartRef.current && (chartRef.current as any).__unsubscribe) {
        (chartRef.current as any).__unsubscribe();
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      if (chart) {
        chart.remove();
        chart = null;
      }
      candlestickSeriesRef.current = null;
      liveCandleRef.current = null;
    };
  }, []);

  const handleDownloadCsv = () => {
    const rows = candlesRef.current;
    if (!rows || rows.length === 0) return;

    const header = [
      'timestamp_iso',
      'open_time_ms',
      'close_time_ms',
      'futures_open',
      'futures_high',
      'futures_low',
      'futures_close',
      'spot_open',
      'spot_close',
      'premium_pct',
      'funding_8h',
      'fomo_index',
    ];

    const lines = rows.map((c) => {
      const ts = new Date(c.openTimeMs).toISOString();
      return [
        ts,
        c.openTimeMs,
        c.closeTimeMs,
        c.open,
        c.high,
        c.low,
        c.close,
        c.spotOpen,
        c.spotClose,
        c.premium,
        c.funding8h,
        c.fomoIndex,
      ]
        .map((v) => (v ?? ''))
        .join(',');
    });

    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'fomo_finder_btcusdt_8h.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-[2000px] px-4 pb-8">
      <div
        ref={containerRef}
        className="w-full border border-gray-700 rounded-lg"
        style={{ height: '500px', minWidth: '1200px', background: 'transparent' }}
      />
    </div>
  );
};

