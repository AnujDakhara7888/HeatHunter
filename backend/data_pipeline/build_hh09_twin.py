"""Build the HH09-region weather cache and approximate twin input package.

The command is intentionally offline. It consumes the checksum-pinned official
SMETER Phase 2 archive and writes deterministic, provenance-rich JSON artifacts.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import statistics
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from backend.data_pipeline.acquire_smeter import ARCHIVE_ROOT, ARCHIVE_SHA256, DOI, OFFICIAL_URL

HOUSE_ID = "HH09"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WEATHER_DIR = REPOSITORY_ROOT / "data" / "weather" / "hh09"
DEFAULT_TWIN_PATH = REPOSITORY_ROOT / "data" / "processed" / "hh09_twin_inputs.json"
TIMEZONE_ASSUMPTION = "Europe/London"
RAW_SERIES_REFERENCE = (
    "SMETER_P2_Energy_Temp_RH_Weather_30homes.zip/"
    "Meter_TemperatureRH_Weather_30homes/HH09_all.csv"
)
NIGHT_SELECTION = (
    ("2019-12-01", "training", "calm"),
    ("2020-12-06", "training", "calm"),
    ("2020-01-28", "training", "windy"),
    ("2020-02-10", "training", "windy"),
    ("2021-01-06", "heldout", "calm"),
    ("2021-01-08", "heldout", "calm"),
    ("2021-02-06", "heldout", "windy"),
    ("2021-02-12", "heldout", "windy"),
)

# Audited from page 9 of the source floor-plan PDF. Encoding the transcription
# here makes the transformation reproducible while preserving its exact source.
ROOMS = (
    {
        "simulator_room_id": "living_room",
        "simulator_slot": 1,
        "source_room_id": "living_room",
        "source_temperature_column": "liv_temp",
        "display_name": "Living Room",
        "area_m2": 13.09,
        "length_m": 4.36,
        "width_m": 3.15,
        "adjacent": ["kitchen", "hall"],
        "window_column": "Living",
    },
    {
        "simulator_room_id": "kitchen",
        "simulator_slot": 2,
        "source_room_id": "kitchen",
        "source_temperature_column": "kit_temp",
        "display_name": "Kitchen",
        "area_m2": 5.75,
        "length_m": 3.14,
        "width_m": 1.82,
        "adjacent": ["living_room", "bedroom"],
        "window_column": "Kitchen",
    },
    {
        "simulator_room_id": "bedroom_1",
        "simulator_slot": 3,
        "source_room_id": "bedroom",
        "source_temperature_column": "bed_temp",
        "display_name": "Bedroom",
        "area_m2": 11.79,
        "length_m": 3.80,
        "width_m": 3.11,
        "adjacent": ["kitchen", "hall"],
        "window_column": "Bed1 (Master)",
    },
    {
        "simulator_room_id": "bedroom_2",
        "simulator_slot": 4,
        "source_room_id": "hall",
        "source_temperature_column": "hall_temp",
        "display_name": "Hall",
        "area_m2": 2.72,
        "length_m": 2.39,
        "width_m": 1.14,
        "adjacent": ["living_room", "bedroom"],
        "window_column": "Hall",
    },
)
ASSUMED_CEILING_HEIGHT_M = 2.4


def _read_csv(payload: bytes, *, header_row: int = 0) -> list[dict[str, str]]:
    rows = list(csv.reader(io.StringIO(payload.decode("utf-8-sig"), newline="")))
    headers = rows[header_row]
    return [dict(zip(headers, row, strict=False)) for row in rows[header_row + 1 :] if row]


def _single(rows: list[dict[str, str]], field: str, value: str) -> dict[str, str]:
    matches = [row for row in rows if row.get(field) == value]
    if len(matches) != 1:
        raise ValueError(f"Expected one {field}={value!r} row, found {len(matches)}")
    return matches[0]


def _number(value: str) -> float:
    if not value.strip():
        raise ValueError("Required numeric SMETER value is missing")
    return float(value)


def _json_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _series(timestamps: list[str], values: list[float], unit: str) -> dict[str, Any]:
    return {
        "timestamps": timestamps,
        "values": values,
        "unit": unit,
        "provenance": "REAL_MEASUREMENT",
    }


def _field(
    value: Any,
    unit: str | None,
    status: str,
    source_reference: str,
    *,
    assumption: str | None = None,
) -> dict[str, Any]:
    result = {
        "value": value,
        "unit": unit,
        "status": status,
        "source_reference": source_reference,
    }
    if assumption is not None:
        result["assumption"] = assumption
    return result


def _window_dimensions(value: str) -> list[dict[str, float]]:
    if not value.strip():
        return []
    dimensions = []
    for item in value.split(";"):
        height, width = (float(part.strip()) for part in item.lower().replace("*", "x").split("x"))
        dimensions.append({"height_m": height, "width_m": width, "area_m2": round(height * width, 4)})
    return dimensions


def _source() -> dict[str, Any]:
    return {
        "provider": "UK Data Service",
        "dataset": "Technical Evaluation of SMETER Technologies Project Phase 2 Data",
        "record_url": OFFICIAL_URL,
        "doi": DOI,
        "archive_sha256": ARCHIVE_SHA256,
        "citation": (
            "Allinson, D. et al. (2024). Technical Evaluation of SMETER Technologies "
            "Project Phase 2 Data [Data Collection]. UK Data Service. SN 856978."
        ),
    }


def _extract_source_rows(
    archive_path: Path,
) -> tuple[dict[str, str], dict[str, str], dict[str, str], list[dict[str, str]]]:
    checksum = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    if checksum != ARCHIVE_SHA256:
        raise ValueError("SMETER archive checksum differs from the inspected 2024 release")
    with zipfile.ZipFile(archive_path) as outer:
        dwelling_rows = _read_csv(outer.read(f"{ARCHIVE_ROOT}/SMETER_P2_DwellingInfo.csv"))
        airtightness_rows = _read_csv(outer.read(f"{ARCHIVE_ROOT}/SMETER_P2_Airtightness.csv"))
        window_rows = _read_csv(
            outer.read(f"{ARCHIVE_ROOT}/SMETER_P2_WindowArea_Orientation.csv"),
            header_row=1,
        )
        if f"{ARCHIVE_ROOT}/SMETER_P2_Floorplans.pdf" not in outer.namelist():
            raise ValueError("Official floor-plan PDF is missing from the archive")
        nested = outer.read(f"{ARCHIVE_ROOT}/SMETER_P2_Energy_Temp_RH_Weather_30homes.zip")
    with zipfile.ZipFile(io.BytesIO(nested)) as series_archive:
        series_rows = _read_csv(series_archive.read(RAW_SERIES_REFERENCE.split("/", 1)[1]))
    return (
        _single(dwelling_rows, "House_ID", HOUSE_ID),
        _single(airtightness_rows, "House_ID", HOUSE_ID),
        _single(window_rows, "HouseID", HOUSE_ID),
        series_rows,
    )


def _weather_payload(
    date_text: str,
    split: str,
    expected_regime: str,
    rows_by_time: dict[datetime, dict[str, str]],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    zone = ZoneInfo(TIMEZONE_ASSUMPTION)
    start = datetime.fromisoformat(f"{date_text}T18:00:00").replace(tzinfo=zone)
    local_times = [start + timedelta(minutes=30 * step) for step in range(25)]
    source_rows = [rows_by_time[time.replace(tzinfo=None)] for time in local_times]
    timestamps = [time.astimezone(UTC).isoformat().replace("+00:00", "Z") for time in local_times]
    temperatures = [_number(row["Air temp (degC)"]) for row in source_rows]
    wind_speeds = [_number(row["Windspeed (m/s)"]) for row in source_rows]
    wind_directions = [_number(row["Wind direction (from N)"]) for row in source_rows]
    mean_temperature = round(statistics.fmean(temperatures), 2)
    mean_wind = round(statistics.fmean(wind_speeds), 2)
    regime = "calm" if mean_wind <= 2.0 else "windy" if mean_wind >= 4.0 else "moderate"
    if regime != expected_regime:
        raise ValueError(f"{date_text} no longer satisfies its selected {expected_regime} regime")

    night_id = f"smeter-hh09-{date_text}"
    source = {
        "provider": "UK Data Service",
        "dataset": "SMETER Phase 2 central weather station",
        "url": OFFICIAL_URL,
        "citation": _source()["citation"],
        "notes": (
            f"Raw source: {RAW_SERIES_REFERENCE}. Published as 30-minute means of 10-minute "
            "weather measurements. No source quality-flag columns are published."
        ),
        "station_id": "smeter-phase2-central-weather-station",
        "station_name": "SMETER Phase 2 central weather station (exact coordinates unpublished)",
    }
    payload = {
        "schema_version": 1,
        "night_id": night_id,
        "source": source,
        "location": {
            "name": "SMETER Phase 2 study area, northwest England",
            "timezone": TIMEZONE_ASSUMPTION,
            "coordinates_status": "not_published",
            "distance_to_hh09_km": 5.2,
        },
        "outdoor_temperature": _series(timestamps, temperatures, "degC"),
        "wind_speed": _series(timestamps, wind_speeds, "m/s"),
        "train_or_heldout_split": split,
        "local_night_date": date_text,
        "utc_window": {
            "start": timestamps[0],
            "end": timestamps[-1],
            "note": "18:00 through 06:00 local, inclusive; selected dates fall in GMT (UTC+00:00).",
        },
        "selection_metadata": {
            "weather_regime": regime,
            "mean_temperature_deg_c": mean_temperature,
            "mean_wind_speed_m_s": mean_wind,
            "observation_count": len(timestamps),
            "temperature_quality_flags": [],
            "wind_quality_flags": [],
        },
        "data_quality": {
            "sampling_interval_minutes": 30,
            "missing_temperature_count": 0,
            "missing_wind_speed_count": 0,
            "missing_wind_direction_count": 0,
            "imputation": "none",
            "source_quality_flags_available": False,
        },
        "wind_direction_companion": f"wind_direction/{night_id}.json",
    }
    direction = {
        "schema_version": 1,
        "night_id": night_id,
        "source": source,
        "wind_direction": _series(timestamps, wind_directions, "degrees_from_north"),
        "data_quality": payload["data_quality"],
    }
    summary = {
        "night_id": night_id,
        "local_night_date": date_text,
        "train_or_heldout_split": split,
        "weather_regime": regime,
        "mean_temperature_deg_c": mean_temperature,
        "mean_wind_speed_m_s": mean_wind,
        "observation_count": len(timestamps),
        "sampling_interval_minutes": 30,
        "missing_value_count": 0,
        "wind_direction_available": True,
        "source_station_id": source["station_id"],
    }
    return payload, direction, summary


def build_hh09_twin(
    archive_path: Path,
    weather_dir: Path = DEFAULT_WEATHER_DIR,
    twin_path: Path = DEFAULT_TWIN_PATH,
) -> tuple[list[Path], Path]:
    """Build all HH09 twin data artifacts from the official archive."""

    dwelling, airtightness, windows, series_rows = _extract_source_rows(archive_path)
    rows_by_time = {
        datetime.strptime(row[""], "%d/%m/%Y %H:%M"): row for row in series_rows
    }
    generated_paths: list[Path] = []
    summaries = []
    for date_text, split, regime in NIGHT_SELECTION:
        weather, direction, summary = _weather_payload(date_text, split, regime, rows_by_time)
        weather_path = weather_dir / f"{weather['night_id']}.json"
        direction_path = weather_dir / "wind_direction" / f"{weather['night_id']}.json"
        _json_write(weather_path, weather)
        _json_write(direction_path, direction)
        generated_paths.extend([weather_path, direction_path])
        summaries.append(summary)

    index = {
        "schema_version": 1,
        "default_weather_source": "SMETER Phase 2 central weather station",
        "reference_house_id": HOUSE_ID,
        "selection_rule": {
            "night_window": "18:00-06:00 Europe/London inclusive (25 half-hour samples)",
            "cold_threshold": "mean outdoor temperature <= 7 degC",
            "calm_threshold": "mean wind speed <= 2 m/s",
            "windy_threshold": "mean wind speed >= 4 m/s",
            "split_policy": "2019-2020 selected nights are training; 2021 nights are held out",
            "selection": "fixed date list in backend/data_pipeline/build_hh09_twin.py",
        },
        "source": _source(),
        "nights": summaries,
    }
    index_path = weather_dir / "index.json"
    _json_write(index_path, index)
    generated_paths.append(index_path)

    floorplan_ref = "SMETER_P2_Floorplans.pdf page 9 (published page labeled HH09)"
    window_ref = "SMETER_P2_WindowArea_Orientation.csv HH09 row"
    rooms = []
    for room in ROOMS:
        window_dimensions = _window_dimensions(windows[room["window_column"]])
        rooms.append(
            {
                "simulator_room_id": room["simulator_room_id"],
                "simulator_slot": room["simulator_slot"],
                "source_room_id": room["source_room_id"],
                "source_temperature_column": room["source_temperature_column"],
                "display_name": room["display_name"],
                "floor": _field("ground", None, "documented", floorplan_ref),
                "geometry": {
                    "floor_area": _field(room["area_m2"], "m2", "documented", floorplan_ref),
                    "plan_length": _field(room["length_m"], "m", "documented", floorplan_ref),
                    "plan_width": _field(room["width_m"], "m", "documented", floorplan_ref),
                    "ceiling_height": _field(
                        ASSUMED_CEILING_HEIGHT_M,
                        "m",
                        "assumed",
                        "HeatHunter modeling assumption; not published by SMETER",
                        assumption="Uniform 2.4 m ceiling height used only to estimate simulator volume.",
                    ),
                    "volume": _field(
                        round(room["area_m2"] * ASSUMED_CEILING_HEIGHT_M, 3),
                        "m3",
                        "assumed",
                        "Derived from documented floor area and assumed ceiling height",
                        assumption="floor_area_m2 × 2.4 m; not a measured SMETER volume",
                    ),
                },
                "adjacent_source_rooms": _field(
                    room["adjacent"],
                    None,
                    "documented",
                    floorplan_ref,
                    assumption=None,
                ),
                "adjacency_interpretation": (
                    "Shared boundary visible on the published plan; this does not measure a thermal "
                    "coupling coefficient or prove an open airflow path."
                ),
                "windows": _field(window_dimensions, "m", "documented", window_ref),
                "unknown_simulation_parameters": [
                    "thermal_capacitance_j_per_k",
                    "envelope_conductance_w_per_k",
                    "infiltration_conductance_w_per_k",
                    "leakage_share",
                    "wind_sensitivity",
                    "inter_room_conductance_w_per_k",
                ],
            }
        )

    dwelling_ref = "SMETER_P2_DwellingInfo.csv HH09 row"
    airtightness_ref = "SMETER_P2_Airtightness.csv HH09 All Vents Open row"
    twin = {
        "schema_version": 1,
        "package_id": "hh09-approximate-digital-twin-inputs-v1",
        "reference_house_id": HOUSE_ID,
        "model_type": "approximate_digital_twin",
        "source": _source(),
        "source_documents": [
            dwelling_ref,
            airtightness_ref,
            window_ref,
            floorplan_ref,
            RAW_SERIES_REFERENCE,
            "SMETER_P2_README.txt",
        ],
        "separation_of_concerns": {
            "real_hh09_measurements": "data/processed/smeter_hh09.json",
            "hh09_twin_inputs": "data/processed/hh09_twin_inputs.json",
            "simulated_scenarios": "generated by the simulation workstream; not stored here",
        },
        "room_mapping_policy": (
            "Four existing simulator slots are retained. The former bedroom_2 slot maps to the "
            "documented HH09 hall; it must be displayed as Hall in HH09 twin scenarios."
        ),
        "rooms": rooms,
        "excluded_observed_rooms": [
            {
                "source_room_id": "bathroom",
                "source_temperature_column": "bath_temp",
                "reason": "HH09 has five measured rooms, while the existing simulator has four slots.",
                "retained_in_real_measurements": True,
            }
        ],
        "building_characteristics": {
            "dwelling_type": _field("Bungalow", None, "documented", dwelling_ref),
            "attachment": _field("Detached", None, "documented", dwelling_ref),
            "total_floor_area": _field(
                _number(dwelling["Total Floor Area (m2) - measured by TEST team (not Halton survey)"]),
                "m2",
                "documented",
                dwelling_ref,
            ),
            "external_wall_type": _field(
                dwelling["External wall type"], None, "documented", dwelling_ref
            ),
            "external_wall_insulation": _field(
                dwelling["External wall insulation"], None, "documented", dwelling_ref
            ),
            "loft_insulation_material": _field(
                dwelling["Loft insulation material"], None, "documented", dwelling_ref
            ),
            "loft_insulation_thickness": _field(
                _number(dwelling["Loft insulation thickness (mm)"]),
                "mm",
                "documented",
                dwelling_ref,
            ),
            "ground_floor_type": _field(
                dwelling["Ground floor type"], None, "documented", dwelling_ref
            ),
            "floor_insulation": _field(
                dwelling["Floor insulation"], None, "documented", dwelling_ref
            ),
            "glazing": _field(dwelling["Glazing"], None, "documented", dwelling_ref),
            "front_door_orientation": _field(
                _number(windows["Front door orientation (degrees from north)"]),
                "degrees_from_north",
                "documented",
                window_ref,
            ),
            "weather_station_distance": _field(
                _number(dwelling["Distance from weather station [km] (direct path)"]),
                "km",
                "documented",
                dwelling_ref,
            ),
        },
        "whole_building_references": {
            "co_heating_htc": {
                **_field(_number(dwelling["Co-heating HTC"]), "W/K", "documented", dwelling_ref),
                "usage": "reference_only",
                "restriction": "Must not be allocated to rooms as measured conductance.",
            },
            "blower_door_air_changes_at_50pa": {
                **_field(
                    _number(airtightness["Blower Door Test h-1 @ 50Pa"]),
                    "h-1 @ 50Pa",
                    "documented",
                    airtightness_ref,
                ),
                "usage": "reference_only",
                "vent_status": airtightness["Vent status"],
                "restriction": "Must not be treated as natural ACH or allocated to rooms.",
            },
            "blower_door_air_permeability_at_50pa": {
                **_field(
                    _number(airtightness["Blower Door Test m3/(h.m2) @ 50Pa"]),
                    "m3/(h.m2) @ 50Pa",
                    "documented",
                    airtightness_ref,
                ),
                "usage": "reference_only",
                "vent_status": airtightness["Vent status"],
            },
        },
        "unknowns_and_uncertainties": [
            "Exact weather-station coordinates are not published.",
            "The README does not state timestamp timezone; Europe/London is assumed.",
            "Ceiling height and therefore every room volume are assumed, not measured.",
            "Room thermal masses, fabric U-values, leakage distribution, wind sensitivity, and "
            "inter-room thermal coupling coefficients are not published.",
            "Floor-plan adjacency records shared boundaries only, not measured heat transfer.",
            "Window dimensions are documented, but per-window compass orientations are not.",
        ],
        "weather_night_ids": [summary["night_id"] for summary in summaries],
        "weather_catalog": "data/weather/hh09/index.json",
        "partition_policy": {
            "training": [
                summary["night_id"]
                for summary in summaries
                if summary["train_or_heldout_split"] == "training"
            ],
            "heldout": [
                summary["night_id"]
                for summary in summaries
                if summary["train_or_heldout_split"] == "heldout"
            ],
            "restriction": (
                "Fit nominal parameters only on training inputs. Hidden-fault evaluation runs and "
                "held-out weather must not inform calibration."
            ),
        },
        "provenance_isolation": {
            "real_observations": "REAL_MEASUREMENT",
            "geometry_assumptions": "ASSUMPTION",
            "simulator_outputs": "SIMULATED_MEASUREMENT",
            "hidden_fault_truth": "SIMULATED_GROUND_TRUTH",
        },
    }
    _json_write(twin_path, twin)
    return generated_paths, twin_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Official 856978_data_and_documentation.zip")
    parser.add_argument("--weather-dir", type=Path, default=DEFAULT_WEATHER_DIR)
    parser.add_argument("--twin-path", type=Path, default=DEFAULT_TWIN_PATH)
    args = parser.parse_args()
    build_hh09_twin(args.archive, args.weather_dir, args.twin_path)


if __name__ == "__main__":
    main()
