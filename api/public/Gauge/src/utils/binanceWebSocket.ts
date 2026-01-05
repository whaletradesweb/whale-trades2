// Binance WebSocket utilities for live price and funding rate updates

export interface LivePriceData {
  spot: number;
  futures: number;
  funding8h: number;
  timestamp: number;
}

type PriceUpdateCallback = (data: LivePriceData) => void;

class BinanceWebSocketManager {
  private spotWs: WebSocket | null = null;
  private futuresWs: WebSocket | null = null;
  private fundingWs: WebSocket | null = null;
  private callbacks: Set<PriceUpdateCallback> = new Set();
  private spotPrice: number = 0;
  private futuresPrice: number = 0;
  private fundingRate: number = 0;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect() {
    // Spot price WebSocket
    this.connectSpot();
    
    // Futures mark price WebSocket
    this.connectFutures();
    
    // Funding rate WebSocket (updates every 8 hours, but we'll poll via REST)
    this.startFundingRatePolling();
  }

  private connectSpot() {
    if (this.spotWs?.readyState === WebSocket.OPEN) return;

    this.spotWs = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@ticker');
    
    this.spotWs.onopen = () => {
      console.log('Spot price WebSocket connected');
      this.reconnectAttempts = 0;
    };

    this.spotWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.spotPrice = parseFloat(data.c); // Last price
        this.notifyCallbacks();
      } catch (error) {
        console.error('Error parsing spot price:', error);
      }
    };

    this.spotWs.onerror = (error) => {
      console.error('Spot WebSocket error:', error);
    };

    this.spotWs.onclose = () => {
      console.log('Spot WebSocket closed, reconnecting...');
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.connectSpot(), 1000 * this.reconnectAttempts);
      }
    };
  }

  private connectFutures() {
    if (this.futuresWs?.readyState === WebSocket.OPEN) return;

    this.futuresWs = new WebSocket('wss://fstream.binance.com/ws/btcusdt@markPrice');
    
    this.futuresWs.onopen = () => {
      console.log('Futures price WebSocket connected');
      this.reconnectAttempts = 0;
    };

    this.futuresWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.futuresPrice = parseFloat(data.p); // Mark price
        this.notifyCallbacks();
      } catch (error) {
        console.error('Error parsing futures price:', error);
      }
    };

    this.futuresWs.onerror = (error) => {
      console.error('Futures WebSocket error:', error);
    };

    this.futuresWs.onclose = () => {
      console.log('Futures WebSocket closed, reconnecting...');
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.connectFutures(), 1000 * this.reconnectAttempts);
      }
    };
  }

  private startFundingRatePolling() {
    // Funding rate updates every 8 hours, so we poll every 5 minutes
    // Use premiumIndex endpoint for current/next funding rate
    const fetchFundingRate = async () => {
      try {
        const response = await fetch(
          'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'
        );
        const data = await response.json();
        if (data && data.lastFundingRate !== undefined) {
          // Binance returns funding rate as decimal fraction: -0.0000079 = -0.00079%
          // CSV format stores as percentage decimal: -0.063 = -6.3%
          // To convert: multiply by 100 to get percentage decimal format
          // -0.0000079 * 100 = -0.00079 (matches CSV format)
          this.fundingRate = parseFloat(data.lastFundingRate) * 100;
          this.notifyCallbacks();
        }
      } catch (error) {
        console.error('Error fetching funding rate:', error);
        // Fallback to fundingRate endpoint
        try {
          const fallbackResponse = await fetch(
            'https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1'
          );
          const fallbackData = await fallbackResponse.json();
          if (fallbackData && fallbackData.length > 0) {
            // Convert Binance decimal fraction to CSV percentage decimal format
            this.fundingRate = parseFloat(fallbackData[0].fundingRate) * 100;
            this.notifyCallbacks();
          }
        } catch (fallbackError) {
          console.error('Error fetching funding rate fallback:', fallbackError);
        }
      }
    };

    // Fetch immediately
    fetchFundingRate();
    
    // Then poll every 5 minutes
    setInterval(fetchFundingRate, 5 * 60 * 1000);
  }

  private notifyCallbacks() {
    if (this.spotPrice > 0 && this.futuresPrice > 0) {
      const data: LivePriceData = {
        spot: this.spotPrice,
        futures: this.futuresPrice,
        funding8h: this.fundingRate,
        timestamp: Date.now(),
      };
      
      this.callbacks.forEach(callback => callback(data));
    }
  }

  subscribe(callback: PriceUpdateCallback) {
    this.callbacks.add(callback);
    
    // Send current data if available
    if (this.spotPrice > 0 && this.futuresPrice > 0) {
      this.notifyCallbacks();
    }
    
    return () => {
      this.callbacks.delete(callback);
    };
  }

  disconnect() {
    if (this.spotWs) {
      this.spotWs.close();
      this.spotWs = null;
    }
    if (this.futuresWs) {
      this.futuresWs.close();
      this.futuresWs = null;
    }
    this.callbacks.clear();
  }

  getCurrentData(): LivePriceData | null {
    if (this.spotPrice > 0 && this.futuresPrice > 0) {
      return {
        spot: this.spotPrice,
        futures: this.futuresPrice,
        funding8h: this.fundingRate,
        timestamp: Date.now(),
      };
    }
    return null;
  }
}

// Singleton instance
export const binanceWebSocket = new BinanceWebSocketManager();

