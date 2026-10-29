# Hedera Creator Kit Docs

Documentation for the SLIME toolkit on Hedera — starting with the HCS-backed domain registry.

## Getting started

```bash
cd docs-site
npm install
npm run dev      # local preview at http://localhost:5173
npm run build    # static output in .vitepress/dist
```

The site is deployed to GitHub Pages automatically on every push to `main`
that touches `docs-site/` (see `.github/workflows/docs.yml`).

## Structure

- `guide/` — how the domain registry works (architecture, flows, pricing, admin)
- `api/` — REST API reference for the domain endpoints
