import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "quiet" | "destructive";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "border border-ink bg-ink text-surface hover:opacity-90 disabled:border-hairline disabled:bg-hairline disabled:text-muted",
  secondary:
    "border border-line bg-surface text-ink hover:bg-selected disabled:border-hairline disabled:text-muted",
  quiet:
    "border border-transparent bg-transparent text-ink hover:bg-selected hover:underline disabled:text-muted",
  destructive:
    "border border-alert bg-surface text-alert hover:bg-alert-tint disabled:border-hairline disabled:text-muted",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: ButtonVariant;
}

export function Button({
  children,
  className = "",
  disabled,
  loading = false,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center rounded-control px-5 text-md font-bold transition-colors ${VARIANT_CLASSES[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
    </button>
  );
}
