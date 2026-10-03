import type { InputHTMLAttributes, ReactNode } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label: string;
  trailingControl?: ReactNode;
}

export function Field({
  error,
  id,
  label,
  trailingControl,
  ...inputProps
}: FieldProps) {
  const errorId = error && id ? `${id}-error` : undefined;

  return (
    <div>
      <label className="mb-2 block text-md font-bold text-ink" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          aria-describedby={errorId}
          aria-invalid={Boolean(error)}
          className={`min-h-11 w-full rounded-control border bg-surface px-3 py-2 text-md text-ink hover:border-ink disabled:bg-selected disabled:text-muted ${
            error ? "border-2 border-alert" : "border-line"
          } ${trailingControl ? "pr-20" : ""}`}
          {...inputProps}
        />
        {trailingControl ? (
          <div className="absolute inset-y-0 right-0 flex items-center">
            {trailingControl}
          </div>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="mt-2 text-sm text-alert" role="alert">
          <span className="sr-only">Error: </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}
