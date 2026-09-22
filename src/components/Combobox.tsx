"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

type ComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export default function Combobox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLLIElement | null>(null);

  const normalizedQuery = value.trim().toLowerCase();

  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    const startsWithMatches: string[] = [];
    const containsMatches: string[] = [];
    for (const option of options) {
      const normalizedOption = option.toLowerCase();
      if (normalizedOption.startsWith(normalizedQuery)) {
        startsWithMatches.push(option);
      } else if (normalizedOption.includes(normalizedQuery)) {
        containsMatches.push(option);
      }
    }
    return [...startsWithMatches, ...containsMatches];
  }, [options, normalizedQuery]);

  const closeDropdown = () => {
    setOpen(false);
    setHighlightedIndex(-1);
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        closeDropdown();
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

  const selectOption = (option: string) => {
    onChange(option);
    closeDropdown();
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
          closeDropdown();
        }
        event.preventDefault();
        break;
      case "Escape":
        closeDropdown();
        event.preventDefault();
        break;
      case "Tab":
        closeDropdown();
        break;
    }
  };

  const hasExactMatch = options.some(
    (option) => option.toLowerCase() === normalizedQuery
  );

  return (
    <div className="combobox" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className={["form-input", "combobox-input", className]
          .filter(Boolean)
          .join(" ")}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlightedIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
      />
      <button
        type="button"
        tabIndex={-1}
        className="combobox-toggle"
        onClick={() => {
          if (disabled) return;
          if (open) {
            closeDropdown();
          } else {
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
        <ul className="dropdown-menu combobox-menu" role="listbox">
          {filteredOptions.map((option, index) => (
            <li
              key={option}
              ref={index === highlightedIndex ? activeItemRef : null}
              role="option"
              aria-selected={option === value}
              className={[
                "dropdown-item",
                "combobox-item",
                index === highlightedIndex ? "combobox-item-active" : "",
                option === value ? "combobox-item-selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              {option}
            </li>
          ))}
          {filteredOptions.length === 0 && (
            <li className="dropdown-item combobox-empty" aria-disabled="true">
              {value.trim()
                ? "Tidak ada di master biaya rute — nilai bebas tetap dipakai"
                : "Tidak ada area tersedia"}
            </li>
          )}
          {value.trim() && !hasExactMatch && (
            <li className="combobox-note">
              Nilai tidak cocok di master, akan digunakan apa adanya.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}