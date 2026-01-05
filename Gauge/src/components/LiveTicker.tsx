import React, { useEffect, useState } from 'react';
import { binanceWebSocket } from '../utils/binanceWebSocket';
import { calculateFomoIndex } from '../utils/fomoFinder';

interface LiveTickerData {
  spot: number;
  futures: number;
  premium: number;
  funding8h: number;
  fomoIndex: number;
}

export const LiveTicker: React.FC = () => {
  const [tickerData, setTickerData] = useState<LiveTickerData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [updatedFields, setUpdatedFields] = useState<Set<string>>(new Set());

  useEffect(() => {
    binanceWebSocket.connect();
    setIsConnected(true);

    const unsubscribe = binanceWebSocket.subscribe((liveData) => {
      // Calculate premium from live prices
      const premium = ((liveData.futures - liveData.spot) / liveData.spot) * 100;
      
      // Calculate FOMO index from live funding rate
      const fomoIndex = calculateFomoIndex(premium, liveData.funding8h);
      
      // Highlight updated fields
      const updated = new Set<string>(['spot', 'futures', 'premium', 'funding8h', 'fomoIndex']);
      setUpdatedFields(updated);
      
      // Clear highlights after animation
      setTimeout(() => setUpdatedFields(new Set()), 500);
      
      setTickerData({
        spot: liveData.spot,
        futures: liveData.futures,
        premium,
        funding8h: liveData.funding8h,
        fomoIndex,
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const formatPrice = (price: number) => {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(4)}%`;
  };

  const fomoLabels: { [key: number]: string } = {
    [-3]: 'CAPITULATION',
    [-2]: 'PANIC',
    [-1]: 'UNCERTAIN',
    [0]: 'BALANCE',
    [1]: 'CANARY',
    [2]: 'GREED',
    [3]: 'FOMO',
  };

  const fomoColors: { [key: number]: string } = {
    [-3]: '#ec4899',
    [-2]: '#c084fc',
    [-1]: '#facc15',
    [0]: '#facc15',
    [1]: '#facc15',
    [2]: '#fb923c',
    [3]: '#ef4444',
  };

  if (!tickerData) {
    return (
      <div className="live-ticker">
        <div className="ticker-item">
          <span className="ticker-label">Connecting...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="live-ticker">
      <div className="ticker-item">
        <span className="ticker-label">Spot:</span>
        <span className={`ticker-value price ${updatedFields.has('spot') ? 'updated' : ''}`}>
          ${formatPrice(tickerData.spot)}
        </span>
      </div>
      <div className="ticker-item">
        <span className="ticker-label">Futures:</span>
        <span className={`ticker-value price ${updatedFields.has('futures') ? 'updated' : ''}`}>
          ${formatPrice(tickerData.futures)}
        </span>
      </div>
      <div className="ticker-item">
        <span className="ticker-label">Premium:</span>
        <span className={`ticker-value ${tickerData.premium >= 0 ? 'positive' : 'negative'} ${updatedFields.has('premium') ? 'updated' : ''}`}>
          {formatPercent(tickerData.premium)}
        </span>
      </div>
      <div className="ticker-item">
        <span className="ticker-label">Funding (8h):</span>
        <span className={`ticker-value ${tickerData.funding8h >= 0 ? 'positive' : 'negative'} ${updatedFields.has('funding8h') ? 'updated' : ''}`}>
          {formatPercent(tickerData.funding8h)}
        </span>
      </div>
      <div className="ticker-item fomo-index">
        <span className="ticker-label">FOMO Index:</span>
        <span 
          className={`ticker-value fomo-value ${updatedFields.has('fomoIndex') ? 'updated' : ''}`}
          style={{ color: fomoColors[tickerData.fomoIndex] }}
        >
          {tickerData.fomoIndex} {fomoLabels[tickerData.fomoIndex]}
        </span>
        <span className={`connection-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
      </div>
    </div>
  );
};

