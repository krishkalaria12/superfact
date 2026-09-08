"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ModeToggle } from "./mode-toggle";

const LINKS = [
  { to: "/", label: "Documents" },
  { to: "/cases", label: "Four cases" },
] as const;

export default function Header() {
  const pathname = usePathname();

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-3 py-2">
        <div className="flex items-baseline gap-6">
          <Link className="font-semibold text-sm tracking-tight" href="/">
            Superfact
          </Link>
          <nav className="flex gap-4 text-sm">
            {LINKS.map(({ to, label }) => (
              <Link
                className={
                  pathname === to
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }
                href={to}
                key={to}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <a className="text-muted-foreground text-sm hover:text-foreground" href="/api/export">
            Export JSON
          </a>
          <ModeToggle />
        </div>
      </div>
      <hr />
    </div>
  );
}
