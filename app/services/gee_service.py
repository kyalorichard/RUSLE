"""Google Earth Engine authentication and data-access service.

Render/cloud deployments should use a service-account key supplied through
Render Secret Files. This module deliberately never calls ee.Authenticate(),
which requires an interactive flow and may invoke the gcloud CLI.
"""

import json
import logging
import os
from pathlib import Path
from typing import Optional

import ee

logger = logging.getLogger(__name__)
_gee_initialized = False


def _get_service_account_credentials():
    """Create EE credentials from a JSON secret or mounted key file.

    Supported configuration:
      RUSLE_GEE_SERVICE_ACCOUNT_JSON  Full service-account JSON as a secret.
      RUSLE_GEE_CREDENTIALS_PATH      Path to mounted service-account JSON.
      GOOGLE_APPLICATION_CREDENTIALS Standard Google key-file fallback.
      RUSLE_GEE_SERVICE_ACCOUNT       Optional explicit service-account email.
    """
    json_secret = os.getenv("RUSLE_GEE_SERVICE_ACCOUNT_JSON")
    key_path_value = (
        os.getenv("RUSLE_GEE_CREDENTIALS_PATH")
        or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    )
    email_override = os.getenv("RUSLE_GEE_SERVICE_ACCOUNT")

    if json_secret:
        try:
            info = json.loads(json_secret)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "RUSLE_GEE_SERVICE_ACCOUNT_JSON is not valid JSON. "
                "Paste the complete service-account JSON key."
            ) from exc

        email = email_override or info.get("client_email")
        if not email or not info.get("private_key"):
            raise RuntimeError(
                "The service-account JSON must contain client_email and private_key."
            )
        return ee.ServiceAccountCredentials(email, key_data=json_secret)

    if key_path_value:
        key_path = Path(key_path_value).expanduser()
        if not key_path.is_file():
            raise RuntimeError(
                f"GEE credentials file was not found at {key_path}. "
                "Check the Render Secret File filename and path."
            )
        try:
            with key_path.open("r", encoding="utf-8") as key_file:
                info = json.load(key_file)
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(
                f"Could not read valid service-account JSON from {key_path}."
            ) from exc

        email = email_override or info.get("client_email")
        if not email:
            raise RuntimeError(
                "The service-account JSON has no client_email field."
            )
        return ee.ServiceAccountCredentials(email, key_file=str(key_path))

    return None


def initialize_earth_engine(project_id: Optional[str] = None, force: bool = False) -> bool:
    """Initialize and verify Earth Engine using non-interactive credentials."""
    global _gee_initialized

    if _gee_initialized and not force:
        return True

    project_id = project_id or os.getenv("RUSLE_GEE_PROJECT") or "icarda-dashboard"

    try:
        credentials = _get_service_account_credentials()
        if credentials is None:
            raise RuntimeError(
                "No Earth Engine service-account credentials were configured. "
                "On Render, add a Secret File containing the service-account JSON "
                "and set RUSLE_GEE_CREDENTIALS_PATH to its /etc/secrets/... path."
            )

        ee.Initialize(credentials=credentials, project=project_id)

        # Force a small server-side request to verify authentication, project
        # registration, and access rather than merely checking local setup.
        ee.Number(1).getInfo()

        _gee_initialized = True
        logger.info("Google Earth Engine initialized and verified (project=%s).", project_id)
        return True

    except Exception:
        _gee_initialized = False
        logger.exception(
            "Google Earth Engine initialization failed (project=%s).", project_id
        )
        raise


def is_gee_initialized() -> bool:
    """Return the process-local Earth Engine initialization state."""
    return _gee_initialized


def load_precipitation_data(aoi: ee.Geometry) -> ee.ImageCollection:
    return (
        ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
        .select("precipitation")
        .filterBounds(aoi)
    )


def load_soil_data(aoi: ee.Geometry) -> tuple:
    organic_carbon = (
        ee.Image("OpenLandMap/SOL/SOL_ORGANIC-CARBON_USDA-6A1C_M/v02")
        .select("b0").unmask(1.5).clip(aoi)
    )
    clay = (
        ee.Image("OpenLandMap/SOL/SOL_CLAY-WFRACTION_USDA-3A1A1A_M/v02")
        .select("b0").unmask(20).clip(aoi)
    )
    sand = (
        ee.Image("OpenLandMap/SOL/SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02")
        .select("b0").unmask(40).clip(aoi)
    )
    silt = ee.Image(100).subtract(clay).subtract(sand).rename("silt").clip(aoi)
    return organic_carbon, clay, sand, silt


def load_dem(source: str = "SRTM") -> ee.Image:
    if source.upper() == "SRTM":
        return ee.Image("USGS/SRTMGL1_003").select("elevation")
    if source.upper() == "MERIT":
        return ee.Image("MERIT/DEM/v1_0_3").select("dem")
    raise ValueError(f"Unknown DEM source: {source}")


def load_landsat8() -> ee.ImageCollection:
    def apply_scale_factors(image):
        optical = image.select("SR_B.").multiply(0.0000275).add(-0.2)
        thermal = image.select("ST_B.*").multiply(0.00341802).add(149.0)
        return image.addBands(optical, None, True).addBands(thermal, None, True)

    return ee.ImageCollection("LANDSAT/LC08/C02/T1_L2").map(apply_scale_factors)


def load_modis_landcover(aoi: ee.Geometry) -> ee.Image:
    return (
        ee.ImageCollection("MODIS/061/MCD12Q1")
        .select("LC_Type1")
        .sort("system:time_start", False)
        .first()
        .clip(aoi)
    )


def load_area_from_gaul(region_name: str, admin_level: int = 1) -> ee.FeatureCollection:
    if admin_level not in (0, 1, 2):
        raise ValueError(f"admin_level must be 0, 1, or 2, got {admin_level}")
    collection_id = f"FAO/GAUL/2015/level{admin_level}"
    field_name = f"ADM{admin_level}_NAME"
    logger.info(
        "Querying %s with %s containing '%s'", collection_id, field_name, region_name
    )
    return ee.FeatureCollection(collection_id).filter(
        ee.Filter.stringContains(field_name, region_name)
    )
