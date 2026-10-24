"""Operational assumptions for the SIMULATED fan test, not ISO compliance."""

from __future__ import annotations

import math
from dataclasses import dataclass

from backend.app.contracts import Protocol, WeatherNight


@dataclass(frozen=True)
class CalmFanPolicy:
    # A deliberately conservative project assumption. SMETER is a remote station
    # with half-hour averages, so this is not a house-site gust measurement.
    max_wind_m_s: float = 2.0

    def __post_init__(self) -> None:
        if (
            isinstance(self.max_wind_m_s, bool)
            or not isinstance(self.max_wind_m_s, (int, float))
            or not math.isfinite(self.max_wind_m_s)
            or not 0 < self.max_wind_m_s <= 6
        ):
            raise ValueError("fan wind limit must be finite and in (0, 6] m/s")

    def assess(self, weather: WeatherNight, protocol: Protocol) -> tuple[bool, str]:
        if not protocol.fan_on or protocol.fan_start is None or protocol.fan_end is None:
            return False, "No complete fan protocol supplied."
        stamps = weather.wind_speed.timestamps
        if weather.wind_speed.unit != "m/s" or not stamps:
            return False, "Fan weather requires wind measurements in m/s."
        start, end = protocol.fan_start, protocol.fan_end
        if (
            start.tzinfo is None
            or end.tzinfo is None
            or end <= start
            or start < stamps[0]
            or end > stamps[-1]
        ):
            return False, "Wind series does not cover the full fan interval."
        # Include both samples bracketing each endpoint, so a missing point or
        # coarse interval cannot disappear from eligibility by interpolation.
        indices = [i for i, t in enumerate(stamps) if start <= t <= end]
        before = [i for i, t in enumerate(stamps) if t < start]
        after = [i for i, t in enumerate(stamps) if t > end]
        if before and start not in stamps:
            indices.append(before[-1])
        if after and end not in stamps:
            indices.append(after[0])
        indices = sorted(set(indices))
        values = [weather.wind_speed.values[i] for i in indices]
        if (
            len(indices) < 2
            or any(v is None or not math.isfinite(v) or v < 0 for v in values)
            or any(
                (stamps[b] - stamps[a]).total_seconds() > 3600
                for a, b in zip(indices, indices[1:], strict=False)
            )
        ):
            return False, "Wind measurements are missing, invalid, or too sparse for the fan interval."
        peak = max(values)
        if peak > self.max_wind_m_s:
            return False, (
                f"Fan test deferred: interval wind reaches {peak:.2f} m/s, "
                f"above the assumed {self.max_wind_m_s:.2f} m/s calm-weather limit."
            )
        return True, (
            f"Simulated test eligible: interval wind <= {self.max_wind_m_s:.2f} m/s. "
            "Remote station averages do not establish wind or gusts at the house."
        )
