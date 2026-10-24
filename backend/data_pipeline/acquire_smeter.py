"""Extract the selected SMETER Phase 2 home from the official archive.

The command accepts the official outer ZIP, validates its known 2024 checksum,
reads the published schemas directly, extracts a complete seven-day winter
window for HH09, and renders floor-plan page 9. It performs no network access.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import shutil
import subprocess
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from backend.app.contracts import RealHouse

ARCHIVE_SHA256 = "c1838e55daf2b05949d02079ca17563e083924cf94f0e0802cf83756b1d6a77c"
ARCHIVE_ROOT = "856978_data_and_documentation"
OFFICIAL_URL = "https://reshare.ukdataservice.ac.uk/856978/"
DOI = "https://doi.org/10.5255/UKDA-SN-856978"
HOUSE_ID = "HH09"
FLOORPLAN_PAGE = 9
WINDOW_START_LOCAL = datetime(2021, 2, 18, 0, 0)
WINDOW_END_LOCAL = datetime(2021, 2, 25, 0, 0)
ROOM_COLUMNS = {
    "bathroom": "bath_temp",
    "bedroom": "bed_temp",
    "hall": "hall_temp",
    "kitchen": "kit_temp",
    "living_room": "liv_temp",
}


def _read_csv(payload: bytes) -> list[dict[str, str]]:
    text = io.StringIO(payload.decode("utf-8-sig"), newline="")
    return list(csv.DictReader(text))


def _single_row(rows: list[dict[str, str]], field: str, value: str) -> dict[str, str]:
    matches = [row for row in rows if row.get(field) == value]
    if len(matches) != 1:
        raise ValueError(f"Expected one {field}={value!r} row, found {len(matches)}")
    return matches[0]


def _number(value: str) -> float:
    if not value.strip():
        raise ValueError("Required numeric SMETER value is missing")
    return float(value)


def _source() -> dict[str, str]:
    return {
        "provider": "UK Data Service",
        "dataset": "Technical Evaluation of SMETER Technologies Project Phase 2 Data",
        "url": OFFICIAL_URL,
        "citation": (
            "Allinson, D. et al. (2024). Technical Evaluation of SMETER Technologies Project "
            "Phase 2 Data [Data Collection]. UK Data Service. SN 856978."
        ),
        "notes": f"DOI: {DOI}. Open-access archive downloaded from the official record.",
    }


def _series(timestamps: list[str], values: list[float], unit: str) -> dict[str, object]:
    return {
        "timestamps": timestamps,
        "values": values,
        "unit": unit,
        "provenance": "REAL_MEASUREMENT",
    }


def _characteristic(name: str, value: float | str | bool, unit: str | None = None) -> dict[str, object]:
    return {
        "name": name,
        "value": value,
        "unit": unit,
        "provenance": "REAL_MEASUREMENT",
    }


def _render_floorplan(pdf_payload: bytes, output_path: Path) -> None:
    executable = shutil.which("pdftoppm")
    if executable is None:
        raise RuntimeError("pdftoppm is required to extract the selected floor-plan page")
    with tempfile.TemporaryDirectory(prefix="heathunter-smeter-") as temporary:
        temporary_path = Path(temporary)
        pdf_path = temporary_path / "floorplans.pdf"
        prefix = temporary_path / "hh09-floorplan"
        pdf_path.write_bytes(pdf_payload)
        subprocess.run(
            [
                executable,
                "-f",
                str(FLOORPLAN_PAGE),
                "-l",
                str(FLOORPLAN_PAGE),
                "-singlefile",
                "-r",
                "150",
                "-png",
                str(pdf_path),
                str(prefix),
            ],
            check=True,
        )
        shutil.copyfile(prefix.with_suffix(".png"), output_path)


def extract_smeter_house(archive_path: Path, output_dir: Path) -> tuple[Path, Path]:
    checksum = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    if checksum != ARCHIVE_SHA256:
        raise ValueError(
            "SMETER archive checksum differs from the inspected 2024 release; "
            "inspect its schemas before extraction"
        )

    with zipfile.ZipFile(archive_path) as outer:
        dwelling_rows = _read_csv(outer.read(f"{ARCHIVE_ROOT}/SMETER_P2_DwellingInfo.csv"))
        airtightness_rows = _read_csv(outer.read(f"{ARCHIVE_ROOT}/SMETER_P2_Airtightness.csv"))
        floorplans_pdf = outer.read(f"{ARCHIVE_ROOT}/SMETER_P2_Floorplans.pdf")
        time_series_zip = outer.read(f"{ARCHIVE_ROOT}/SMETER_P2_Energy_Temp_RH_Weather_30homes.zip")

    with zipfile.ZipFile(io.BytesIO(time_series_zip)) as series_archive:
        series_rows = _read_csv(
            series_archive.read(f"Meter_TemperatureRH_Weather_30homes/{HOUSE_ID}_all.csv")
        )

    local_zone = ZoneInfo("Europe/London")
    timestamps: list[str] = []
    room_values: dict[str, list[float]] = {room_id: [] for room_id in ROOM_COLUMNS}
    outdoor_temperature: list[float] = []
    wind_speed: list[float] = []
    for row in series_rows:
        local_timestamp = datetime.strptime(row[""], "%d/%m/%Y %H:%M")
        if not WINDOW_START_LOCAL <= local_timestamp < WINDOW_END_LOCAL:
            continue
        utc_timestamp = local_timestamp.replace(tzinfo=local_zone).astimezone(UTC)
        timestamps.append(utc_timestamp.isoformat().replace("+00:00", "Z"))
        for room_id, column in ROOM_COLUMNS.items():
            room_values[room_id].append(_number(row[column]))
        outdoor_temperature.append(_number(row["Air temp (degC)"]))
        wind_speed.append(_number(row["Windspeed (m/s)"]))

    expected_count = 7 * 48
    wrong_room_length = any(len(values) != expected_count for values in room_values.values())
    if len(timestamps) != expected_count or wrong_room_length:
        raise ValueError("Selected HH09 window must contain 336 complete half-hour observations")
    if len(set(timestamps)) != expected_count or timestamps != sorted(timestamps):
        raise ValueError("Selected HH09 timestamps must be unique and increasing")

    dwelling = _single_row(dwelling_rows, "House_ID", HOUSE_ID)
    airtightness = _single_row(airtightness_rows, "House_ID", HOUSE_ID)
    payload = {
        "house_id": "smeter-hh09",
        "display_name": "SMETER Phase 2 - HH09",
        "source": _source(),
        "floor_plan_asset_path": "data/processed/smeter_hh09_floorplan.png",
        "room_temperature_series": {
            room_id: _series(timestamps, values, "degC") for room_id, values in room_values.items()
        },
        "outdoor_temperature": _series(timestamps, outdoor_temperature, "degC"),
        "wind_speed": _series(timestamps, wind_speed, "m/s"),
        "characteristics": [
            _characteristic("dwelling_type", dwelling["Dwelling type"]),
            _characteristic("attachment", dwelling["Attachment"]),
            _characteristic(
                "total_floor_area",
                _number(dwelling["Total Floor Area (m2) - measured by TEST team (not Halton survey)"]),
                "m2",
            ),
            _characteristic("number_of_bedrooms", _number(dwelling["Number of bedrooms"]), "count"),
            _characteristic(
                "weather_station_distance",
                _number(dwelling["Distance from weather station [km] (direct path)"]),
                "km",
            ),
            _characteristic("external_wall_type", dwelling["External wall type"]),
            _characteristic("external_wall_insulation", dwelling["External wall insulation"]),
            _characteristic(
                "loft_insulation_thickness",
                _number(dwelling["Loft insulation thickness (mm)"]),
                "mm",
            ),
            _characteristic("ground_floor_type", dwelling["Ground floor type"]),
            _characteristic("floor_insulation", dwelling["Floor insulation"]),
            _characteristic("glazing", dwelling["Glazing"]),
            _characteristic(
                "blower_door_air_permeability_at_50pa",
                _number(airtightness["Blower Door Test m3/(h.m2) @ 50Pa"]),
                "m3/(h.m2) @ 50Pa",
            ),
        ],
        "reference_htc": {
            "value": _number(dwelling["Co-heating HTC"]),
            "unit": "W/K",
            "method": "Measured co-heating test",
            "provenance": "REAL_MEASUREMENT",
        },
        "airtightness": {
            "value": _number(airtightness["Blower Door Test h-1 @ 50Pa"]),
            "unit": "h-1 @ 50Pa",
            "method": f"Fan pressurisation; vent status: {airtightness['Vent status']}",
            "provenance": "REAL_MEASUREMENT",
        },
        "measurement_start": timestamps[0],
        "measurement_end": timestamps[-1],
        "timestamp_notes": (
            "The published README does not declare a timezone. Source timestamps are interpreted as "
            "Europe/London local civil time. This selected February window is GMT (UTC+00:00), avoiding "
            "daylight-saving ambiguity."
        ),
        "scientific_disclaimer": (
            "This home has no verified room-level fault labels. The data demonstrate real measurements "
            "and do not validate HeatHunter's synthetic root-cause classification."
        ),
    }
    validated = RealHouse.model_validate(payload)

    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "smeter_hh09.json"
    floorplan_path = output_dir / "smeter_hh09_floorplan.png"
    json_path.write_text(validated.model_dump_json(indent=2) + "\n", encoding="utf-8")
    _render_floorplan(floorplans_pdf, floorplan_path)
    return json_path, floorplan_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Official 856978_data_and_documentation.zip")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "data" / "processed",
    )
    args = parser.parse_args()
    extract_smeter_house(args.archive, args.output_dir)


if __name__ == "__main__":
    main()
