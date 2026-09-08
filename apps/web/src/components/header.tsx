"use client";

import { cn } from "@superfact/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ModeToggle } from "./mode-toggle";

const LINKS = [
  { to: "/", label: "Documents" },
  { to: "/cases", label: "Cases" },
] as const;

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="border-border border-b">
      <div className="mx-auto flex max-w-350 items-center justify-between gap-6 px-4 py-2.5">
        <div className="flex items-center gap-6">
          <Link className="font-medium text-sm tracking-tight" href="/">
            Superfact
          </Link>
          <nav className="flex gap-4 text-sm">
            {LINKS.map(({ to, label }) => {
              const here = to === "/" ? pathname === "/" : pathname.startsWith(to);
              return (
                <Link
                  className={cn(
                    "transition-colors",
                    here ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  href={to}
                  key={to}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <a
            className="text-muted-foreground text-sm transition-colors hover:text-foreground"
            href="/api/export"
          >
            Download JSON
          </a>
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}
