// ============================================================
// CLOUD-BASED RUSLE SOIL EROSION ASSESSMENT
// Countries: Uzbekistan, Tajikistan, Syria
// Platform: Google Earth Engine
// Model: A = R * K * LS * C * P
// Period for rainfall erosivity: 1994–2023
// ============================================================

// ============================================================
// 1. USER SETTINGS
// ============================================================

var startYear = 1994;
var endYear = 2023;
var nYears = endYear - startYear + 1;

var startDate = ee.Date.fromYMD(startYear, 1, 1);
var endDate = ee.Date.fromYMD(endYear, 12, 31);

var exportScale = 250;

// ============================================================
// 2. STUDY AREA
// ============================================================

var countries = ee.FeatureCollection("FAO/GAUL/2015/level0");

var studyArea = countries.filter(
  ee.Filter.inList("ADM0_NAME", [
    "Uzbekistan",
    "Tajikistan",
    "Syrian Arab Republic",
  ]),
);

Map.centerObject(studyArea, 5);
Map.addLayer(studyArea, {}, "Study Area");

// ============================================================
// 3. R-FACTOR: RAINFALL EROSIVITY
// Dataset: CHIRPS Daily
// Source: UC Santa Barbara Climate Hazards Group
// Resolution: ~5.5 km
// Period: 1994–2023
// Formula: R = 0.562 * P - 8.12
// ============================================================

var chirps = ee
  .ImageCollection("UCSB-CHG/CHIRPS/DAILY")
  .filterDate(startDate, endDate)
  .filterBounds(studyArea)
  .select("precipitation");

var meanAnnualRainfall = chirps
  .sum()
  .divide(nYears)
  .clip(studyArea)
  .rename("Mean_Annual_Rainfall_mm");

var R = meanAnnualRainfall
  .multiply(0.562)
  .subtract(8.12)
  .max(0)
  .rename("R_Factor");

Map.addLayer(
  R,
  {
    min: 0,
    max: 500,
    palette: ["white", "cyan", "blue", "purple"],
  },
  "R Factor",
);

// ============================================================
// 4. K-FACTOR: SOIL ERODIBILITY
// Dataset: OpenLandMap Soil
// Source: OpenGeoHub
// Resolution: 250 m
// Inputs: clay, sand, soil organic carbon
// ============================================================

var clay = ee
  .Image("OpenLandMap/SOL/SOL_CLAY-WFRACTION_USDA-3A1A1A_M/v02")
  .select("b0")
  .clip(studyArea);

var sand = ee
  .Image("OpenLandMap/SOL/SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02")
  .select("b0")
  .clip(studyArea);

var soc = ee
  .Image("OpenLandMap/SOL/SOL_ORGANIC-CARBON_USDA-6A1C_M/v02")
  .select("b0")
  .clip(studyArea);

// Convert soil fractions where necessary.
// OpenLandMap values are usually stored as mass fractions or scaled values.
// This script keeps the common 0–100 percentage assumption.
// Adjust scaling if your inspection shows otherwise.

var silt = ee.Image(100).subtract(clay).subtract(sand).max(0).rename("Silt");

// Simplified EPIC/Wischmeier-style K approximation.
// K values are clamped to avoid unrealistic extremes.
var K = ee
  .Image()
  .expression(
    "0.1317 * (" +
      "0.2 + 0.3 * exp(-0.0256 * sand * (1 - silt / 100))" +
      ") * " +
      "pow((silt / (clay + silt)), 0.3) * " +
      "(1 - (0.25 * soc / (soc + exp(3.72 - 2.95 * soc)))) * " +
      "(1 - (0.7 * (1 - sand / 100) / ((1 - sand / 100) + exp(-5.51 + 22.9 * (1 - sand / 100)))))",
    {
      sand: sand,
      clay: clay,
      silt: silt,
      soc: soc,
    },
  )
  .rename("K_Factor")
  .clamp(0.01, 0.08)
  .clip(studyArea);

Map.addLayer(
  K,
  {
    min: 0.01,
    max: 0.08,
    palette: ["green", "yellow", "orange", "red"],
  },
  "K Factor",
);

