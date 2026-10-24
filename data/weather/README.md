# Cached Long Island weather

HeatHunter uses eight checked-in cold-weather nights so simulation and judging
never depend on a live weather service. The files are direct hourly observations
from NOAA NCEI's Global Hourly dataset at Islip Long Island MacArthur Airport
(KISP), approximately 14 km from Stony Brook.

## Source and normalization

- Provider: NOAA National Centers for Environmental Information (NCEI)
- Dataset: Global Hourly
- Station: `72505004781` / KISP
- Coordinates: 40.79389, -73.10181
- Source time basis: UTC
- Local timezone: America/New_York
- Temperature: NOAA `TMP`, tenths of °C converted to °C
- Wind: NOAA `WND`, tenths of m/s converted to m/s
- Reports: routine `FM-15` observations only
- Quality: flags 0, 1, 4 and 5 retained; missing/suspect/error flags excluded
- Missing values: no interpolation or imputation

Each night spans 00:00–10:59 UTC, corresponding to the prior evening through
early morning in EST. Original observation timestamps (normally at minute 56)
are preserved. Both the training and held-out split contain calm and windy
nights. The split was fixed before use in model evaluation.

## Regeneration

From the repository root, use either the live NOAA endpoint:

```bash
python -m backend.data_pipeline.acquire_noaa_weather
```

or a previously downloaded response:

```bash
python -m backend.data_pipeline.acquire_noaa_weather \
  --raw-input /path/to/noaa-global-hourly.json
```

The simulator-facing reader is intentionally offline-only:

```python
from backend.data_pipeline import list_weather_nights, load_weather_night

training = list_weather_nights(split="training")
night = load_weather_night(training[0]["night_id"])
```

The acquisition URL and per-series provenance are stored in every cache file.
