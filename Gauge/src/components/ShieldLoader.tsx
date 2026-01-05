import React, { useEffect, useState } from 'react';

export const ShieldLoader: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [isAnimating, setIsAnimating] = useState(true);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Animation duration: 2.2 seconds (allow time for assembly + pause)
    const animationDuration = 2200;
    
    // After animation completes, fade out
    const fadeOutTimer = setTimeout(() => {
      setIsAnimating(false);
      setTimeout(() => {
        setIsVisible(false);
        onComplete();
      }, 500); // Fade out duration
    }, animationDuration);

    return () => clearTimeout(fadeOutTimer);
  }, [onComplete]);

  if (!isVisible) return null;

  return (
    <div 
      className={`shield-loader ${isAnimating ? 'animating' : 'fading-out'}`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: '#171717',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        transition: 'opacity 0.5s ease-out',
      }}
    >
      <svg
        width="520"
        height="478"
        viewBox="0 0 519.086 477.011"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ maxWidth: '300px', maxHeight: '275px', width: '100%', height: 'auto' }}
      >
        <defs>
          <linearGradient id="paint0_linear" x1="5.40572" y1="277.019" x2="265.349" y2="277.019" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF4E00"/>
            <stop offset="1" stopColor="#FFF200"/>
          </linearGradient>
          <linearGradient id="paint1_linear" x1="525.292" y1="277.019" x2="265.349" y2="277.019" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFF200"/>
            <stop offset="1" stopColor="#FF4E00"/>
          </linearGradient>
          <linearGradient id="paint2_linear" x1="356.347" y1="363.029" x2="447.184" y2="355.53" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFF200"/>
            <stop offset="1" stopColor="#FF960B"/>
          </linearGradient>
          <linearGradient id="paint3_linear" x1="390.927" y1="317.337" x2="468.208" y2="317.337" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF960B"/>
            <stop offset="1" stopColor="#FFF200"/>
          </linearGradient>
          <linearGradient id="paint4_linear" x1="49.0205" y1="376.68" x2="184.847" y2="376.68" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF960B"/>
            <stop offset="1" stopColor="#FFFB00"/>
          </linearGradient>
          <linearGradient id="paint5_linear" x1="53.7823" y1="317.337" x2="131.063" y2="317.337" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFF200"/>
            <stop offset="1" stopColor="#FF960B"/>
          </linearGradient>
          <linearGradient id="paint6_linear" x1="78.3535" y1="106.534" x2="258.674" y2="106.534" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF960B"/>
            <stop offset="1" stopColor="#FFF200"/>
          </linearGradient>
          <linearGradient id="paint7_linear" x1="258.675" y1="106.534" x2="438.995" y2="106.534" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF960B"/>
            <stop offset="1" stopColor="#FFF200"/>
          </linearGradient>
        </defs>
        
        {/* Left side piece - starts from left */}
        <g className="shield-piece shield-left" transform="translate(0, 0)">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M205.769 163.675L259.553 238.496V477.011L201.085 446.607L203.427 383.475L144.979 306.312L51.4421 250.186L0 166.017V88.8535L51.4421 116.916L205.769 163.675Z"
            fill="url(#paint0_linear)"
          />
        </g>

        {/* Right side piece - starts from right */}
        <g className="shield-piece shield-right" transform="translate(0, 0)">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M259.553 238.496L315.679 163.675L469.985 116.916L519.086 88.8535V166.017L467.644 250.186L376.449 306.312L315.679 383.475V446.607L259.553 477.011V238.496Z"
            fill="url(#paint1_linear)"
          />
        </g>

        {/* Top left piece */}
        <g className="shield-piece shield-top-left" transform="translate(0, 0)">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M79.5049 102.884L259.552 0V208.11L214.823 147.379L79.5049 102.884Z"
            fill="url(#paint6_linear)"
          />
        </g>

        {/* Top right piece */}
        <g className="shield-piece shield-top-right" transform="translate(0, 0)">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M259.553 0L439.581 102.884L306.955 147.379L259.553 208.11V0Z"
            fill="url(#paint7_linear)"
          />
        </g>

        {/* Middle right piece */}
        <g className="shield-piece shield-middle-right" transform="translate(0, 0)">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M332.031 388.373L390.479 313.317L467.643 271.242V357.753L332.031 435.521V388.373Z"
            fill="url(#paint2_linear)"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M390.479 313.317L467.642 271.242V357.753L390.479 313.317Z"
            fill="url(#paint3_linear)"
          />
        </g>

        {/* Middle left piece */}
        <g className="shield-piece shield-middle-left" transform="translate(0, 0)">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M187.052 388.376L128.604 313.32L51.4404 357.756L187.052 435.525V388.376Z"
            fill="url(#paint4_linear)"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M128.604 313.317L51.4404 271.242V357.753L128.604 313.317Z"
            fill="url(#paint5_linear)"
          />
        </g>
      </svg>

      <style>{`
        .shield-loader.animating .shield-piece {
          animation: assembleShield 1s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
          opacity: 0;
        }

        .shield-loader.animating .shield-left {
          animation-delay: 0s;
          transform: translate(-150px, 0) scale(0.7) rotate(-10deg);
        }

        .shield-loader.animating .shield-right {
          animation-delay: 0.08s;
          transform: translate(150px, 0) scale(0.7) rotate(10deg);
        }

        .shield-loader.animating .shield-top-left {
          animation-delay: 0.16s;
          transform: translate(-120px, -120px) scale(0.7) rotate(-15deg);
        }

        .shield-loader.animating .shield-top-right {
          animation-delay: 0.24s;
          transform: translate(120px, -120px) scale(0.7) rotate(15deg);
        }

        .shield-loader.animating .shield-middle-right {
          animation-delay: 0.32s;
          transform: translate(80px, 80px) scale(0.7) rotate(5deg);
        }

        .shield-loader.animating .shield-middle-left {
          animation-delay: 0.40s;
          transform: translate(-80px, 80px) scale(0.7) rotate(-5deg);
        }

        @keyframes assembleShield {
          to {
            transform: translate(0, 0) scale(1) rotate(0deg);
            opacity: 1;
          }
        }
        
        .shield-loader.animating svg {
          animation: shieldPulse 2.2s ease-out forwards;
        }

        @keyframes shieldPulse {
          0%, 60% { 
            filter: drop-shadow(0 0 0 rgba(255, 150, 11, 0)); 
            transform: scale(1); 
          }
          75% { 
            filter: drop-shadow(0 0 25px rgba(255, 150, 11, 0.5)); 
            transform: scale(1.05); 
          }
          100% { 
            filter: drop-shadow(0 0 0 rgba(255, 150, 11, 0)); 
            transform: scale(1); 
          }
        }

        .shield-loader.fading-out svg {
          animation: none;
          transform: scale(1) !important;
        }

        .shield-loader.fading-out {
          opacity: 0;
          transition: opacity 0.5s ease-out;
        }
      `}</style>
    </div>
  );
};