// ============================================================
// 5. LS-FACTOR: SLOPE LENGTH AND STEEPNESS
// Datasets: SRTM DEM + HydroSHEDS Flow Accumulation
// Source: USGS / WWF
// Resolution: 30 m / HydroSHEDS derived
// Formula: Moore and Burch-style LS approximation
// ============================================================

var dem = ee.Image("USGS/SRTMGL1_003").select("elevation").clip(studyArea);

var slopeDegrees = ee.Terrain.slope(dem)
  .clip(studyArea)
  .rename("Slope_Degrees");

var slopeRadians = slopeDegrees
  .multiply(Math.PI)
  .divide(180)
  .rename("Slope_Radians");

var slopePercent = slopeRadians.tan().multiply(100).rename("Slope_Percent");

// HydroSHEDS flow accumulation
var flowAccum = ee
  .Image("WWF/HydroSHEDS/15ACC")
  .clip(studyArea)
  .rename("Flow_Accumulation");

// LS = ((FlowAccum * cellsize) / 22.13)^0.4 * (sin(slope) / 0.0896)^1.3
var LS = flowAccum
  .multiply(30)
  .divide(22.13)
  .pow(0.4)
  .multiply(slopeRadians.sin().divide(0.0896).pow(1.3))
  .rename("LS_Factor")
  .clamp(0, 50)
  .clip(studyArea);

Map.addLayer(
  slopePercent,
  {
    min: 0,
    max: 60,
    palette: ["white", "yellow", "orange", "red", "brown"],
  },
  "Slope Percent",
);

Map.addLayer(
  LS,
  {
    min: 0,
    max: 30,
    palette: ["white", "yellow", "orange", "red", "brown"],
  },
  "LS Factor",
);

// ============================================================
// 6. C-FACTOR: COVER MANAGEMENT
// Dataset: MODIS MCD12Q1 Land Cover
// Source: NASA
// Resolution: 500 m
// Classification: IGBP LC_Type1
// ============================================================

var landCover = ee
  .ImageCollection("MODIS/061/MCD12Q1")
  .filterDate("2020-01-01", "2020-12-31")
  .first()
  .select("LC_Type1")
  .clip(studyArea);

// IGBP classes:
// 1 Evergreen Needleleaf Forest
// 2 Evergreen Broadleaf Forest
// 3 Deciduous Needleleaf Forest
// 4 Deciduous Broadleaf Forest
// 5 Mixed Forest
// 6 Closed Shrublands
// 7 Open Shrublands
// 8 Woody Savannas
// 9 Savannas
// 10 Grasslands
// 11 Permanent Wetlands
// 12 Croplands
// 13 Urban and Built-up
// 14 Cropland/Natural Vegetation Mosaic
// 15 Snow and Ice
// 16 Barren or Sparsely Vegetated
// 17 Water

var C = landCover
  .remap(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
    [
      0.001, 0.001, 0.002, 0.003, 0.005, 0.05, 0.08, 0.08, 0.1, 0.12, 0.05,
      0.25, 0.3, 0.2, 0.01, 1.0, 0.0,
    ],
  )
  .rename("C_Factor")
  .clip(studyArea);

Map.addLayer(landCover, {}, "MODIS Land Cover 2020");

Map.addLayer(
  C,
  {
    min: 0,
    max: 1,
    palette: ["green", "yellow", "orange", "red"],
  },
  "C Factor",
);

// ============================================================
// 7. P-FACTOR: CONSERVATION PRACTICE FACTOR
// Derived from slope classes.
// Applied mainly to cropland areas.
// Non-cropland areas are assigned P = 1.
// ============================================================

var croplandMask = landCover.eq(12).or(landCover.eq(14));

var pCropland = slopePercent
  .expression(
    "(s < 5) ? 0.10" +
      ": (s < 10) ? 0.12" +
      ": (s < 20) ? 0.14" +
      ": (s < 30) ? 0.19" +
      ": (s < 50) ? 0.25" +
      ": 0.33",
    {
      s: slopePercent,
    },
  )
  .rename("P_Cropland");

var P = ee
  .Image(1)
  .where(croplandMask, pCropland)
  .rename("P_Factor")
  .clip(studyArea);

Map.addLayer(
  P,
  {
    min: 0.1,
    max: 1,
    palette: ["green", "yellow", "red"],
  },
  "P Factor",
);

