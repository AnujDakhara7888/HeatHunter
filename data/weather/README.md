# Offline weather caches

## Fault Lab default: SMETER HH09-region weather

`data/weather/hh09/` is the default weather catalog returned by
`list_weather_nights()`. It contains eight real cold-weather nights measured by
the SMETER Phase 2 central weather station, documented as 5.2 km by direct path
from HH09. These observations therefore match the region and source used for the
HH09 approximate digital twin.

The official dataset is UK Data Service SN 856978, DOI
`https://doi.org/10.5255/UKDA-SN-856978`. Each night spans 18:00 through 06:00
local time, inclusive, with 25 half-hour observations. The published README says
weather values are 30-minute means of 10-minute measurements. It does not state
the timezone, so HeatHunter records the explicit assumption `Europe/London`.
Every chosen night occurs in GMT, making its UTC conversion unambiguous.

Wind direction is preserved under `data/weather/hh09/wind_direction/`. It is a
companion series because the frozen public `WeatherNight` API currently includes
temperature and wind speed but not direction. The source publishes no weather
quality-flag columns; selected series have zero missing values and use no
interpolation or imputation. Exact station coordinates are not published and are
therefore not invented.

The fixed split has four training nights from 2019-2020 and four held-out nights
from 2021. Each split contains two calm and two windy nights. Selection rules and
summary values are stored in `data/weather/hh09/index.json`.

Regenerate the cache and twin package offline from the official archive:

```bash
python -m backend.data_pipeline.build_hh09_twin \
  /path/to/856978_data_and_documentation.zip
```

The command validates archive SHA-256
`c1838e55daf2b05949d02079ca17563e083924cf94f0e0802cf83756b1d6a77c`.

## Historical resource: NOAA Long Island weather

The eight `kisp-*.json` files at the root of this directory and the root
`index.json` are preserved historical NOAA Global Hourly observations from Islip
Long Island MacArthur Airport. They are no longer listed by the default reader
and must not be used for HH09 twin scenarios. Explicit compatibility loading is
still supported, for example `load_weather_night("kisp-2025-01-07")`.

## Reader API

```python
from backend.data_pipeline import (
    list_weather_nights,
    load_weather_night,
    load_weather_wind_direction,
)

training = list_weather_nights(split="training")
night = load_weather_night(training[0]["night_id"])
direction = load_weather_wind_direction(training[0]["night_id"])
```

All readers are offline-only and never fall back to a network request.
