import type { ReactNode } from "react";

type Props = {
  id?: string;
  eyebrow?: ReactNode;
  title?: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Section({ id, eyebrow, title, lead, children, className }: Props) {
  return (
    <section id={id} className={["fx-section", className].filter(Boolean).join(" ")}>
      {eyebrow ? <span className="fx-eyebrow">{eyebrow}</span> : null}
      {title ? <h2 className="fx-h2">{title}</h2> : null}
      {lead ? <p className="fx-lead">{lead}</p> : null}
      {children}
    </section>
  );
}

