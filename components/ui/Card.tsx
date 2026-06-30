import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type Variant = "card" | "glass";

type Props<T extends ElementType> = {
  as?: T;
  variant?: Variant;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

const variantClassName: Record<Variant, string> = {
  card: "fx-card",
  glass: "fx-glass"
};

export function Card<T extends ElementType = "div">({
  as,
  variant = "card",
  className,
  children,
  ...props
}: Props<T>) {
  const Component = (as ?? "div") as ElementType;
  return (
    <Component
      className={[variantClassName[variant], className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </Component>
  );
}