// ============================================================
// 8. RUSLE SOIL LOSS
// A = R * K * LS * C * P
// Units: tonnes per hectare per year
// ============================================================

var soilLoss = R.multiply(K)
  .multiply(LS)
  .multiply(C)
  .multiply(P)
  .rename("Soil_Loss_t_ha_yr")
  .clip(studyArea);

Map.addLayer(
  soilLoss,
  {
    min: 0,
    max: 50,
    palette: ["#1a9850", "#91cf60", "#ffffbf", "#fc8d59", "#d73027", "#7f0000"],
  },
  "Annual Soil Loss t/ha/yr",
);

// ============================================================
// 9. EROSION SEVERITY CLASSIFICATION
// 1 = Very Low: 0–5
// 2 = Low: 5–10
// 3 = Moderate: 10–20
// 4 = High: 20–50
// 5 = Very High: >50
// ============================================================

var erosionClass = soilLoss
  .expression(
    "(sl <= 5) ? 1" +
      ": (sl <= 10) ? 2" +
      ": (sl <= 20) ? 3" +
      ": (sl <= 50) ? 4" +
      ": 5",
    {
      sl: soilLoss,
    },
  )
  .rename("Erosion_Class")
  .clip(studyArea);

Map.addLayer(
  erosionClass,
  {
    min: 1,
    max: 5,
    palette: ["#1a9850", "#91cf60", "#ffffbf", "#fc8d59", "#d73027"],
  },
  "Erosion Severity Class",
);

// ============================================================
// 10. AREA STATISTICS BY EROSION CLASS
// ============================================================

var pixelAreaHa = ee.Image.pixelArea().divide(10000).rename("Area_ha");

var areaByClass = pixelAreaHa.addBands(erosionClass).reduceRegion({
  reducer: ee.Reducer.sum().group({
    groupField: 1,
    groupName: "Erosion_Class",
  }),
  geometry: studyArea.geometry(),
  scale: exportScale,
  maxPixels: 1e13,
});

print("Area by erosion class, hectares:", areaByClass);

// ============================================================
// 11. COUNTRY-LEVEL STATISTICS
// ============================================================

var countryStats = soilLoss.reduceRegions({
  collection: studyArea,
  reducer: ee.Reducer.mean()
    .combine({
      reducer2: ee.Reducer.median(),
      sharedInputs: true,
    })
    .combine({
      reducer2: ee.Reducer.min(),
      sharedInputs: true,
    })
    .combine({
      reducer2: ee.Reducer.max(),
      sharedInputs: true,
    }),
  scale: exportScale,
  tileScale: 4,
});

print("Country-level soil loss statistics:", countryStats);

// ============================================================
// 12. COUNTRY-LEVEL AREA BY EROSION CLASS
// ============================================================

var classAreaImage = pixelAreaHa.addBands(erosionClass);

var countryClassStats = classAreaImage.reduceRegions({
  collection: studyArea,
  reducer: ee.Reducer.sum().group({
    groupField: 1,
    groupName: "Erosion_Class",
  }),
  scale: exportScale,
  tileScale: 4,
});

print("Country-level area by erosion class:", countryClassStats);

// ============================================================
// 13. MAP LEGEND
// ============================================================

var legend = ui.Panel({
  style: {
    position: "bottom-left",
    padding: "8px 15px",
  },
});

legend.add(
  ui.Label({
    value: "RUSLE Erosion Severity",
    style: {
      fontWeight: "bold",
      fontSize: "14px",
      margin: "0 0 6px 0",
    },
  }),
);

var makeLegendRow = function (color, name) {
  var colorBox = ui.Label({
    style: {
      backgroundColor: color,
      padding: "8px",
      margin: "0 0 4px 0",
    },
  });

  var description = ui.Label({
    value: name,
    style: {
      margin: "0 0 4px 6px",
    },
  });

  return ui.Panel({
    widgets: [colorBox, description],
    layout: ui.Panel.Layout.Flow("horizontal"),
  });
};

