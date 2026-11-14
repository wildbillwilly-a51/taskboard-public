"use client";

import { useRef, useState, type CSSProperties } from "react";

// A name typed in place (Slab-style) instead of a browser prompt: Enter or
// leaving the field saves, Escape cancels, an empty name cancels.
export function InlineNameField({
  initialValue = "",
  placeholder,
  label,
  className,
  inputClassName,
  style,
  maxLength = 120,
  testId,
  onSubmit,
  onCancel,
}: {
  initialValue?: string;
  placeholder: string;
  label: string;
  className?: string;
  inputClassName?: string;
  style?: CSSProperties;
  maxLength?: number;
  testId?: string;
  // Resolves to an error message, or null when saved.
  onSubmit: (value: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  // A ref, not state: Enter disables the field, and the blur that follows
  // must not submit a second time.
  const savingRef = useRef(false);

  const submit = async () => {
    if (savingRef.current) {
      return;
    }

    const name = value.replace(/\s+/g, " ").trim();

    if (!name || name === initialValue.trim()) {
      onCancel();
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    try {
      const failure = await onSubmit(name);
      if (failure) {
        setError(failure);
      }
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <span className={`inline-name-field ${className ?? ""}`} style={style}>
      <input
        autoFocus
        className={inputClassName ?? "inline-name-field-input"}
        data-testid={testId}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        maxLength={maxLength}
        disabled={isSaving}
        onChange={(event) => {
          setValue(event.target.value);
          setError("");
        }}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => {
          // After a failed save, leaving the field keeps the message visible
          // instead of retrying.
          if (!error) {
            void submit();
          }
        }}
      />
      {error ? (
        <span className="inline-name-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
