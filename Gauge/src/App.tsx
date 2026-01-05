import { useState, useEffect } from 'react';
import { Speedometer } from './components/Speedometer';
import { BinanceChart } from './components/BinanceChart';
import { ShieldLoader } from './components/ShieldLoader';
import { LiveTicker } from './components/LiveTicker';

const HelpButton = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Bounce in after needle animation completes
  // Logo animation: 2200ms, Needle animation: 1500ms, Total: ~3700ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 3800); // Start bounce animation after needle completes

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`help-button-container ${isVisible ? 'bounce-in' : ''}`}>
      <button
        className="help-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Help"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
      {isOpen && (
        <div className="help-tooltip">
          <div className="help-content">
            <h3>What is the FOMO Index?</h3>
            <p className="help-intro">
              The FOMO Finder combines the funding rate and futures premium to identify the market's underlying emotion.
            </p>
            <div className="help-section">
              <h4>Reading the Signals</h4>
              <ul>
                <li><strong>Greed / FOMO (Orange/Red):</strong> Signals profit-taking opportunities on long positions. The trend may stall or reverse.</li>
                <li><strong>Panic / Capitulation (Purple/Pink):</strong> Signals profit-taking on shorts or opportunities to enter long positions.</li>
                <li><strong>Balanced (Yellow):</strong> Market is neutral. Trends are expected to continue.</li>
              </ul>
            </div>
            <button className="help-close" onClick={() => setIsOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const App = () => {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <>
      {isLoading && <ShieldLoader onComplete={() => setIsLoading(false)} />}
      <div className="app" style={{ opacity: isLoading ? 0 : 1, transition: 'opacity 0.5s ease-in' }}>
        {/* Background logo */}
        <div className="logo-background">
          <img 
            src="/assets/logo.svg" 
            alt="Whale Trades Logo" 
            className="logo-bg-image"
          />
        </div>
        
        <div className="w-full flex items-center justify-center py-12 relative z-10">
          <Speedometer />
        </div>
        <div className="w-full flex justify-center px-4 pb-8 relative z-10">
          <LiveTicker />
        </div>
        <div className="w-full flex justify-center pb-24 relative z-10">
          <BinanceChart />
        </div>
        
        <HelpButton />
      </div>
    </>
  );
};
