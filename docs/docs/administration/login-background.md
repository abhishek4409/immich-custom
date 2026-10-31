# Login background

The login page can show your own photo behind the login form. The photos are read from a folder on your server, so you can change them without rebuilding anything.

:::caution
Anyone who can reach your login page can see and download these photos. Do not use private photos, and keep the folder outside your upload location.
:::

## Setup

1. Create a folder next to your `docker-compose.yml` with these four files. All four are required, and the names must match exactly:

   ```
   login-background/
     landscape-1920.webp
     landscape-2560.webp
     landscape-3840.webp
     portrait-1080.webp
   ```

   The number is the width of the photo in pixels. Browsers pick the best size for the screen, and portrait screens use the portrait photo.

2. Mount the folder in the `immich-server` service:

   ```yaml
   services:
     immich-server:
       volumes:
         - ./login-background:/build/www/login-background:ro
   ```

3. Recreate the container:

   ```bash
   docker compose up -d immich-server
   ```

## Changing the photos

Replace the files, keeping the same names, then restart the server. The server only reads the list of files when it starts.

```bash
docker compose restart immich-server
```

Browsers may keep showing the old photo for a while, so refresh the page without the cache if you do not see the new one.

## Choosing a photo

- Keep the main subject in the upper left. The form covers the right side on large screens and the bottom on phones.
- Aim for 300-800 KB per file, because the photo loads before anyone signs in.

If a file is missing, the login page shows the default colorful background instead.
