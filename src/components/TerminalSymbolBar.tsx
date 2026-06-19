import type { CSSProperties, ReactNode } from "react";

import { useI18n, type MessageKey } from "../app/i18n";
import {
  DEFAULT_KEYS,
  type ModKey,
  type Modifiers,
  type SpecialKeyId,
  type TerminalKey,
} from "../lib/terminalKeys";
import { Icon } from "./Icon";
import styles from "./TerminalSymbolBar.module.css";

// Keep in sync with the `.terminal-symbol-bar` height in TerminalSymbolBar.module.css; the
// terminal host reserves this much bottom padding so the cursor row stays
// visible above the bar.
export const SYMBOL_BAR_HEIGHT = 46;

const SPECIAL_ARIA: Record<SpecialKeyId, MessageKey> = {
  esc: "Escape",
  tab: "Tab",
  up: "Arrow up",
  down: "Arrow down",
  left: "Arrow left",
  right: "Arrow right",
};

export function TerminalSymbolBar(props: {
  modifiers: Modifiers;
  onModifier: (mod: ModKey) => void;
  onKey: (key: TerminalKey) => void;
  onPaste: () => void;
  style?: CSSProperties;
}) {
  const { t } = useI18n();

  return (
    <div
      className={styles.terminalSymbolBar}
      style={props.style}
      role="toolbar"
      aria-label={t("Terminal keys")}
    >
      {DEFAULT_KEYS.map((key, index) => {
        if (key.kind === "divider") {
          return <span key={index} className={styles.symbolDivider} aria-hidden="true" />;
        }
        if (key.kind === "modifier") {
          const state = props.modifiers[key.mod];
          return (
            <SymbolButton
              key={index}
              className={state === "off" ? undefined : styles[state]}
              ariaLabel={key.mod === "ctrl" ? t("Control") : t("Option")}
              ariaPressed={state !== "off"}
              onPress={() => props.onModifier(key.mod)}
            >
              {key.label}
            </SymbolButton>
          );
        }
        if (key.kind === "paste") {
          return (
            <SymbolButton key={index} ariaLabel={t("Paste")} onPress={props.onPaste}>
              <Icon name="content_copy" size={16} />
            </SymbolButton>
          );
        }
        if (key.kind === "text") {
          return (
            <SymbolButton
              key={index}
              className={styles.symbol}
              ariaLabel={key.char}
              onPress={() => props.onKey(key)}
            >
              {key.char}
            </SymbolButton>
          );
        }
        return (
          <SymbolButton
            key={index}
            ariaLabel={t(SPECIAL_ARIA[key.id])}
            onPress={() => props.onKey(key)}
          >
            {key.label}
          </SymbolButton>
        );
      })}
    </div>
  );
}

function SymbolButton(props: {
  className?: string;
  ariaLabel: string;
  ariaPressed?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={props.className}
      aria-label={props.ariaLabel}
      aria-pressed={props.ariaPressed}
      // Prevent the tap from blurring the terminal (which would dismiss the
      // soft keyboard); run the action on click instead.
      onPointerDown={(event) => event.preventDefault()}
      onClick={props.onPress}
    >
      {props.children}
    </button>
  );
}
