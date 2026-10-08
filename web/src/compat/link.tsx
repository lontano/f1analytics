import type { MouseEvent, ReactNode } from "react";
import { openDashboardPath } from "@/shell/openPath";

type Props = {
  href: string;
  children?: ReactNode;
  className?: string;
  target?: string;
  title?: string;
};

export default function Link({ href, children, className, target, title }: Props) {
  if (href.startsWith("/dashboard") || href === "/schedule" || href === "/help") {
    return (
      <a
        href={href}
        className={className}
        title={title}
        onClick={(event: MouseEvent) => {
          event.preventDefault();
          openDashboardPath(href);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a href={href} className={className} target={target} title={title} rel={target === "_blank" ? "noreferrer" : undefined}>
      {children}
    </a>
  );
}
