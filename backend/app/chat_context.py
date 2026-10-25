"""Explain the current page using UI selections and server-owned public facts."""

from __future__ import annotations

from .contracts import AssistantScreen

PAGE_GUIDES = {
    "overview": (
        "Overview: the product story and a real HH09 night. Choose Fault Lab to test a synthetic home."
    ),
    "fault_lab": (
        "Fault Lab: simulated HH09-inspired indoor temperatures with real regional weather. "
        "Choose Judge mode (plant a fault) or Healthy house; Next night adds a simulated night. "
        "Room status comes from physics; coloured floors show temperatures, not a confirmed fault."
    ),
    "real_home": (
        "Real home: actual HH09 room and weather measurements for one week. "
        "The chart and colours show measurements, not synthetic diagnoses. Heating was not reliably "
        "off, so this week is not monitored for faults. There are no verified fault labels."
    ),
    "your_home": (
        "Your home: draw/upload a floor plan, set location and heating-off times, upload sensor CSV "
        "readings, then inspect monitoring results. There is no live sensor connection. "
        "Drawing a plan does not mean measurements have been collected."
    ),
}
VIEW_GUIDES = {
    "exterior": "Outside view of the house.",
    "thermal": "Temperature heat map; colour differences alone do not establish a cause.",
    "open": "Open house view showing rooms and temperature colours.",
    "inside": "Walk-in view from inside a room.",
    "fan": "Illustrative airflow view; this does not run a physical or simulated fan experiment.",
    "top": "Overhead house layout.",
}
PAGE_CONTROLS = {
    "overview": ["Fault Lab link", "Your home link", "scroll through the product story"],
    "real_home": ["Replay one night date buttons", "whole week", "Play/Pause", "time slider",
                  "3D view buttons", "original floor plan"],
    "your_home": ["draw/upload a plan", "location and heating-off setup", "upload CSV readings",
                  "room details after monitoring"],
}


def screen_context(screen: AssistantScreen | None, *, has_home: bool = False) -> dict:
    screen = screen or AssistantScreen(page="overview")
    context = {
        "selection": screen.model_dump(mode="json", exclude_none=True),
        "page_explanation": PAGE_GUIDES[screen.page],
        "view_explanation": VIEW_GUIDES.get(screen.view, "No specific house view selected."),
        "infrared_explanation": (
            "IR is a visualisation computed from temperatures, not a thermal-camera measurement."
        ) if screen.infrared else None,
        "available_controls": PAGE_CONTROLS.get(screen.page, (
            ["Next night", "Week", "room details", "Run a fan test tonight (when a cause is unclear)",
             "repair buttons", "Analytics", "3D view buttons"]
            if has_home else ["Judge mode", "Healthy house"]
        )),
    }
    if screen.page == "real_home":
        from backend.data_pipeline import load_real_house

        house = load_real_house()
        start = screen.window_start or house.measurement_start
        end = screen.window_end or house.measurement_end
        if start < house.measurement_start or end > house.measurement_end:
            raise ValueError("selected screen window is outside the real HH09 measurements")
        summaries = {}
        for room, series in house.room_temperature_series.items():
            values = [
                value for timestamp, value in zip(series.timestamps, series.values, strict=True)
                if start <= timestamp <= end and value is not None
            ]
            if values:
                summaries[room] = {
                    "minimum_deg_c": round(min(values), 2), "maximum_deg_c": round(max(values), 2),
                    "reading_count": len(values),
                }
        context["real_measurements"] = {
            "house_id": house.house_id,
            "window_start": start.isoformat(), "window_end": end.isoformat(),
            "rooms": summaries, "disclaimer": house.scientific_disclaimer,
            "heat_transfer_coefficient": house.reference_htc.model_dump(mode="json")
            if house.reference_htc else None,
            "note": "These ranges describe the selected window, not the current playback instant.",
        }
        context["visible_elements"] = [
            "3D house coloured by measured room temperature",
            "line chart of room and outside temperatures over time",
            "documented house characteristics",
            "disclaimer: real measurements have no verified room-level fault labels",
        ]
    return context
