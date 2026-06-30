import type { ButtonHTMLAttributes, ComponentProps } from "react";

import { Link } from "@/i18n/navigation";

type Variant = "primary" | "secondary";
type Size = "md" | "sm";

type ButtonStyleOptions = {
  variant?: Variant;
  size?: Size;
  className?: string;
};

function sizeClassName(size: Size) {
  if (size === "sm") return "rounded-xl px-4 py-2 text-xs";
  return "";
}

export function buttonClassName({
  variant = "primary",
  size = "md",
  className
}: ButtonStyleOptions = {}) {
  const variantClass =
    variant === "primary" ? "fx-btn-primary" : variant === "secondary" ? "fx-btn-secondary" : "";

  return ["fx-btn", variantClass, sizeClassName(size), className].filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return (
    <button
      className={buttonClassName({ variant, size, className })}
      {...props}
    />
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
};

export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return (
    <Link
      className={buttonClassName({ variant, size, className })}
      {...props}
    />
  );
}

