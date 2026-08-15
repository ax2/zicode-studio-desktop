import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface PreferenceOption {
  value: string;
  label: string;
}

interface PreferenceSelectProps {
  id: string;
  value: string;
  options: PreferenceOption[];
  label: string;
  onChange: (value: string) => void;
}

/**
 * Accessible custom select that replaces the native <select> for the
 * Appearance preferences. The native dropdown popup is rendered by the OS in
 * WebView2 and does not follow the app theme, so this renders the option list
 * in-DOM with the standard combobox/listbox ARIA pattern.
 */
export function PreferenceSelect({
  id,
  value,
  options,
  label,
  onChange,
}: PreferenceSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = `${id}-listbox`;

  useEffect(() => {
    setActiveIndex(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
  }, [value, options]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [open]);

  const select = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveActive = (delta: number) => {
    setOpen(true);
    setActiveIndex(
      (index) => (index + delta + options.length) % options.length,
    );
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        event.preventDefault();
        setOpen(true);
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setOpen(true);
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open && options[activeIndex]) {
          select(options[activeIndex].value);
        } else {
          setOpen(true);
        }
        break;
      default:
        break;
    }
  };

  const current = options.find((option) => option.value === value);

  return (
    <div className="preference-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="ui-select settings-preference-select preference-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open ? `${id}-option-${activeIndex}` : undefined
        }
        aria-label={label}
        onClick={() => setOpen((next) => !next)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="preference-select-value">
          {current?.label ?? value}
        </span>
        <svg
          className="preference-select-chevron"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 5l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          id={listboxId}
          className="preference-select-menu"
          role="listbox"
          aria-label={label}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              id={`${id}-option-${index}`}
              className={`preference-select-option${
                option.value === value ? " selected" : ""
              }${index === activeIndex ? " active" : ""}`}
              role="option"
              aria-selected={option.value === value}
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
