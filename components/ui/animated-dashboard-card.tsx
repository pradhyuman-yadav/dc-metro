"use client";
import { useReducedMotion, motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface BonusesIncentivesCardProps {
  bonusesValue: number;    // moving trains
  incentivesValue: number; // at-station trains
  total: number;           // total trains
  totalPassengers?: number;
  capacityTotal?: number;  // total capacity (trains × 1050)
}

function DotRing({
  radius,
  count,
  filled,
  color,
  delay = 0,
}: {
  radius: number;
  count: number;
  filled: number;
  color: string;
  delay?: number;
}) {
  const prefersReduced = useReducedMotion();
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
        const cx = 50 + radius * Math.cos(angle);
        const cy = 50 + radius * Math.sin(angle);
        const isFilled = i < filled;
        return (
          <motion.circle
            key={i}
            cx={cx}
            cy={cy}
            r={2.2}
            fill={isFilled ? color : "currentColor"}
            className={isFilled ? "" : "text-zinc-200 dark:text-zinc-700"}
            initial={prefersReduced ? false : { opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: prefersReduced ? 0 : delay + i * 0.02,
              type: "spring",
              stiffness: 260,
              damping: 20,
            }}
          />
        );
      })}
    </>
  );
}

export function BonusesIncentivesCard({
  bonusesValue,
  incentivesValue,
  total,
  totalPassengers = 0,
  capacityTotal = 0,
}: BonusesIncentivesCardProps) {
  const prefersReduced = useReducedMotion();
  const prevTotal = useRef(total);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (total !== prevTotal.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 600);
      prevTotal.current = total;
      return () => clearTimeout(t);
    }
  }, [total]);

  const outerCount = Math.max(total, 12);
  const innerCount = Math.max(Math.ceil(total * 0.6), 8);

  const avgUtil = capacityTotal > 0
    ? Math.round((totalPassengers / capacityTotal) * 100)
    : 0;

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: "var(--card, rgba(255,255,255,0.92))",
        borderColor: "var(--color-border, rgba(0,0,0,0.1))",
      }}
    >
      <p
        className="text-[10px] font-semibold uppercase tracking-wider mb-3"
        style={{ color: "var(--color-muted-foreground, #888)" }}
      >
        Live Fleet
      </p>

      <div className="flex items-center gap-4">
        {/* SVG dot rings */}
        <div className="relative flex-shrink-0" style={{ width: 72, height: 72 }}>
          <svg viewBox="0 0 100 100" width={72} height={72}>
            <DotRing
              radius={44}
              count={outerCount}
              filled={bonusesValue}
              color="#22c55e"
              delay={0}
            />
            <DotRing
              radius={30}
              count={innerCount}
              filled={incentivesValue}
              color="#f59e0b"
              delay={0.1}
            />
          </svg>
          {/* Center: total trains */}
          <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
            <AnimatePresence mode="wait">
              <motion.span
                key={total}
                initial={prefersReduced ? false : { opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.2 }}
                className="text-lg font-bold tabular-nums"
                style={{ color: "var(--color-foreground, #111)" }}
              >
                {total}
              </motion.span>
            </AnimatePresence>
            <span
              className="text-[8px] mt-0.5"
              style={{ color: "var(--color-muted-foreground, #888)" }}
            >
              trains
            </span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-2 flex-1">
          <LegendRow color="#22c55e" label="Moving"     value={bonusesValue}   total={total} />
          <LegendRow color="#f59e0b" label="At station" value={incentivesValue} total={total} />
          <LegendRow
            color="#818cf8"
            label="Avg load"
            value={avgUtil}
            total={100}
            displayValue={`${avgUtil}%`}
          />
        </div>
      </div>

      {/* Passenger summary bar */}
      {capacityTotal > 0 && (
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--color-border, rgba(0,0,0,0.08))" }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px]" style={{ color: "var(--color-muted-foreground, #888)" }}>
              Passengers aboard
            </span>
            <span className="text-[10px] font-semibold tabular-nums" style={{ color: "var(--color-foreground, #111)" }}>
              {totalPassengers.toLocaleString()} / {capacityTotal.toLocaleString()}
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-muted, rgba(0,0,0,0.08))" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #818cf8, #a78bfa)" }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, avgUtil)}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function LegendRow({
  color,
  label,
  value,
  total,
  displayValue,
}: {
  color: string;
  label: string;
  value: number;
  total: number;
  displayValue?: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: color }}
          />
          <span
            className="text-[10px]"
            style={{ color: "var(--color-muted-foreground, #888)" }}
          >
            {label}
          </span>
        </div>
        <span
          className="text-[10px] font-semibold tabular-nums"
          style={{ color: "var(--color-foreground, #111)" }}
        >
          {displayValue ?? value}
        </span>
      </div>
      <div
        className="h-1 rounded-full overflow-hidden"
        style={{ background: "var(--color-muted, rgba(0,0,0,0.08))" }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