legend.add(makeLegendRow("#1a9850", "Very Low: 0–5 t/ha/yr"));
legend.add(makeLegendRow("#91cf60", "Low: 5–10 t/ha/yr"));
legend.add(makeLegendRow("#ffffbf", "Moderate: 10–20 t/ha/yr"));
legend.add(makeLegendRow("#fc8d59", "High: 20–50 t/ha/yr"));
legend.add(makeLegendRow("#d73027", "Very High: >50 t/ha/yr"));

Map.add(legend);

// ============================================================
// 14. EXPORT RASTER OUTPUTS TO GOOGLE DRIVE
// ============================================================

Export.image.toDrive({
  image: soilLoss,
  description: "RUSLE_Soil_Loss_Uzbekistan_Tajikistan_Syria_1994_2023",
  folder: "GEE_RUSLE",
  fileNamePrefix: "rusle_soil_loss_uzbekistan_tajikistan_syria_1994_2023",
  region: studyArea.geometry(),
  scale: exportScale,
  maxPixels: 1e13,
});

Export.image.toDrive({
  image: erosionClass,
  description: "RUSLE_Erosion_Class_Uzbekistan_Tajikistan_Syria_1994_2023",
  folder: "GEE_RUSLE",
  fileNamePrefix: "rusle_erosion_class_uzbekistan_tajikistan_syria_1994_2023",
  region: studyArea.geometry(),
  scale: exportScale,
  maxPixels: 1e13,
});

Export.image.toDrive({
  image: R,
  description: "R_Factor_Uzbekistan_Tajikistan_Syria",
  folder: "GEE_RUSLE",
  fileNamePrefix: "r_factor_uzbekistan_tajikistan_syria",
  region: studyArea.geometry(),
  scale: exportScale,
  maxPixels: 1e13,
});

Export.image.toDrive({
  image: K,
  description: "K_Factor_Uzbekistan_Tajikistan_Syria",
  folder: "GEE_RUSLE",
  fileNamePrefix: "k_factor_uzbekistan_tajikistan_syria",
  region: studyArea.geometry(),
  scale: exportScale,
  maxPixels: 1e13,
});

Export.image.toDrive({
  image: LS,
  description: "LS_Factor_Uzbekistan_Tajikistan_Syria",
  folder: "GEE_RUSLE",
  fileNamePrefix: "ls_factor_uzbekistan_tajikistan_syria",
  region: studyArea.geometry(),
  scale: exportScale,
  maxPixels: 1e13,
});

Export.image.toDrive({
  image: C,
  description: "C_Factor_Uzbekistan_Tajikistan_Syria",
  folder: "GEE_RUSLE",
  fileNamePrefix: "c_factor_uzbekistan_tajikistan_syria",
  region: studyArea.geometry(),
  scale: exportScale,
  maxPixels: 1e13,
});

Export.image.toDrive({
  image: P,
  description: "P_Factor_Uzbekistan_Tajikistan_Syria",
  folder: "GEE_RUSLE",
  fileNamePrefix: "p_factor_uzbekistan_tajikistan_syria",
  region: studyArea.geometry(),
  scale: exportScale,
  maxPixels: 1e13,
});

// ============================================================
// 15. EXPORT TABLE OUTPUTS TO GOOGLE DRIVE
// ============================================================

Export.table.toDrive({
  collection: countryStats,
  description: "RUSLE_Country_Statistics_Uzbekistan_Tajikistan_Syria",
  folder: "GEE_RUSLE",
  fileNamePrefix: "rusle_country_statistics_uzbekistan_tajikistan_syria",
  fileFormat: "CSV",
});

Export.table.toDrive({
  collection: countryClassStats,
  description:
    "RUSLE_Country_Area_By_Erosion_Class_Uzbekistan_Tajikistan_Syria",
  folder: "GEE_RUSLE",
  fileNamePrefix:
    "rusle_country_area_by_erosion_class_uzbekistan_tajikistan_syria",
  fileFormat: "CSV",
});

// ============================================================
// 16. PRINT BASIC CHECKS
// ============================================================

print("Study Area:", studyArea);
print("Mean Annual Rainfall:", meanAnnualRainfall);
print("R Factor:", R);
print("K Factor:", K);
print("LS Factor:", LS);
print("C Factor:", C);
print("P Factor:", P);
print("Soil Loss:", soilLoss);
print("Erosion Class:", erosionClass);
L;
