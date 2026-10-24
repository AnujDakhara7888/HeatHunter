# HH09 approximate digital-twin inputs

## Purpose and boundary

`data/processed/hh09_twin_inputs.json` is the shared data handoff for Kailash's
thermal model and Mihir's scenario generator. It makes the Fault Lab resemble
the same HH09 bungalow shown in Real Homes while keeping the two data paths
scientifically separate:

- `smeter_hh09.json`: actual indoor and outdoor observations, with no faults.
- `hh09_twin_inputs.json`: documented geometry plus explicit assumptions.
- Simulated scenarios: future outputs generated from the twin, never written
  into the real-house file.

This is an approximate digital twin, not an exact reconstruction.

## Four-room mapping

The simulator retains its existing IDs for compatibility. `living_room` maps to
HH09 Living Room, `kitchen` to Kitchen, `bedroom_1` to the sole Bedroom, and the
old `bedroom_2` slot maps to HH09 Hall. UI and reports must label that final slot
“Hall.” The measured Bathroom remains available only in the real-house payload
because HH09 has five observed rooms and the simulator has four slots.

The floor-plan areas, plan lengths, plan widths, window dimensions, ground-floor
placement, and shared-boundary adjacency come from published SMETER documents.
The 2.4 m ceiling height is a HeatHunter assumption. Derived volumes—31.416,
13.800, 28.296, and 6.528 m³—are therefore also assumptions. Every geometry
field carries `documented` or `assumed` status and a source reference.

## Weather

The default reader uses the SMETER Phase 2 central weather station, documented
as 5.2 km from HH09. Selected local-night start dates are:

| Split | Calm | Windy |
|---|---|---|
| Training | 2019-12-01, 2020-12-06 | 2020-01-28, 2020-02-10 |
| Held out | 2021-01-06, 2021-01-08 | 2021-02-06, 2021-02-12 |

Calm means nightly mean wind ≤2 m/s; windy means ≥4 m/s; all selected nights
have mean temperature ≤7°C. A night contains 25 points from 18:00 through 06:00
inclusive at 30-minute spacing. All dates are in GMT. `Europe/London` is an
explicit assumption because the source README does not declare a timezone.

No selected temperature, wind-speed, or wind-direction value is missing. No
imputation is used. Wind direction is kept in companion files because the frozen
`WeatherNight` contract has no wind-direction member. Exact station coordinates
are unpublished and are not approximated.

Historical NOAA/KISP files remain in `data/weather/` for reproducibility but are
not part of the default catalog and must not drive HH09 scenarios.

## Measured references and unknowns

The package preserves the measured whole-building co-heating HTC of 172 W/K,
blower-door result of 22.03 h⁻¹ at 50 Pa, and air permeability of 14.93
m³/(h·m²) at 50 Pa. Each is labeled `reference_only`. They are not per-room
conductances, a natural infiltration rate, or a room leakage distribution.

Unknown simulation parameters remain explicitly unknown: thermal capacitance,
fabric conductance, room leakage shares, natural infiltration, wind sensitivity,
and inter-room coupling coefficients. Kailash may estimate nominal parameters
from training data, but they must use `MODEL_ESTIMATE` or `ASSUMPTION`, never
`REAL_MEASUREMENT`.

## Consumer API and compatibility

```python
from backend.data_pipeline import (
    list_weather_nights,
    load_hh09_twin_inputs,
    load_real_house,
    load_weather_night,
    load_weather_wind_direction,
)
```

- `load_hh09_twin_inputs(path=None) -> dict` gives Kailash and Mihir the mapping,
  documented values, assumptions, unknowns, and fixed weather IDs.
- `list_weather_nights(split=None, data_dir=None) -> list[dict]` lists SMETER
  HH09-region nights by default.
- `load_weather_night(night_id, data_dir=None) -> dict` loads temperature and
  wind speed without network access. Explicit `kisp-*` IDs retain legacy access.
- `load_weather_wind_direction(night_id, data_dir=None) -> dict` loads the SMETER
  companion direction series.
- `load_real_house(path=None) -> RealHouse` remains unchanged for Nikhil's Real
  Homes adapter.

The canonical API models and generated frontend types were deliberately not
changed by this data migration. Nikhil can continue consuming the existing
contracts; integration of the new twin is through these data readers. The
existing foundation API, fixtures, OpenAPI generation, and synthetic evaluation
infrastructure are preserved.

## Evaluation isolation

The fixed partition assigns 2019-2020 nights to training and 2021 nights to held
out. Nominal template fitting may use training inputs only. Held-out weather and
hidden-fault simulated runs must not be used to fit the template. Real HH09 data
has no verified room-level fault truth and is not field validation of synthetic
diagnosis.

## Reproduction

```bash
python -m backend.data_pipeline.build_hh09_twin \
  /path/to/856978_data_and_documentation.zip
```

The builder verifies the official archive SHA-256 before reading source tables.
The fixed dates and selection criteria live in the builder, so regeneration is
deterministic and requires no network access.
