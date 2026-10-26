import { createBrowserRouter, Navigate, type RouteObject } from "react-router";

import { RootLayout, RootErrorBoundary, NotFound } from "@/components/RootLayout";
import { RequireAuth } from "@/components/RequireAuth";
import Index from "@/pages/Index";
import SignIn from "@/pages/SignIn";
import SignUp from "@/pages/SignUp";
import Dashboard from "@/pages/Dashboard";

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RootErrorBoundary />,
    children: [
      { path: "/", element: <Index /> },
      { path: "/signin", element: <SignIn /> },
      { path: "/signup", element: <SignUp /> },
      // Hyphenated aliases so either spelling of the auth URLs works.
      { path: "/sign-in", element: <Navigate to="/signin" replace /> },
      { path: "/sign-up", element: <Navigate to="/signup" replace /> },
      {
        // Signed-in pages: client-side gate that redirects to /signin.
        element: <RequireAuth />,
        children: [{ path: "/app", element: <Dashboard /> }],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
