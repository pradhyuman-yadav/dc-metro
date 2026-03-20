"use client";
import { AnimatePresence, motion } from "framer-motion";

export interface AccordionCardItem {
  title: string;
  description: string;
  content: React.ReactNode;
}

/** @deprecated use AccordionCardItem */
export type ExpandableCardItem = AccordionCardItem;

interface AccordionCardsProps {
  items: AccordionCardItem[];
  activeId: string | null;
  onToggle: (id: string | null) => void;
}

export function AccordionCards({ items, activeId, onToggle }: AccordionCardsProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((item) => {
        const isOpen = item.title === activeId;
        return (
          <div
            key={item.title}
            style={{
              border: "1px solid var(--color-border, rgba(0,0,0,0.1))",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => onToggle(isOpen ? null : item.title)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 10px",
                background: "none",
                cursor: "pointer",
                textAlign: "left",
                border: "none",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--color-foreground, #111)",
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--color-muted-foreground, #888)",
                    marginTop: 2,
                  }}
                >
                  {item.description}
                </div>
              </div>
              <span
                style={{
                  color: "var(--color-muted-foreground, #888)",
                  display: "inline-block",
                  transform: isOpen ? "rotate(90deg)" : "none",
                  transition: "transform 0.2s",
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                {">"}
              </span>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  style={{ overflow: "hidden" }}
                >
                  <div
                    style={{
                      padding: "0 10px 10px",
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: "var(--color-foreground, #111)",
                    }}
                  >
                    {item.content}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/** @deprecated use AccordionCards */
export const ExpandableCards = AccordionCards;
