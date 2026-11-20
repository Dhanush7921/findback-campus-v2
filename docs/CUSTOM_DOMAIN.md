# Custom domain

## Frontend (GitHub Pages)
1. DNS: `CNAME lostfound → dhanush7921.github.io`.
2. Repo variables: `CUSTOM_DOMAIN=lostfound.example.edu`, `VITE_BASE=/`.
3. Settings → Pages → Custom domain → **Enforce HTTPS**. Re-run *Deploy frontend*.
4. Firebase console → Authentication → Settings → Authorised domains → add the domain.
5. Re-run `EXTRA_ORIGINS=https://lostfound.example.edu npm run deploy:gcp` so the API allows the new origin.

## API (optional)
Cloud Run → `findback-v2-api` → *Manage custom domains* (or a load balancer). Then set `VITE_API_BASE` to the new URL.
