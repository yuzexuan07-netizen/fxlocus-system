import type { HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLSpanElement>;

export function Badge({ className, ...props }: Props) {
  return <span className={["fx-pill", className].filter(Boolean).join(" ")} {...props} />;
}

