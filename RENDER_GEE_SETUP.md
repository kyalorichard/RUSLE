# RUSLE on Render: Earth Engine authentication and port fix

## 1. Replace these files in the repository

- `run.py`
- `app/main.py`
- `app/services/gee_service.py`

These changes preserve the existing RUSLE factor calculations and GEE data
loading functions. They replace interactive `ee.Authenticate()` with
service-account authentication and make the server use Render's `PORT`.

## 2. Create a Google Earth Engine service account

Use a Google Cloud project that is registered for Earth Engine. Create a
service account, grant it access to Earth Engine as required by your project,
and create a JSON key. Do not commit the JSON key to GitHub or put it in a
public repository.

## 3. Add a Render Secret File

In the Render Web Service dashboard, open **Environment** and add a Secret
File with:

- Filename: `gee-service-account.json`
- Contents: the complete downloaded service-account JSON key

Render Secret Files are mounted under `/etc/secrets/`. Set this environment
variable in the same service:

- `RUSLE_GEE_CREDENTIALS_PATH=/etc/secrets/gee-service-account.json`

Also set:

- `RUSLE_GEE_PROJECT=YOUR_REGISTERED_EE_CLOUD_PROJECT_ID`

Optional:

- `RUSLE_GEE_SERVICE_ACCOUNT=service-account-name@project-id.iam.gserviceaccount.com`

The email can be read from the JSON automatically, so the optional variable
is normally unnecessary.

## 4. Render service settings

- Service type: Web Service
- Runtime: Docker
- Dockerfile: `./Dockerfile`
- Docker context/root directory: repository directory containing `Dockerfile`
- Start Command: leave blank when Dockerfile has `CMD ["python", "run.py"]`
- Health Check Path: `/health`

Do not configure a second Uvicorn start command. `run.py` reads the `PORT`
environment variable supplied by Render and defaults to 10000 for local use.

## 5. Verify after deploy

Open `https://YOUR-SERVICE.onrender.com/health`. Expected when credentials
and project access are correct:

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "gee_initialized": true,
  "gee_status": "ready"
}
```

If `gee_initialized` is false, inspect the Render runtime logs. Common causes:

- `GEE credentials file was not found`: wrong Secret File filename/path.
- `service-account JSON is not valid`: malformed or incomplete key contents.
- permission / 403 / not registered errors: service account lacks access, or
  the Cloud project is not registered/enabled for Earth Engine.
- quota or billing errors: review the Earth Engine Cloud project configuration.

Never share the service-account private key in chat or commit it to Git.
