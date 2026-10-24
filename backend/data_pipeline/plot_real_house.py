"""Create a compact visual validation plot for the processed SMETER house."""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib
import matplotlib.dates as mdates

matplotlib.use("Agg")

import matplotlib.pyplot as plt

from .real_house import load_real_house


def render_validation_plot(output: Path) -> None:
    house = load_real_house()
    timestamps = house.outdoor_temperature.timestamps

    figure, (temperature_axis, wind_axis) = plt.subplots(
        2,
        1,
        figsize=(12, 7),
        height_ratios=(3, 1),
        sharex=True,
        constrained_layout=True,
    )
    for room_id, series in house.room_temperature_series.items():
        temperature_axis.plot(
            timestamps,
            series.values,
            linewidth=1.1,
            label=room_id.replace("_", " ").title(),
        )
    temperature_axis.plot(
        timestamps,
        house.outdoor_temperature.values,
        color="#17202A",
        linewidth=1.5,
        linestyle="--",
        label="Outdoor",
    )
    temperature_axis.set_title("SMETER Phase 2 HH09 - processed measurement validation")
    temperature_axis.set_ylabel("Temperature (°C)")
    temperature_axis.grid(alpha=0.2)
    temperature_axis.legend(ncol=3, frameon=False)

    wind_axis.plot(timestamps, house.wind_speed.values, color="#2471A3", linewidth=1.1)
    wind_axis.set_ylabel("Wind (m/s)")
    wind_axis.set_xlabel("UTC (source interpreted as Europe/London; selected period is GMT)")
    wind_axis.grid(alpha=0.2)
    wind_axis.xaxis.set_major_locator(mdates.DayLocator())
    wind_axis.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))

    figure.text(
        0.995,
        0.005,
        "Real measurements; no verified room-level fault labels.",
        ha="right",
        va="bottom",
        fontsize=8,
        color="#566573",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=160, metadata={"Creator": "HeatHunter SMETER pipeline"})
    plt.close(figure)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[2]
        / "data"
        / "processed"
        / "smeter_hh09_validation.png",
    )
    args = parser.parse_args()
    render_validation_plot(args.output)


if __name__ == "__main__":
    main()
