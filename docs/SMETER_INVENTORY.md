# SMETER Phase 2 inventory and selected real home

## Official source

- Record: `https://reshare.ukdataservice.ac.uk/856978/`
- DOI: `https://doi.org/10.5255/UKDA-SN-856978`
- Published dataset: Allinson, D. et al. (2024), UK Data Service, SN 856978.
- Inspected archive: `856978_data_and_documentation.zip`, 23 MB.
- SHA-256 of inspected archive: `c1838e55daf2b05949d02079ca17563e083924cf94f0e0802cf83756b1d6a77c`.
- Access: the official record labels the download open access without registration.
- Collection: 30 dwellings in northwest England, 2019-2021.

The repository does not guess filenames or schemas. Both extraction commands
validate the inspected archive checksum and stop if a later release differs.

## Actual archive inventory

The outer archive contains:

- `SMETER_P2_Airtightness.csv`
- `SMETER_P2_DwellingInfo.csv`
- `SMETER_P2_Energy_Temp_RH_Weather_30homes.zip`
- `SMETER_P2_Floorplans.pdf`
- `SMETER_P2_OccupantInfo.csv`
- `SMETER_P2_OccupantInfo_SurveyForms.pdf`
- `SMETER_P2_QA_Weekly_Energy_Nov19-Feb21.xlsx`
- `SMETER_P2_README.txt`
- `SMETER_P2_WindowArea_Orientation.csv`

The nested time-series archive contains `HH01_all.csv` through
`HH30_all.csv`. Each uses a timestamp in the first unnamed column followed by
whole-home electricity and gas data, room-specific temperature/humidity columns,
and weather columns. Weather includes wind direction, wind speed, rainfall, air
temperature, relative humidity, pressure, and south-facing vertical irradiance.

The published README says room measurements are at 30-minute intervals and
weather is a 30-minute mean of 10-minute measurements. It does not state a time
zone.

## Selected house: HH09

HH09 was selected because its published floor plan has a clear one-level layout
and its bedroom, bathroom, hall, kitchen, living-room, outdoor-temperature, and
wind series are all complete for the selected seven-day winter interval.

Documented characteristics include:

- Detached one-bedroom bungalow, 39.72 m² measured floor area.
- Cavity wall with blown insulation, 100 mm mineral-wool loft insulation.
- Suspended timber floor with no documented floor insulation; double glazing.
- Weather station distance: 5.2 km.
- Measured co-heating HTC: 172 W/K.
- Fan-pressurisation result with all vents open: 22.03 h⁻¹ at 50 Pa.
- Corresponding air permeability: 14.93 m³/(h·m²) at 50 Pa.

Page 9 of the 30-page floor-plan PDF is labeled HH09 and was visually verified
before extraction. The processed PNG is a direct raster rendering of that page,
not a recreated diagram.

## HH09 room inventory and twin mapping

The real HH09 time series contains five measured room-temperature identifiers:
`bath_temp`, `bed_temp`, `hall_temp`, `kit_temp`, and `liv_temp`. The processed
real-house IDs are `bathroom`, `bedroom`, `hall`, `kitchen`, and `living_room`.

The existing simulator has four slots. The stable approximate-twin mapping is:

| Simulator slot ID | HH09 source room | Published floor-plan area | Plan dimensions |
|---|---|---:|---:|
| `living_room` | Living Room | 13.09 m² | 3.15 × 4.36 m |
| `kitchen` | Kitchen | 5.75 m² | 3.14 × 1.82 m |
| `bedroom_1` | Bedroom | 11.79 m² | 3.11 × 3.80 m |
| `bedroom_2` | Hall | 2.72 m² | 1.14 × 2.39 m |

The bathroom remains in the Real Homes data but is excluded from the four-slot
simulator. Page 9 of `SMETER_P2_Floorplans.pdf` supports the shared-boundary
adjacency mapping living↔kitchen, living↔hall, kitchen↔bedroom,
bedroom↔hall, and bedroom↔living (the chimney-breast wall). This is layout
evidence, not a measured thermal coupling.

The plan documents areas and horizontal dimensions but not ceiling heights.
Twin volumes use an explicit 2.4 m modeling assumption and are marked `assumed`,
not measured. Published windows are 2.36 × 1.20 m (living), 1.21 × 0.88 m
(kitchen), and 2.36 × 1.19 m (bedroom); no hall window is listed.

## Processed real interval and timestamp handling

The compact payload contains 336 half-hour observations from 18 February through
24 February 2021 inclusive. All five room temperatures and both weather series
are complete in this window; no interpolation or imputation is applied.

The source README does not declare whether timestamps are UTC or local civil
time. HeatHunter explicitly assumes `Europe/London`. The selected February window
falls in GMT (UTC+00:00), so conversion to UTC introduces no daylight-saving
ambiguity. This assumption is preserved in the output metadata.

## Matching regional weather for the approximate twin

The HH09 source file also contains outdoor temperature, wind speed, and wind
direction from the study's central weather station, 5.2 km from HH09. Eight fixed
cold nights are now cached under `data/weather/hh09/`: four training and four
held-out, with calm and windy conditions in both splits. Exact station
coordinates and source quality flags are not published; the package records
those facts instead of inventing values. See `docs/HH09_TWIN_INPUTS.md`.

## Regeneration and readers

```bash
python -m backend.data_pipeline.acquire_smeter \
  /path/to/856978_data_and_documentation.zip
```

The generated artifacts are `data/processed/smeter_hh09.json` and
`data/processed/smeter_hh09_floorplan.png`. Generate the basic validation plot
with `python -m backend.data_pipeline.plot_real_house`. Nikhil's adapter can call:

```python
from backend.data_pipeline import load_real_house

house = load_real_house()  # returns backend.app.contracts.RealHouse
```

Build the separate twin inputs and regional weather with:

```bash
python -m backend.data_pipeline.build_hh09_twin \
  /path/to/856978_data_and_documentation.zip
```

## Scientific restriction

SMETER does not provide verified room-level fault labels for HH09. The Real Homes
tab may show the measurements, floor plan, documented characteristics, HTC, and
airtightness. It must not infer that the coldest room has an air leak or defective
insulation, and it must not present this home as validation of synthetic
root-cause classification.

Whole-building HTC and blower-door results are reference measurements only.
They are not measured per-room conductance, natural ACH, or leakage shares and
must not be distributed among rooms without a separately justified model.
