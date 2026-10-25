import { Link } from "@tanstack/react-router";
import { Plane } from "lucide-react";

export function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-glow">
        <Plane className="h-4 w-4" />
      </span>
      Flight Price Notifier
    </Link>
  );
}
