import React, { useEffect, useRef, useState } from 'react';
import { updateFomoIndicator, fomoIndexToSpeedometerValue, FomoData, calculateFomoIndex } from '../utils/fomoFinder';
import { binanceWebSocket } from '../utils/binanceWebSocket';

interface Segment {
  name: string;
  label: string;
  colorId: string;
}

const config = {
  radius: 160,
  centerX: 200,
  centerY: 200,
  trackWidth: 35,
  gap: 2,
  segments: [
    { name: "-3", label: "CAPITULATION", colorId: "url(#grad-pink)" },
    { name: "-2", label: "PANIC", colorId: "url(#grad-purple)" },
    { name: "-1", label: "UNCERTAIN", colorId: "url(#grad-yellow)" },
    { name: "0", label: "BALANCE", colorId: "url(#grad-yellow)" },
    { name: "1", label: "CANARY", colorId: "url(#grad-yellow)" },
    { name: "2", label: "GREED", colorId: "url(#grad-orange)" },
    { name: "3", label: "FOMO", colorId: "url(#grad-red)" }
  ] as Segment[]
};

interface CartesianCoord {
  x: number;
  y: number;
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number): CartesianCoord {
  const angleInRadians = (angleInDegrees - 180) * Math.PI / 180.0;
  return {
    x: centerX + (radius * Math.cos(angleInRadians)),
    y: centerY + (radius * Math.sin(angleInRadians))
  };
}

function createSegmentPath(x: number, y: number, outerR: number, innerR: number, startAngle: number, endAngle: number): string {
  const outerArcStart = polarToCartesian(x, y, outerR, endAngle);
  const outerArcEnd = polarToCartesian(x, y, outerR, startAngle);
  const innerArcStart = polarToCartesian(x, y, innerR, endAngle);
  const innerArcEnd = polarToCartesian(x, y, innerR, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M", outerArcStart.x, outerArcStart.y,
    "A", outerR, outerR, 0, largeArcFlag, 0, outerArcEnd.x, outerArcEnd.y,
    "L", innerArcEnd.x, innerArcEnd.y,
    "A", innerR, innerR, 0, largeArcFlag, 1, innerArcStart.x, innerArcStart.y,
    "Z"
  ].join(" ");
}

