import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () => getUser(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

// IntersectionObserver isn't in jsdom; the landing page's Reveal uses it.
class IO {
  observe() {}
  disconnect() {}
}
Object.defineProperty(window, "IntersectionObserver", { writable: true, value: IO });

const { routes } = await import("@/router");

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("App rendering", () => {
  beforeEach(() => getUser.mockReset());

  it("renders the landing page at /", async () => {
    renderAt("/");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Flight Price Notifier" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Flight Price Notifier — 機票降價通知");
  });

  it("renders the sign-in form at /signin", async () => {
    renderAt("/signin");
    expect(await screen.findByRole("heading", { name: "Sign in / 登入" })).toBeInTheDocument();
  });

  it("redirects signed-out visitors from /app to /signin", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const router = renderAt("/app");
    expect(await screen.findByRole("heading", { name: "Sign in / 登入" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/signin");
  });

  it("shows the dashboard at /app for a signed-in user", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.co" } } });
    renderAt("/app");
    expect(await screen.findByRole("heading", { name: "Hi a@b.co" })).toBeInTheDocument();
  });

  it("shows the 404 page for unknown paths", async () => {
    renderAt("/nope");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
