from __future__ import annotations

import math
import statistics
from typing import Any


def _values(arguments: dict[str, Any], name: str) -> list[float]:
    raw = arguments.get(name)
    if not isinstance(raw, list) or not raw:
        raise ValueError(f"{name} must be a non-empty numeric array")
    values = [float(value) for value in raw]
    if not all(math.isfinite(value) for value in values):
        raise ValueError(f"{name} must contain only finite values")
    return values


def _quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _pearson(left: list[float], right: list[float]) -> float | None:
    if len(left) < 3 or len(left) != len(right):
        return None
    left_mean = statistics.fmean(left)
    right_mean = statistics.fmean(right)
    numerator = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right, strict=True))
    left_ss = sum((x - left_mean) ** 2 for x in left)
    right_ss = sum((y - right_mean) ** 2 for y in right)
    denominator = math.sqrt(left_ss * right_ss)
    return numerator / denominator if denominator > 0 else None


def calculate_ocean_statistics(arguments: dict[str, Any]) -> dict[str, Any]:
    operation = str(arguments.get("operation") or "").strip()

    if operation == "weighted_summary":
        values = _values(arguments, "values")
        weights = _values(arguments, "weights") if arguments.get("weights") is not None else [1.0] * len(values)
        if len(weights) != len(values) or any(weight < 0 for weight in weights) or sum(weights) <= 0:
            raise ValueError("weights must match values, be non-negative and have a positive sum")
        weight_sum = sum(weights)
        mean = sum(value * weight for value, weight in zip(values, weights, strict=True)) / weight_sum
        variance = sum(weight * (value - mean) ** 2 for value, weight in zip(values, weights, strict=True)) / weight_sum
        effective_n = weight_sum**2 / sum(weight**2 for weight in weights)
        return {
            "operation": operation,
            "results": {"count": len(values), "weight_sum": weight_sum, "effective_sample_size": effective_n, "weighted_mean": mean, "weighted_standard_deviation": math.sqrt(variance), "minimum": min(values), "p05": _quantile(values, 0.05), "median": _quantile(values, 0.5), "p95": _quantile(values, 0.95), "maximum": max(values)},
            "method": "Population weighted moments and linearly interpolated empirical quantiles.",
            "limitations": ["Weights must represent the documented area, time or quality weighting; effective sample size does not correct spatial or temporal autocorrelation."],
        }

    if operation == "robust_trend":
        values = _values(arguments, "values")
        if len(values) < 3:
            raise ValueError("robust_trend requires at least three values")
        step_hours = float(arguments.get("time_step_hours") or 1.0)
        if not math.isfinite(step_hours) or step_hours <= 0:
            raise ValueError("time_step_hours must be positive")
        times = [index * step_hours for index in range(len(values))]
        mean_t = statistics.fmean(times)
        mean_y = statistics.fmean(values)
        denominator = sum((time - mean_t) ** 2 for time in times)
        ols_slope = sum((time - mean_t) * (value - mean_y) for time, value in zip(times, values, strict=True)) / denominator
        intercept = mean_y - ols_slope * mean_t
        residual_ss = sum((value - (intercept + ols_slope * time)) ** 2 for time, value in zip(times, values, strict=True))
        total_ss = sum((value - mean_y) ** 2 for value in values)
        stride = max(1, math.ceil(len(values) / 300))
        sampled_indexes = list(range(0, len(values), stride))
        sample = [values[index] for index in sampled_indexes]
        sampled_times = [index * step_hours for index in sampled_indexes]
        slopes = [(sample[j] - sample[i]) / (sampled_times[j] - sampled_times[i]) for i in range(len(sample) - 1) for j in range(i + 1, len(sample))]
        sen_slope = statistics.median(slopes)
        return {
            "operation": operation,
            "results": {"count": len(values), "time_span_hours": times[-1], "ols_slope_per_hour": ols_slope, "theil_sen_slope_per_hour": sen_slope, "theil_sen_change_over_window": sen_slope * times[-1], "ols_r_squared": 1 - residual_ss / total_ss if total_ss > 0 else None},
            "method": "OLS trend plus a Theil-Sen median pairwise slope; long arrays are deterministically downsampled to at most 300 points for pairwise slopes.",
            "limitations": ["Serial correlation and seasonality are not removed. A short-window slope is a window tendency, not a climatological trend."],
        }

    if operation == "vector_summary":
        eastward = _values(arguments, "eastward_values")
        northward = _values(arguments, "northward_values")
        if len(eastward) != len(northward):
            raise ValueError("eastward_values and northward_values must have equal length")
        speeds = [math.hypot(u, v) for u, v in zip(eastward, northward, strict=True)]
        unit_vectors = [(u / speed, v / speed) for u, v, speed in zip(eastward, northward, speeds, strict=True) if speed > 0]
        mean_u = statistics.fmean(eastward)
        mean_v = statistics.fmean(northward)
        toward = math.degrees(math.atan2(mean_u, mean_v)) % 360 if math.hypot(mean_u, mean_v) > 0 else None
        resultant = math.hypot(statistics.fmean([u for u, _ in unit_vectors]), statistics.fmean([v for _, v in unit_vectors])) if unit_vectors else None
        return {
            "operation": operation,
            "results": {"count": len(speeds), "nonzero_vector_count": len(unit_vectors), "mean_eastward_component": mean_u, "mean_northward_component": mean_v, "mean_vector_speed": math.hypot(mean_u, mean_v), "mean_scalar_speed": statistics.fmean(speeds), "p95_speed": _quantile(speeds, 0.95), "mean_direction_toward_degrees": toward, "meteorological_direction_from_degrees": (toward + 180) % 360 if toward is not None else None, "directional_resultant_length": resultant},
            "method": "Vector components are averaged before vector magnitude; scalar speed is reported separately. Directional resultant length uses non-zero unit vectors.",
            "limitations": ["Direction conventions must be selected for the variable: winds usually report from-direction, currents and waves often report toward-direction."],
        }

    if operation == "lag_correlation":
        left = _values(arguments, "x_values")
        right = _values(arguments, "y_values")
        if len(left) != len(right):
            raise ValueError("x_values and y_values must have equal length")
        maximum_lag = int(arguments.get("maximum_lag") or min(12, len(left) // 4))
        maximum_lag = max(0, min(maximum_lag, len(left) - 3))
        correlations = []
        for lag in range(-maximum_lag, maximum_lag + 1):
            x = left[-lag:] if lag < 0 else left[: len(left) - lag] if lag > 0 else left
            y = right[: len(right) + lag] if lag < 0 else right[lag:] if lag > 0 else right
            correlations.append({"lag_steps_y_after_x": lag, "sample_count": len(x), "correlation": _pearson(x, y)})
        valid = [item for item in correlations if item["correlation"] is not None]
        best = max(valid, key=lambda item: abs(item["correlation"])) if valid else None
        return {"operation": operation, "results": {"count": len(left), "maximum_lag": maximum_lag, "best_absolute_correlation": best, "correlations": correlations}, "method": "Pearson correlation on overlapping pairs at each integer lag.", "limitations": ["Multiple lags inflate false-positive risk; autocorrelation, common forcing and irregular sampling can create spurious peaks. Correlation is not causation."]}

    if operation == "anomaly_detection":
        values = _values(arguments, "values")
        baseline = _values(arguments, "baseline_values") if arguments.get("baseline_values") is not None else values
        threshold = float(arguments.get("z_threshold") or 3.0)
        median = statistics.median(baseline)
        mad = statistics.median([abs(value - median) for value in baseline])
        robust_scale = 1.4826 * mad
        mean = statistics.fmean(baseline)
        standard_deviation = statistics.pstdev(baseline)
        candidates = []
        for index, value in enumerate(values):
            robust_z = (value - median) / robust_scale if robust_scale > 0 else None
            z_score = (value - mean) / standard_deviation if standard_deviation > 0 else None
            if robust_z is not None and abs(robust_z) >= threshold:
                candidates.append({"index": index, "value": value, "robust_z_score": robust_z, "z_score": z_score})
        return {"operation": operation, "results": {"count": len(values), "baseline_count": len(baseline), "baseline_median": median, "median_absolute_deviation": mad, "robust_scale": robust_scale, "baseline_mean": mean, "baseline_standard_deviation": standard_deviation, "z_threshold": threshold, "candidate_count": len(candidates), "candidates": candidates}, "method": "Median/MAD robust z-score with the classical z-score retained for comparison.", "limitations": ["Candidates require persistence, spatial coherence and independent validation; this diagnostic is not an event confirmation or official warning."]}

    raise ValueError(f"Unsupported ocean-statistics operation: {operation}")