export const Speedometer: React.FC = () => {
  const needleGroupRef = useRef<SVGGElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [value, setValue] = useState(0); // Start at 0 for animation
  const [fomoData, setFomoData] = useState<FomoData | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [hasAnimated, setHasAnimated] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (!needleGroupRef.current) return;
    const clampedValue = Math.max(0, Math.min(100, value));
    const degrees = ((clampedValue / 100) * 180) - 90;
    
    // Calculate scale for hover effect
    const scale = isHovered ? 1.15 : 1;
    
    // Set initial position without transition, then animate
    if (isInitialLoad && value === 0) {
      needleGroupRef.current.style.transition = 'none';
      needleGroupRef.current.style.transform = `rotate(${degrees}deg) scale(${scale})`;
    } else {
      // Enable smooth transition for animation
      // Use faster transition for live updates (after initial animation)
      const transitionDuration = isHovered ? '0.3s' : hasAnimated ? '0.6s' : '1.5s';
      needleGroupRef.current.style.transition = `transform ${transitionDuration} cubic-bezier(0.16, 1, 0.3, 1), filter 0.3s ease`;
      needleGroupRef.current.style.transform = `rotate(${degrees}deg) scale(${scale})`;
      
      // Update filter for hover glow effect
      if (isHovered) {
        needleGroupRef.current.style.filter = 'drop-shadow(0 6px 20px rgba(255, 255, 255, 0.3)) drop-shadow(0 4px 10px rgba(0, 0, 0, 0.6))';
      } else {
        needleGroupRef.current.style.filter = 'drop-shadow(0 4px 10px rgba(0, 0, 0, 0.6))';
      }
    }
  }, [value, isInitialLoad, isHovered]);

  // Trigger animation after logo intro animation completes (2200ms)
  useEffect(() => {
    if (!hasAnimated && fomoData && fomoData.fomoIndex !== undefined) {
      // Logo animation completes at 2200ms, start needle animation right after
      const logoAnimationDuration = 2200;
      const timer = setTimeout(() => {
        const speedometerValue = fomoIndexToSpeedometerValue(fomoData.fomoIndex);
        setValue(speedometerValue);
        setIsInitialLoad(false);
        setHasAnimated(true);
      }, logoAnimationDuration + 50); // Small delay for smooth transition

      return () => clearTimeout(timer);
    }
  }, [hasAnimated, fomoData]);

  // Fetch initial FOMO indicator on mount
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const data = await updateFomoIndicator();
        setFomoData(data);
      } catch (error) {
        console.error('Failed to fetch initial FOMO data:', error);
      }
    };

    fetchInitialData();
  }, []);

  // Subscribe to live WebSocket updates (only after initial animation)
  useEffect(() => {
    if (!hasAnimated) return; // Wait for initial animation to complete
    
    binanceWebSocket.connect();
    
    const unsubscribe = binanceWebSocket.subscribe((liveData) => {
      // Only process if we have valid data
      if (!liveData.spot || !liveData.futures || liveData.funding8h === undefined) {
        return;
      }
      
      // Calculate premium from live prices
      const premium = ((liveData.futures - liveData.spot) / liveData.spot) * 100;
      
      // Calculate FOMO index from live funding rate
      const fomoIndex = calculateFomoIndex(premium, liveData.funding8h);
      
      const fomoData: FomoData = {
        timestamp: new Date().toISOString(),
        spot: liveData.spot,
        futures: liveData.futures,
        premium,
        funding8h: liveData.funding8h,
        fundingDaily: liveData.funding8h * 3,
        fomoIndex,
      };
      
      setFomoData(fomoData);
      const speedometerValue = fomoIndexToSpeedometerValue(fomoIndex);
      
      // Update value with live data - ensure transition is enabled
      setIsInitialLoad(false);
      setValue(speedometerValue);
      
      console.log('Speedometer update:', { fomoIndex, speedometerValue, funding8h: liveData.funding8h });
    });

    return () => {
      unsubscribe();
    };
  }, [hasAnimated]);

  const handleClick = () => {
    // Manually refresh FOMO data on click
    updateFomoIndicator()
      .then((data) => {
        setFomoData(data);
        const speedometerValue = fomoIndexToSpeedometerValue(data.fomoIndex);
        setValue(speedometerValue);
        setIsInitialLoad(false); // Ensure transitions work on manual refresh
      })
      .catch((error) => console.error('Failed to fetch FOMO data:', error));
  };

  const totalSegments = config.segments.length;
  const totalDegrees = 180;
  const segmentDegrees = totalDegrees / totalSegments;

  const trackD = createSegmentPath(config.centerX, config.centerY, config.radius, config.radius - config.trackWidth, 0, 180);

  return (
    <div className="flex items-center justify-center w-full h-full cursor-pointer" onClick={handleClick}>
      <svg
        ref={svgRef}
        viewBox="0 0 400 220"
        className="w-full max-w-5xl h-auto"
        style={{ overflow: 'visible', minHeight: '300px' }}
      >
        <defs>
          <filter id="glow-hover" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Metallic filters */}
          <filter id="metallic-shine" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.5" result="blur" />
            <feOffset in="blur" dx="0" dy="1" result="offsetBlur" />
            <feComponentTransfer in="offsetBlur" result="shadow">
              <feFuncA type="linear" slope="0.3" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="metallic-bevel" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.8" result="blur" />
            <feOffset in="blur" dx="1" dy="1" result="offsetBlur" />
            <feComponentTransfer in="offsetBlur" result="shadow">
              <feFuncA type="linear" slope="0.4" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Metallic track gradient */}
          <linearGradient id="metallic-track" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2a2a2a" />
            <stop offset="30%" stopColor="#1a1a1a" />
            <stop offset="50%" stopColor="#0f0f0f" />
            <stop offset="70%" stopColor="#1a1a1a" />
            <stop offset="100%" stopColor="#2a2a2a" />
          </linearGradient>

          {/* Gradients */}
          <linearGradient id="grad-pink" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ec4899" />
            <stop offset="100%" stopColor="#be185d" />
          </linearGradient>
          <linearGradient id="grad-purple" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#c084fc" />
            <stop offset="100%" stopColor="#7e22ce" />
          </linearGradient>
          <linearGradient id="grad-yellow" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#facc15" />
            <stop offset="100%" stopColor="#ca8a04" />
          </linearGradient>
          <linearGradient id="grad-orange" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#c2410c" />
          </linearGradient>
          <linearGradient id="grad-red" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#b91c1c" />
          </linearGradient>

          {/* Metallic needle gradient */}
          <linearGradient id="needle-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#64748b" />
            <stop offset="20%" stopColor="#cbd5e1" />
            <stop offset="50%" stopColor="#f8fafc" />
            <stop offset="80%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#64748b" />
          </linearGradient>

          {/* Metallic pivot gradient */}
          <radialGradient id="pivot-outer" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#475569" />
            <stop offset="50%" stopColor="#1e293b" />
            <stop offset="100%" stopColor="#0f172a" />
          </radialGradient>

          <radialGradient id="pivot-inner" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#64748b" />
            <stop offset="100%" stopColor="#334155" />
          </radialGradient>
        </defs>

        {/* Background Track */}
        <g id="track-layer">
          <path
            d={trackD}
            fill="url(#metallic-track)"
            opacity="0.6"
            filter="url(#metallic-bevel)"
          />
        </g>

        {/* Segments & Text Layer */}
        <g id="segments-layer">
          {config.segments.map((seg, index) => {
            const startAngle = (index * segmentDegrees) + (config.gap / 2);
            const endAngle = ((index + 1) * segmentDegrees) - (config.gap / 2);

            const d = createSegmentPath(
              config.centerX,
              config.centerY,
              config.radius,
              config.radius - config.trackWidth,
              startAngle,
              endAngle
            );

            const midRadius = config.radius - (config.trackWidth / 2);
            const arcStart = polarToCartesian(config.centerX, config.centerY, midRadius, startAngle);
            const arcEnd = polarToCartesian(config.centerX, config.centerY, midRadius, endAngle);
            const textPathD = `M ${arcStart.x} ${arcStart.y} A ${midRadius} ${midRadius} 0 0 1 ${arcEnd.x} ${arcEnd.y}`;
            const pathId = `textPath-${index}`;

            return (
              <g
                key={index}
                className="gauge-section"
                style={{
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  cursor: 'pointer',
                  opacity: 0.9,
                  transformOrigin: `${config.centerX}px ${config.centerY}px`
                }}
                onMouseEnter={(e) => {
                  const group = e.currentTarget;
                  group.style.opacity = '1';
                  group.style.filter = 'url(#glow-hover)';
                  group.style.transform = 'scale(1.03)';
                  group.style.zIndex = '10';
                }}
                onMouseLeave={(e) => {
                  const group = e.currentTarget;
                  group.style.opacity = '0.9';
                  group.style.filter = 'none';
                  group.style.transform = 'scale(1)';
                  group.style.zIndex = 'auto';
                }}
              >
                <title>{seg.label}</title>
                <path
                  d={d}
                  fill={seg.colorId}
                  className="segment-path"
                  filter="url(#metallic-shine)"
                  style={{
                    stroke: 'rgba(0, 0, 0, 0.2)',
                    strokeWidth: '0.5'
                  }}
                />

                {/* Text Path Definition */}
                <path
                  d={textPathD}
                  id={pathId}
                  style={{ display: 'none' }}
                />

                {/* Text Element */}
                <text
                  className="segment-text"
                  dominantBaseline="middle"
                  style={{
                    fontSize: '7px',
                    fontWeight: 800,
                    fill: 'rgba(255, 255, 255, 0.95)',
                    textTransform: 'uppercase',
                    pointerEvents: 'none',
                    letterSpacing: '0.5px',
                    filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.8)) drop-shadow(0 -1px 1px rgba(255,255,255,0.2))',
                    paintOrder: 'stroke fill'
                  }}
                >
                  <textPath
                    href={`#${pathId}`}
                    startOffset="50%"
                    textAnchor="middle"
                  >
                    {seg.label}
                  </textPath>
                </text>
              </g>
            );
          })}
        </g>

        {/* Needle Layer */}
        <g
          ref={needleGroupRef}
          className="needle needle-container"
          style={{
            transformOrigin: `${config.centerX}px ${config.centerY}px`,
            cursor: 'pointer'
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <path
            className="needle-path"
            d={`M 195 200 L 200 45 L 205 200 Z`}
            fill="url(#needle-grad)"
            filter="url(#metallic-shine)"
            style={{
              stroke: 'rgba(0, 0, 0, 0.3)',
              strokeWidth: '0.5'
            }}
          />
        </g>

        {/* Pivot Point */}
        <circle 
          cx={config.centerX} 
          cy={config.centerY} 
          r="14" 
          fill="url(#pivot-outer)" 
          stroke="rgba(255, 255, 255, 0.1)" 
          strokeWidth="1.5"
          filter="url(#metallic-bevel)"
        />
        <circle 
          cx={config.centerX} 
          cy={config.centerY} 
          r="6" 
          fill="url(#pivot-inner)"
          style={{
            filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5))'
          }}
        />
      </svg>
    </div>
  );
};

