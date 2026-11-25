# RUSLE basemap fix (no CARTO API key required)

This patch fixes the CARTO "API KEY REQUIRED" message in both map viewers by
using OpenStreetMap as the default basemap.

## Files to replace

Copy these two files into the root of the RUSLE application repository,
preserving their directory structure:

- `app/static/js/app.js`
- `app/routers/visualize.py`

The patch removes CARTO from the main Leaflet basemap selector, makes
OpenStreetMap the default, retains Esri Satellite as an alternative, and
changes the Folium results viewer to OpenStreetMap.

## Deploy

From the repository root:

```powershell
git add app/static/js/app.js app/routers/visualize.py
git commit -m "Replace CARTO basemaps with OpenStreetMap"
git push origin main
```

Then trigger a Render deployment. After deployment, perform a hard refresh
in the browser (Ctrl+F5) so the browser does not keep the old JavaScript.

No CARTO API key or Render environment variable is required for this fix.

Note: OpenStreetMap tiles require attribution and are subject to the
OpenStreetMap tile usage policy. For high-volume production traffic, use a
dedicated tile provider or self-hosted tile infrastructure.
