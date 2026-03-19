'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { TextShimmer } from '@/components/ui/text-shimmer';

interface LoadingScreenProps {
  visible: boolean;
}

/** Full-screen overlay shown while Metro route + station data loads. */
export default function LoadingScreen({ visible }: LoadingScreenProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="loading"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0f172a',
            gap: 20,
          }}
        >
          {/* Metro map icon */}
          <svg
            width="56"
            height="56"
            viewBox="0 0 56 56"
            fill="none"
            aria-hidden="true"
          >
            <rect width="56" height="56" rx="12" fill="#1e293b" />
            {/* M shape */}
            <path
              d="M10 40 L10 18 L22 32 L28 24 L34 32 L46 18 L46 40"
              stroke="#60a5fa"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>

          <TextShimmer
            className="text-2xl font-semibold tracking-wide font-mono
              [--base-color:#64748b] [--base-gradient-color:#e2e8f0]
              dark:[--base-color:#64748b] dark:[--base-gradient-color:#e2e8f0]"
            duration={1.6}
            spread={3}
          >
            Loading DC Metro…
          </TextShimmer>

          <p style={{ color: '#475569', fontSize: 13, marginTop: -8 }}>
            Fetching live track & station data
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
