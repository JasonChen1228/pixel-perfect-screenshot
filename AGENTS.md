<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- This is a plain Vite + React Router SPA (no SSR). Routes are declared in `src/router.tsx`; pages live in `src/pages/`.
- Signed-in pages are nested under the `<RequireAuth />` route in `src/router.tsx` (client-only gate redirecting to `/signin`) — keeps auth checks in one place.
- Use only the built-in auth users; no custom tables until a later milestone asks for them — keeps v1 scope minimal and the backend portable.
