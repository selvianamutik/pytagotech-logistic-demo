"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";

// Must stay in sync with .combobox-menu max-height in globals.css.
const MENU_MAX_HEIGHT = 220;

export type ComboboxOption = string | { value: string; label: string; meta?: ReactNode };

type NormalizedOption = { value: string; label: string; meta?: ReactNode };

function normalizeOptions(options: ComboboxOption[]): NormalizedOption[] {
  return options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option
  );
}

type ComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
  /** values that render disabled and cannot be chosen (replaces per-option disabled) */
  disabledValues?: string[];
  /** restricts typing to listed options; default true keeps legacy free-text behaviour */
  allowCustomValue?: boolean;
};

export default function Combobox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  required,
  disabledValues,
  allowCustomValue = true,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [query, setQuery] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLLIElement | null>(null);
  // Set when we blur the input ourselves right after committing a choice,
  // so the blur handler does not wipe the just-committed value with stale state.
  const skipBlurClearRef = useRef(false);

  // Keeps the document-level outside-click handler non-stale. The listener
  // is only (re)bound on [open], so a plain closure would capture the
  // closeDropdown from the render that opened the dropdown — when `query`
  // was still null — and every outside click after typing would silently
  // revert the pending query. Always call through this ref instead.
  // The initializer must NOT reference closeDropdown here: closeDropdown is a
  // const declared further down, so useRef(closeDropdown) would be a
  // use-before-assignment (TS2448/2454). Start null; it is assigned on every
  // render right after closeDropdown is defined.
  const closeDropdownRef = useRef<() => void>(null as unknown as () => void);

  const commitClearedRef = useRef(true);

  const blurInput = () => {
    if (document.activeElement === inputRef.current) {
      skipBlurClearRef.current = true;
    }
    inputRef.current?.blur();
  };

  const normalizedOptions = useMemo(
    () => normalizeOptions(options),
    [options]
  );

  const valueLabel = useMemo(() => {
    const match = normalizedOptions.find((option) => option.value === value);
    return match ? match.label : value;
  }, [normalizedOptions, value]);

  // While the user is typing, display the query; otherwise display the
  // label of the currently selected value.
  const displayValue = query ?? valueLabel;

  const showClear = !disabled && displayValue !== "";

  // `query === null` means the user is not typing, so the input text is only
  // the selected label. Filtering on it would narrow the list to the current
  // choice alone and read as "no other options", so an open dropdown browses
  // the full list until the user actually types.
  const isBrowsing = open && query === null;
  const normalizedQuery = (isBrowsing ? "" : displayValue).trim().toLowerCase();

  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return normalizedOptions;
    const startsWithMatches: NormalizedOption[] = [];
    const containsMatches: NormalizedOption[] = [];
    for (const option of normalizedOptions) {
      const normalizedOption = option.label.toLowerCase();
      if (normalizedOption.startsWith(normalizedQuery)) {
        startsWithMatches.push(option);
      } else if (normalizedOption.includes(normalizedQuery)) {
        containsMatches.push(option);
      }
    }
    return [...startsWithMatches, ...containsMatches];
  }, [normalizedOptions, normalizedQuery]);

  // Commits unfinished typing the same way Enter does: an exact label match
  // resolves to its option value (unless disabled), other text is kept
  // as-is when free text is allowed, and an emptied input clears.
  // Returns true when the query was consumed (caller should reset it).
  const commitPendingQuery = (commitCleared = true) => {
    if (query === null) return false;    const trimmed = query.trim();
    if (trimmed === "") {
      if (commitCleared && value !== "") onChange("");
      return true;
    }
    const exact = normalizedOptions.find(
      (option) => option.label.toLowerCase() === trimmed.toLowerCase()
    );
    if (exact && !disabledValues?.includes(exact.value)) {
      if (exact.value !== value) onChange(exact.value);
      return true;
    }
    if (exact) return true; // disabled option typed out: revert, never commit
    if (commitCleared && allowCustomValue) onChange(trimmed);
    return true;
  };

  const closeDropdown = (commitCleared = true) => {
    commitPendingQuery(commitCleared);
    setOpen(false);
    setHighlightedIndex(-1);
    setQuery(null);
    blurInput();
  };

  // Keep the ref pointing at the latest closeDropdown every render so the
  // outside-click and scroll listeners never hold stale state.
  closeDropdownRef.current = closeDropdown;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        // Always go through the ref: this listener is bound on [open] and a
        // direct call would use the closeDropdown from the opening render,
        // whose `query` was still null, silently reverting pending typing.
        closeDropdownRef.current();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
      activeItemRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [open, highlightedIndex, filteredOptions.length]);

  // A dropdown that always opens downward grows the scrollable overflow of the
  // nearest scroll container (the modal body), so clicking a field near the
  // bottom edge makes the modal show a scrollbar it did not have before. Flip
  // the menu above the field whenever there is more room up there.
  useEffect(() => {
    if (!open) {
      setOpenUpward(false);
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setOpenUpward(spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow);

    const handleViewportChange = () => {
      const next = container.getBoundingClientRect();
      const below = window.innerHeight - next.bottom;
      setOpenUpward(below < MENU_MAX_HEIGHT && next.top > below);
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open]);

  const selectOption = (option: NormalizedOption) => {
    if (disabledValues?.includes(option.value)) return;
    onChange(option.value);
    setQuery(null);
    setOpen(false);
    setHighlightedIndex(-1);
    blurInput();
  };

  const commitFreeText = () => {
    // closeDropdown commits pending typing (or reverts when disallowed).
    closeDropdown(allowCustomValue);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (!open && event.key === "ArrowDown") {
      setOpen(true);
      setHighlightedIndex(0);
      event.preventDefault();
      return;
    }
    if (!open) return;
    switch (event.key) {
      case "ArrowDown":
        setHighlightedIndex((previous) =>
          Math.min(previous + 1, filteredOptions.length - 1)
        );
        event.preventDefault();
        break;
      case "ArrowUp":
        setHighlightedIndex((previous) => Math.max(previous - 1, 0));
        event.preventDefault();
        break;
      case "Enter":
        if (highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
          selectOption(filteredOptions[highlightedIndex]);
        } else {
          commitFreeText();
        }        event.preventDefault();
        break;
      case "Escape":
        setQuery(null);
        closeDropdown(false);
        event.preventDefault();
        break;
      case "Tab":
        setQuery(null);
        closeDropdown();
        break;
    }
  };

  return (
    <div className={showClear ? "combobox combobox-has-clear" : "combobox"} ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className={["form-input", "combobox-input", className]
          .filter(Boolean)
          .join(" ")}
        value={displayValue}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setOpen(true);
          setHighlightedIndex(-1);
        }}
        onFocus={() => {
          setOpen(true);
          // Select the shown label so the first keystroke replaces it instead
          // of appending to it.
          inputRef.current?.select();
        }}
        onBlur={() => {
          // Blur caused by our own commit (option click / Enter / Escape):
          // the closure still holds pre-commit state, so skip the
          // cleared-input check to avoid wiping the just-chosen value.
          if (skipBlurClearRef.current) {
            skipBlurClearRef.current = false;
            setQuery(null);
            return;
          }
          // Genuine focus loss (bypasses closeDropdown): commit unfinished
          // typing instead of silently discarding it.
          commitPendingQuery(true);
          setQuery(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
      />
      {showClear && (
        <button
          type="button"
          tabIndex={-1}
          className="combobox-toggle combobox-clear"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange("");
            setQuery("");
            setOpen(true);
            setHighlightedIndex(-1);
            inputRef.current?.focus();
          }}
          aria-label="Hapus pilihan"
        >
          <X size={16} />
        </button>
      )}
      <button
        type="button"
        tabIndex={-1}
        className="combobox-toggle"
        onClick={() => {
          if (disabled) return;
          if (open) {
            closeDropdown();
          } else {
            setQuery(null);
            setOpen(true);
            setHighlightedIndex(0);
          }
          inputRef.current?.focus();
        }}
        disabled={disabled}
        aria-label="Buka daftar pilihan"
      >
        <ChevronDown size={16} />
      </button>
      {open && (
        <ul
          className={
            openUpward ? "dropdown-menu combobox-menu combobox-menu-up" : "dropdown-menu combobox-menu"
          }
          role="listbox"
        >
          {filteredOptions.map((option, index) => (
            <li
              key={option.value + "::" + option.label}
              ref={index === highlightedIndex ? activeItemRef : null}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={disabledValues?.includes(option.value) || undefined}
              className={[
                "dropdown-item",
                "combobox-item",
                index === highlightedIndex ? "combobox-item-active" : "",
                option.value === value ? "combobox-item-selected" : "",
                disabledValues?.includes(option.value) ? "combobox-item-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              {option.meta ? (
                <span className="combobox-item-main">
                  <span className="combobox-item-label">{option.label}</span>
                  {option.meta}
                </span>
              ) : (
                option.label
              )}
            </li>
          ))}
          {filteredOptions.length === 0 && (
            <li className="dropdown-item combobox-empty" aria-disabled="true">
              {displayValue.trim()
                ? `Tidak ada hasil untuk "${displayValue.trim()}"`
                : "Tidak ada pilihan tersedia"}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
