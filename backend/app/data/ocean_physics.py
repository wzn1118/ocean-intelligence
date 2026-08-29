from __future__ import annotations

import math
from typing import Any


EARTH_ROTATION_RATE = 7.2921159e-5  # rad s-1
EARTH_MEAN_RADIUS = 6_371_000.0  # m
STANDARD_GRAVITY = 9.80665  # m s-2


def _finite(arguments: dict[str, Any], name: str) -> float:
    value = float(arguments[name])
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite")
    return value


def _positive(arguments: dict[str, Any], name: str) -> float:
    value = _finite(arguments, name)
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def _optional_positive(arguments: dict[str, Any], name: str, default: float) -> float:
    if arguments.get(name) is None:
        return default
    return _positive(arguments, name)


def _require(arguments: dict[str, Any], *names: str) -> None:
    missing = [name for name in names if arguments.get(name) is None]
    if missing:
        raise ValueError(f"Missing required inputs for this diagnostic: {', '.join(missing)}")


def _rotation(latitude: float) -> dict[str, float | None]:
    radians = math.radians(latitude)
    coriolis = 2 * EARTH_ROTATION_RATE * math.sin(radians)
    beta = 2 * EARTH_ROTATION_RATE * math.cos(radians) / EARTH_MEAN_RADIUS
    inertial_seconds = 2 * math.pi / abs(coriolis) if abs(coriolis) > 1e-12 else None
    return {
        "coriolis_parameter_s-1": coriolis,
        "beta_m-1_s-1": beta,
        "inertial_period_hours": inertial_seconds / 3600 if inertial_seconds else None,
    }


def _direction_toward(eastward: float, northward: float) -> float | None:
    if math.hypot(eastward, northward) == 0:
        return None
    return math.degrees(math.atan2(eastward, northward)) % 360


def _finite_depth_wave_number(angular_frequency: float, depth: float, gravity: float) -> float:
    wave_number = max(angular_frequency**2 / gravity, angular_frequency / math.sqrt(gravity * depth))
    for _ in range(40):
        kd = wave_number * depth
        tanh_kd = math.tanh(kd)
        sech_squared = 1 / math.cosh(kd) ** 2 if kd < 350 else 0.0
        residual = gravity * wave_number * tanh_kd - angular_frequency**2
        derivative = gravity * (tanh_kd + kd * sech_squared)
        update = residual / derivative
        next_wave_number = wave_number - update
        if next_wave_number <= 0:
            next_wave_number = wave_number / 2
        if abs(next_wave_number - wave_number) <= 1e-12 * max(1.0, wave_number):
            return next_wave_number
        wave_number = next_wave_number
    return wave_number


def _drag_coefficient(speed: float) -> tuple[float, str | None]:
    if speed <= 11:
        return 1.2e-3, None
    if speed <= 25:
        return (0.49 + 0.065 * speed) * 1e-3, None
    return (0.49 + 0.065 * 25) * 1e-3, "Wind speed exceeds the nominal 25 m/s range; drag coefficient was capped at its 25 m/s value."


def calculate_ocean_physics(arguments: dict[str, Any]) -> dict[str, Any]:
    operation = str(arguments.get("operation") or "").strip()
    latitude = _finite(arguments, "latitude") if arguments.get("latitude") is not None else None
    if latitude is not None and not -90 <= latitude <= 90:
        raise ValueError("latitude must be between -90 and 90")

    if operation == "rotation":
        _require(arguments, "latitude")
        return {
            "operation": operation,
            "inputs": {"latitude_degrees_north": latitude},
            "results": _rotation(latitude),
            "equations": ["f = 2 Omega sin(latitude)", "beta = 2 Omega cos(latitude) / R", "T_inertial = 2 pi / |f|"],
            "assumptions": ["Spherical-Earth beta-plane diagnostics evaluated at the supplied latitude."],
        }

    if operation == "geostrophic_velocity":
        _require(arguments, "latitude", "sea_surface_height_gradient_east", "sea_surface_height_gradient_north")
        rotation = _rotation(latitude)
        coriolis = float(rotation["coriolis_parameter_s-1"])
        if abs(coriolis) < 1e-6:
            raise ValueError("Geostrophic velocity is ill-conditioned where |f| < 1e-6 s-1; use an equatorial dynamics treatment")
        gradient_east = _finite(arguments, "sea_surface_height_gradient_east")
        gradient_north = _finite(arguments, "sea_surface_height_gradient_north")
        gravity = _optional_positive(arguments, "gravity", STANDARD_GRAVITY)
        eastward = -(gravity / coriolis) * gradient_north
        northward = (gravity / coriolis) * gradient_east
        return {
            "operation": operation,
            "inputs": {
                "latitude_degrees_north": latitude,
                "d_ssh_dx_m_per_m": gradient_east,
                "d_ssh_dy_m_per_m": gradient_north,
            },
            "results": {
                **rotation,
                "eastward_geostrophic_velocity_m_s-1": eastward,
                "northward_geostrophic_velocity_m_s-1": northward,
                "geostrophic_speed_m_s-1": math.hypot(eastward, northward),
                "geostrophic_direction_toward_degrees_true": _direction_toward(eastward, northward),
            },
            "equations": ["u_g = -(g/f) d(SSH)/dy", "v_g = (g/f) d(SSH)/dx"],
            "assumptions": ["Hydrostatic pressure, small Rossby number, and sea-surface slope representing the pressure-gradient field."],
            "limitations": ["Not valid as a complete current estimate where tides, friction, river plumes, waves, or ageostrophic accelerations dominate."],
        }

    if operation == "wind_stress_ekman_transport":
        _require(arguments, "latitude", "eastward_wind", "northward_wind")
        rotation = _rotation(latitude)
        coriolis = float(rotation["coriolis_parameter_s-1"])
        if abs(coriolis) < 1e-6:
            raise ValueError("Classical Ekman transport is ill-conditioned where |f| < 1e-6 s-1")
        eastward_wind = _finite(arguments, "eastward_wind")
        northward_wind = _finite(arguments, "northward_wind")
        wind_speed = math.hypot(eastward_wind, northward_wind)
        air_density = _optional_positive(arguments, "air_density", 1.225)
        seawater_density = _optional_positive(arguments, "seawater_density", 1025.0)
        drag, warning = _drag_coefficient(wind_speed)
        stress_east = air_density * drag * wind_speed * eastward_wind
        stress_north = air_density * drag * wind_speed * northward_wind
        transport_east = stress_north / (seawater_density * coriolis)
        transport_north = -stress_east / (seawater_density * coriolis)
        result: dict[str, Any] = {
            "operation": operation,
            "inputs": {
                "latitude_degrees_north": latitude,
                "eastward_wind_m_s-1": eastward_wind,
                "northward_wind_m_s-1": northward_wind,
                "air_density_kg_m-3": air_density,
                "seawater_density_kg_m-3": seawater_density,
            },
            "results": {
                **rotation,
                "wind_speed_m_s-1": wind_speed,
                "drag_coefficient": drag,
                "eastward_wind_stress_N_m-2": stress_east,
                "northward_wind_stress_N_m-2": stress_north,
                "eastward_ekman_transport_m2_s-1": transport_east,
                "northward_ekman_transport_m2_s-1": transport_north,
                "ekman_transport_magnitude_m2_s-1": math.hypot(transport_east, transport_north),
                "ekman_transport_direction_toward_degrees_true": _direction_toward(transport_east, transport_north),
            },
            "equations": ["tau = rho_air C_D |U10| U10", "M_x = tau_y/(rho_0 f)", "M_y = -tau_x/(rho_0 f)"],
            "assumptions": ["Steady, vertically integrated classical Ekman balance with uniform reference density."],
            "limitations": ["Does not resolve Ekman-layer depth, vertical shear, coastal boundary constraints, wave-modified stress, or rapidly varying winds."],
        }
        if warning:
            result["warnings"] = [warning]
        return result

    if operation == "coastal_upwelling_transport":
        _require(arguments, "latitude", "eastward_wind_stress", "northward_wind_stress", "offshore_direction_degrees")
        rotation = _rotation(latitude)
        coriolis = float(rotation["coriolis_parameter_s-1"])
        if abs(coriolis) < 1e-6:
            raise ValueError("Classical coastal Ekman transport is ill-conditioned where |f| < 1e-6 s-1")
        stress_east = _finite(arguments, "eastward_wind_stress")
        stress_north = _finite(arguments, "northward_wind_stress")
        offshore_direction = _finite(arguments, "offshore_direction_degrees") % 360
        density = _optional_positive(arguments, "seawater_density", 1025.0)
        transport_east = stress_north / (density * coriolis)
        transport_north = -stress_east / (density * coriolis)
        offshore_radians = math.radians(offshore_direction)
        offshore_transport = transport_east * math.sin(offshore_radians) + transport_north * math.cos(offshore_radians)
        alongshore_transport = transport_east * math.cos(offshore_radians) - transport_north * math.sin(offshore_radians)
        return {
            "operation": operation,
            "inputs": {
                "latitude_degrees_north": latitude,
                "eastward_wind_stress_N_m-2": stress_east,
                "northward_wind_stress_N_m-2": stress_north,
                "offshore_direction_degrees_true": offshore_direction,
                "seawater_density_kg_m-3": density,
            },
            "results": {
                **rotation,
                "eastward_ekman_transport_m2_s-1": transport_east,
                "northward_ekman_transport_m2_s-1": transport_north,
                "offshore_ekman_transport_m2_s-1_positive_offshore": offshore_transport,
                "alongshore_ekman_transport_m2_s-1_positive_90deg_clockwise_from_offshore": alongshore_transport,
                "upwelling_favorable_surface_transport_candidate": offshore_transport > 0,
            },
            "equations": ["M_E = tau_y/(rho f)", "M_N = -tau_x/(rho f)", "M_off = M_E sin(theta_off) + M_N cos(theta_off)"],
            "reference_basis": "Stewart, Introduction to Physical Oceanography, chapter 9 (textbook pp. 127-145).",
            "limitations": ["Positive offshore surface-layer transport is only an upwelling-favorable candidate. Coastline curvature, shelf geometry, stratification, bottom stress, transient response and alongshore pressure gradients are not resolved."],
        }

    if operation == "deep_water_wave_energy_flux":
        _require(arguments, "significant_wave_height", "energy_period")
        height = _positive(arguments, "significant_wave_height")
        period = _positive(arguments, "energy_period")
        density = _optional_positive(arguments, "seawater_density", 1025.0)
        gravity = _optional_positive(arguments, "gravity", STANDARD_GRAVITY)
        energy = density * gravity * height**2 / 16
        group_velocity = gravity * period / (4 * math.pi)
        wavelength = gravity * period**2 / (2 * math.pi)
        flux = energy * group_velocity
        depth = float(arguments["water_depth"]) if arguments.get("water_depth") is not None else None
        deep_water_ratio = depth / wavelength if depth is not None else None
        warnings = []
        if deep_water_ratio is not None and deep_water_ratio <= 0.5:
            warnings.append("h/L <= 0.5, so the deep-water energy-flux approximation is not valid; use finite-depth dispersion and group velocity.")
        return {
            "operation": operation,
            "inputs": {
                "significant_wave_height_m": height,
                "energy_period_s": period,
                "seawater_density_kg_m-3": density,
                "water_depth_m": depth,
            },
            "results": {
                "wave_energy_density_J_m-2": energy,
                "deep_water_group_velocity_m_s-1": group_velocity,
                "deep_water_wavelength_m": wavelength,
                "wave_energy_flux_W_m-1": flux,
                "wave_energy_flux_kW_m-1": flux / 1000,
                "depth_to_wavelength_ratio": deep_water_ratio,
            },
            "equations": ["E = rho g Hs^2 / 16", "C_g = g T_e / (4 pi)", "P = E C_g"],
            "assumptions": ["Linear, irregular, deep-water waves and energy period Te."],
            "warnings": warnings,
        }

    if operation == "stratification":
        _require(arguments, "upper_density", "lower_density", "vertical_separation")
        upper = _positive(arguments, "upper_density")
        lower = _positive(arguments, "lower_density")
        separation = _positive(arguments, "vertical_separation")
        reference = _optional_positive(arguments, "seawater_density", (upper + lower) / 2)
        gravity = _optional_positive(arguments, "gravity", STANDARD_GRAVITY)
        density_gradient = (lower - upper) / separation
        buoyancy_frequency_squared = gravity * density_gradient / reference
        buoyancy_frequency = math.sqrt(buoyancy_frequency_squared) if buoyancy_frequency_squared > 0 else None
        return {
            "operation": operation,
            "inputs": {
                "upper_density_kg_m-3": upper,
                "lower_density_kg_m-3": lower,
                "positive_downward_separation_m": separation,
                "reference_density_kg_m-3": reference,
            },
            "results": {
                "density_gradient_kg_m-4": density_gradient,
                "brunt_vaisala_frequency_squared_s-2": buoyancy_frequency_squared,
                "brunt_vaisala_frequency_s-1": buoyancy_frequency,
                "buoyancy_period_minutes": (2 * math.pi / buoyancy_frequency / 60) if buoyancy_frequency else None,
                "static_stability": "stable" if buoyancy_frequency_squared > 0 else "neutral" if buoyancy_frequency_squared == 0 else "unstable",
            },
            "equations": ["N^2 = (g/rho_0) d(rho)/d(depth), with depth positive downward"],
            "limitations": ["Density must be potential density referenced consistently; a two-level estimate cannot resolve thin layers or overturns."],
        }

    if operation == "thermal_wind_shear":
        _require(arguments, "latitude", "density_gradient_east", "density_gradient_north")
        rotation = _rotation(latitude)
        coriolis = float(rotation["coriolis_parameter_s-1"])
        if abs(coriolis) < 1e-6:
            raise ValueError("Thermal-wind shear is ill-conditioned where |f| < 1e-6 s-1")
        density_gradient_east = _finite(arguments, "density_gradient_east")
        density_gradient_north = _finite(arguments, "density_gradient_north")
        reference = _optional_positive(arguments, "seawater_density", 1025.0)
        gravity = _optional_positive(arguments, "gravity", STANDARD_GRAVITY)
        eastward_shear = -(gravity / (reference * coriolis)) * density_gradient_north
        northward_shear = (gravity / (reference * coriolis)) * density_gradient_east
        return {
            "operation": operation,
            "inputs": {
                "latitude_degrees_north": latitude,
                "d_density_dx_kg_m-4": density_gradient_east,
                "d_density_dy_kg_m-4": density_gradient_north,
                "reference_density_kg_m-3": reference,
            },
            "results": {
                **rotation,
                "eastward_vertical_shear_s-1": eastward_shear,
                "northward_vertical_shear_s-1": northward_shear,
                "vertical_shear_magnitude_s-1": math.hypot(eastward_shear, northward_shear),
            },
            "equations": ["du_g/dz = -(g/(rho_0 f)) d(rho)/dy", "dv_g/dz = (g/(rho_0 f)) d(rho)/dx"],
            "assumptions": ["Hydrostatic and geostrophic balance, consistent potential-density reference, z positive upward."],
        }

    if operation == "scale_analysis":
        _require(arguments, "latitude", "velocity_scale", "horizontal_length_scale")
        velocity = _positive(arguments, "velocity_scale")
        length = _positive(arguments, "horizontal_length_scale")
        rotation = _rotation(latitude)
        coriolis = abs(float(rotation["coriolis_parameter_s-1"]))
        if coriolis < 1e-8:
            raise ValueError("Mid-latitude Rossby scaling is not meaningful at the equator")
        rossby = velocity / (coriolis * length)
        results: dict[str, Any] = {**rotation, "rossby_number": rossby}
        equations = ["Ro = U/(|f| L)"]
        if arguments.get("buoyancy_frequency") is not None and arguments.get("vertical_scale") is not None:
            buoyancy = _positive(arguments, "buoyancy_frequency")
            vertical = _positive(arguments, "vertical_scale")
            internal_speed = buoyancy * vertical
            radius = internal_speed / coriolis
            results.update({
                "stratified_froude_number": velocity / internal_speed,
                "internal_wave_speed_scale_m_s-1": internal_speed,
                "baroclinic_radius_scale_m": radius,
                "burger_number": (radius / length) ** 2,
            })
            equations.extend(["Fr = U/(N H)", "R_d = N H/|f|", "Bu = (R_d/L)^2"])
        if arguments.get("reduced_gravity") is not None and arguments.get("vertical_scale") is not None:
            reduced_gravity = _positive(arguments, "reduced_gravity")
            vertical = _positive(arguments, "vertical_scale")
            gravity_wave_speed = math.sqrt(reduced_gravity * vertical)
            results.update({
                "reduced_gravity_wave_speed_m_s-1": gravity_wave_speed,
                "reduced_gravity_froude_number": velocity / gravity_wave_speed,
                "reduced_gravity_radius_m": gravity_wave_speed / coriolis,
            })
            equations.extend(["c = sqrt(g' H)", "Fr_g = U/c", "R_d = c/|f|"])
        return {
            "operation": operation,
            "inputs": {
                "latitude_degrees_north": latitude,
                "velocity_scale_m_s-1": velocity,
                "horizontal_length_scale_m": length,
                "vertical_scale_m": arguments.get("vertical_scale"),
                "buoyancy_frequency_s-1": arguments.get("buoyancy_frequency"),
                "reduced_gravity_m_s-2": arguments.get("reduced_gravity"),
            },
            "results": results,
            "equations": equations,
            "interpretation": {
                "rossby_regime": "rotation-dominated" if rossby < 0.1 else "mixed rotational/advective" if rossby < 1 else "advection/acceleration important",
            },
            "limitations": ["Scale choices must come from the analysed feature, not arbitrary domain dimensions; nondimensional thresholds are diagnostic rather than proof of a balance."],
        }

    if operation == "gradient_richardson_number":
        _require(arguments, "buoyancy_frequency", "eastward_shear", "northward_shear")
        buoyancy = _positive(arguments, "buoyancy_frequency")
        eastward_shear = _finite(arguments, "eastward_shear")
        northward_shear = _finite(arguments, "northward_shear")
        shear_squared = eastward_shear**2 + northward_shear**2
        if shear_squared == 0:
            richardson = math.inf
        else:
            richardson = buoyancy**2 / shear_squared
        reynolds = _positive(arguments, "reynolds_number") if arguments.get("reynolds_number") is not None else None
        shear_candidate = richardson < 0.25
        warnings = []
        if shear_candidate and reynolds is None:
            warnings.append("Ri < 0.25 is a shear-instability candidate, but turbulence also requires sufficiently large Reynolds number and suitable flow structure.")
        return {
            "operation": operation,
            "inputs": {
                "buoyancy_frequency_s-1": buoyancy,
                "eastward_vertical_shear_s-1": eastward_shear,
                "northward_vertical_shear_s-1": northward_shear,
                "reynolds_number": reynolds,
            },
            "results": {
                "vertical_shear_squared_s-2": shear_squared,
                "gradient_richardson_number": richardson,
                "shear_instability_candidate": shear_candidate,
                "regime": "shear may overcome stratification" if shear_candidate else "stratification dominates this bulk shear test",
            },
            "equations": ["Ri = N^2 / ((du/dz)^2 + (dv/dz)^2)"],
            "reference_basis": "Stewart, Introduction to Physical Oceanography, section 8.5 (textbook pp. 127-130).",
            "limitations": ["A bulk or finite-difference Ri does not resolve thin Kelvin-Helmholtz layers; Ri alone is not proof of turbulence."],
            "warnings": warnings,
        }

    if operation == "eady_growth_rate":
        _require(arguments, "latitude", "buoyancy_frequency", "eastward_shear", "northward_shear")
        rotation = _rotation(latitude)
        coriolis = float(rotation["coriolis_parameter_s-1"])
        if abs(coriolis) < 1e-6:
            raise ValueError("The midlatitude Eady model is ill-conditioned where |f| < 1e-6 s-1")
        buoyancy_frequency = _positive(arguments, "buoyancy_frequency")
        eastward_shear = _finite(arguments, "eastward_shear")
        northward_shear = _finite(arguments, "northward_shear")
        shear_magnitude = math.hypot(eastward_shear, northward_shear)
        growth_rate = 0.31 * abs(coriolis) * shear_magnitude / buoyancy_frequency
        results: dict[str, Any] = {
            **rotation,
            "vertical_shear_magnitude_s-1": shear_magnitude,
            "maximum_eady_growth_rate_s-1": growth_rate,
            "e_folding_time_hours": 1 / growth_rate / 3600 if growth_rate > 0 else None,
        }
        vertical_scale = _positive(arguments, "vertical_scale") if arguments.get("vertical_scale") is not None else None
        if vertical_scale is not None:
            deformation_radius = buoyancy_frequency * vertical_scale / abs(coriolis)
            results.update({
                "baroclinic_deformation_radius_m": deformation_radius,
                "estimated_fastest_growing_wavelength_m": 3.9 * deformation_radius,
            })
        return {
            "operation": operation,
            "inputs": {
                "latitude_degrees_north": latitude,
                "buoyancy_frequency_s-1": buoyancy_frequency,
                "eastward_vertical_shear_s-1": eastward_shear,
                "northward_vertical_shear_s-1": northward_shear,
                "vertical_scale_m": vertical_scale,
            },
            "results": results,
            "equations": ["sigma_max = 0.31 |f| |dU/dz| / N", "L_D = N H / |f|", "lambda_max approximately 3.9 L_D"],
            "reference_basis": "Classical Eady-model diagnostic combined with Stewart's rotation, stratification and deformation-radius framework.",
            "limitations": ["This is a local quasigeostrophic baroclinic-instability potential, not proof of eddy growth. The Eady model assumes uniform shear and stratification, hydrostatic balance, rigid boundaries and negligible beta and curvature."],
        }

    if operation == "ekman_pumping":
        _require(arguments, "latitude", "wind_stress_curl")
        rotation = _rotation(latitude)
        coriolis = float(rotation["coriolis_parameter_s-1"])
        if abs(coriolis) < 1e-6:
            raise ValueError("Ekman pumping is ill-conditioned where |f| < 1e-6 s-1")
        stress_curl = _finite(arguments, "wind_stress_curl")
        density = _optional_positive(arguments, "seawater_density", 1025.0)
        eastward_stress = _finite(arguments, "eastward_wind_stress") if arguments.get("eastward_wind_stress") is not None else None
        beta_correction = eastward_stress * float(rotation["beta_m-1_s-1"]) / coriolis**2 if eastward_stress is not None else 0.0
        interior_velocity = (stress_curl / coriolis + beta_correction) / density
        return {
            "operation": operation,
            "inputs": {
                "latitude_degrees_north": latitude,
                "wind_stress_curl_N_m-3": stress_curl,
                "eastward_wind_stress_N_m-2": eastward_stress,
                "seawater_density_kg_m-3": density,
            },
            "results": {
                **rotation,
                "beta_correction_term_N_m-3_s": beta_correction,
                "interior_vertical_velocity_at_ekman_base_m_s-1_positive_upward": interior_velocity,
                "interior_vertical_velocity_m_day-1_positive_upward": interior_velocity * 86400,
                "surface_boundary_layer_compensating_velocity_m_s-1": -interior_velocity,
            },
            "equations": ["w_base = curl(tau/(rho_0 f))", "for beta-plane: w_base = [curl(tau)/f + tau_x beta/f^2]/rho_0"],
            "reference_basis": "Stewart, Introduction to Physical Oceanography, section 9.4 (textbook pp. 145-147); sign is reported explicitly for the interior velocity at the Ekman-layer base.",
            "limitations": ["Requires spatial derivatives of wind stress, not wind speed. Coastal geometry, transient response and vertical mixing are not resolved."],
        }

    if operation == "sverdrup_transport":
        _require(arguments, "latitude", "wind_stress_curl")
        rotation = _rotation(latitude)
        beta = float(rotation["beta_m-1_s-1"])
        if abs(beta) < 1e-13:
            raise ValueError("Sverdrup transport is ill-conditioned where beta is too small")
        stress_curl = _finite(arguments, "wind_stress_curl")
        density = _optional_positive(arguments, "seawater_density", 1025.0)
        meridional_transport = stress_curl / (density * beta)
        return {
            "operation": operation,
            "inputs": {
                "latitude_degrees_north": latitude,
                "wind_stress_curl_N_m-3": stress_curl,
                "seawater_density_kg_m-3": density,
            },
            "results": {
                **rotation,
                "meridional_volume_transport_per_unit_zonal_width_m2_s-1": meridional_transport,
                "direction": "northward" if meridional_transport > 0 else "southward" if meridional_transport < 0 else "zero",
            },
            "equations": ["beta V = curl(tau)/rho_0", "V = curl(tau)/(rho_0 beta)"],
            "reference_basis": "Stewart, Introduction to Physical Oceanography, section 11.1 (textbook pp. 183-187).",
            "limitations": ["Interior, steady, large-scale wind-driven balance; not a western-boundary-current, tidal, coastal or short-window transport estimate."],
        }

    if operation == "kinematic_diagnostics":
        _require(arguments, "du_dx", "du_dy", "dv_dx", "dv_dy")
        du_dx = _finite(arguments, "du_dx")
        du_dy = _finite(arguments, "du_dy")
        dv_dx = _finite(arguments, "dv_dx")
        dv_dy = _finite(arguments, "dv_dy")
        divergence = du_dx + dv_dy
        vorticity = dv_dx - du_dy
        normal_strain = du_dx - dv_dy
        shear_strain = dv_dx + du_dy
        strain_squared = normal_strain**2 + shear_strain**2
        okubo_weiss = strain_squared - vorticity**2
        results: dict[str, Any] = {
            "horizontal_divergence_s-1": divergence,
            "relative_vorticity_s-1": vorticity,
            "normal_strain_s-1": normal_strain,
            "shear_strain_s-1": shear_strain,
            "total_strain_squared_s-2": strain_squared,
            "okubo_weiss_s-2": okubo_weiss,
            "okubo_weiss_regime": "strain-dominated" if okubo_weiss > 0 else "rotation-dominated" if okubo_weiss < 0 else "neutral",
        }
        if latitude is not None:
            results.update(_rotation(latitude))
            if arguments.get("water_depth") is not None:
                depth = _positive(arguments, "water_depth")
                results["shallow_water_potential_vorticity_m-1_s-1"] = (float(results["coriolis_parameter_s-1"]) + vorticity) / depth
        return {
            "operation": operation,
            "inputs": {
                "du_dx_s-1": du_dx,
                "du_dy_s-1": du_dy,
                "dv_dx_s-1": dv_dx,
                "dv_dy_s-1": dv_dy,
                "latitude_degrees_north": latitude,
                "water_depth_m": arguments.get("water_depth"),
            },
            "results": results,
            "equations": ["div(u) = du/dx + dv/dy", "zeta = dv/dx - du/dy", "OW = strain^2 - zeta^2", "q = (f + zeta)/H when a shallow-water layer is justified"],
            "reference_basis": "Stewart, Introduction to Physical Oceanography, chapter 12 (textbook pp. 199-215).",
            "limitations": ["Finite differences amplify grid noise; results require metric distances, documented smoothing and boundary treatment. Divergence alone is not a measured vertical velocity."],
        }

    if operation == "finite_depth_wave":
        _require(arguments, "wave_period", "water_depth")
        period = _positive(arguments, "wave_period")
        depth = _positive(arguments, "water_depth")
        gravity = _optional_positive(arguments, "gravity", STANDARD_GRAVITY)
        density = _optional_positive(arguments, "seawater_density", 1025.0)
        angular_frequency = 2 * math.pi / period
        wave_number = _finite_depth_wave_number(angular_frequency, depth, gravity)
        wavelength = 2 * math.pi / wave_number
        phase_velocity = angular_frequency / wave_number
        kd = wave_number * depth
        group_factor = 0.5 * (1 + (2 * kd / math.sinh(2 * kd) if 2 * kd < 700 else 0.0))
        group_velocity = group_factor * phase_velocity
        depth_ratio = depth / wavelength
        regime = "deep" if depth_ratio > 0.25 else "shallow" if depth_ratio < 1 / 11 else "intermediate"
        results: dict[str, Any] = {
            "angular_frequency_rad_s-1": angular_frequency,
            "wave_number_rad_m-1": wave_number,
            "wavelength_m": wavelength,
            "relative_depth_h_over_L": depth_ratio,
            "kh": kd,
            "depth_regime": regime,
            "phase_velocity_m_s-1": phase_velocity,
            "group_velocity_m_s-1": group_velocity,
            "group_to_phase_velocity_ratio": group_factor,
        }
        height = _positive(arguments, "significant_wave_height") if arguments.get("significant_wave_height") is not None else None
        if height is not None:
            energy = density * gravity * height**2 / 16
            results.update({
                "wave_energy_density_J_m-2": energy,
                "finite_depth_wave_energy_flux_W_m-1": energy * group_velocity,
                "finite_depth_wave_energy_flux_kW_m-1": energy * group_velocity / 1000,
                "significant_wave_steepness_Hs_over_L": height / wavelength,
            })
        return {
            "operation": operation,
            "inputs": {
                "wave_period_s": period,
                "water_depth_m": depth,
                "significant_wave_height_m": height,
                "seawater_density_kg_m-3": density,
            },
            "results": results,
            "equations": ["omega^2 = g k tanh(k h)", "c = omega/k", "C_g = 0.5[1 + 2kh/sinh(2kh)]c", "P = (rho g Hs^2/16) C_g"],
            "reference_basis": "Stewart, Introduction to Physical Oceanography, section 16.1 (textbook pp. 273-278).",
            "limitations": ["Linear monochromatic/representative-period theory; spectral directionality, currents, refraction, breaking and nonlinear interactions require additional data."],
        }

    if operation == "wave_current_interaction":
        _require(arguments, "wave_period", "water_depth", "current_along_wave")
        intrinsic_period = _positive(arguments, "wave_period")
        depth = _positive(arguments, "water_depth")
        current = _finite(arguments, "current_along_wave")
        gravity = _optional_positive(arguments, "gravity", STANDARD_GRAVITY)
        intrinsic_frequency = 2 * math.pi / intrinsic_period
        wave_number = _finite_depth_wave_number(intrinsic_frequency, depth, gravity)
        wavelength = 2 * math.pi / wave_number
        phase_velocity = intrinsic_frequency / wave_number
        kd = wave_number * depth
        group_factor = 0.5 * (1 + (2 * kd / math.sinh(2 * kd) if 2 * kd < 700 else 0.0))
        intrinsic_group_velocity = group_factor * phase_velocity
        absolute_frequency = intrinsic_frequency + wave_number * current
        apparent_group_velocity = intrinsic_group_velocity + current
        results: dict[str, Any] = {
            "intrinsic_angular_frequency_rad_s-1": intrinsic_frequency,
            "absolute_angular_frequency_rad_s-1": absolute_frequency,
            "wave_number_rad_m-1": wave_number,
            "wavelength_m": wavelength,
            "intrinsic_phase_velocity_m_s-1": phase_velocity,
            "intrinsic_group_velocity_m_s-1": intrinsic_group_velocity,
            "apparent_group_velocity_m_s-1": apparent_group_velocity,
            "doppler_shift_ratio_kU_over_sigma": wave_number * current / intrinsic_frequency,
            "opposing_current_blocking_candidate": apparent_group_velocity <= 0,
            "apparent_period_s": 2 * math.pi / absolute_frequency if absolute_frequency > 0 else None,
        }
        height = _positive(arguments, "significant_wave_height") if arguments.get("significant_wave_height") is not None else None
        if height is not None:
            results["significant_wave_steepness_Hs_over_L"] = height / wavelength
        return {
            "operation": operation,
            "inputs": {"intrinsic_wave_period_s": intrinsic_period, "water_depth_m": depth, "current_along_wave_m_s_positive_following": current, "significant_wave_height_m": height},
            "results": results,
            "equations": ["sigma^2 = g k tanh(kh)", "omega_absolute = sigma + kU", "C_g,absolute = C_g,intrinsic + U"],
            "reference_basis": "Linear finite-depth wave dispersion with a uniform collinear current.",
            "limitations": ["Assumes a steady, horizontally uniform current aligned with wave propagation. Refraction, current shear, directional spectra, nonlinear steepening and breaking require a spectral wave-current model. Blocking is a candidate threshold, not a navigation warning."],
        }

    if operation == "mixed_layer_heat_tendency":
        _require(arguments, "net_surface_heat_flux", "mixed_layer_depth")
        heat_flux = _finite(arguments, "net_surface_heat_flux")
        mixed_layer_depth = _positive(arguments, "mixed_layer_depth")
        density = _optional_positive(arguments, "seawater_density", 1025.0)
        heat_capacity = _optional_positive(arguments, "heat_capacity", 3990.0)
        tendency = heat_flux / (density * heat_capacity * mixed_layer_depth)
        return {
            "operation": operation,
            "inputs": {
                "net_surface_heat_flux_W_m-2_positive_into_ocean": heat_flux,
                "mixed_layer_depth_m": mixed_layer_depth,
                "seawater_density_kg_m-3": density,
                "heat_capacity_J_kg-1_K-1": heat_capacity,
            },
            "results": {
                "surface_flux_temperature_tendency_K_s-1": tendency,
                "surface_flux_temperature_tendency_K_day-1": tendency * 86400,
            },
            "equations": ["dT/dt|surface = Q_net/(rho_0 c_p h_mld)"],
            "reference_basis": "Stewart, Introduction to Physical Oceanography, chapter 5 (textbook pp. 51-72).",
            "limitations": ["This is only the surface-flux term. Horizontal/vertical advection, entrainment, penetrating shortwave radiation and mixing are omitted, so the heat budget is not closed."],
        }

    if operation == "mixed_layer_budget":
        _require(arguments, "net_surface_heat_flux", "mixed_layer_depth")
        heat_flux = _finite(arguments, "net_surface_heat_flux")
        mixed_layer_depth = _positive(arguments, "mixed_layer_depth")
        density = _optional_positive(arguments, "seawater_density", 1025.0)
        heat_capacity = _optional_positive(arguments, "heat_capacity", 3990.0)
        surface_tendency = heat_flux / (density * heat_capacity * mixed_layer_depth) * 86400
        term_names = [
            "horizontal_advection_temperature_tendency",
            "vertical_advection_temperature_tendency",
            "entrainment_temperature_tendency",
            "diffusion_temperature_tendency",
        ]
        terms = {name: _finite(arguments, name) if arguments.get(name) is not None else 0.0 for name in term_names}
        modeled_tendency = surface_tendency + sum(terms.values())
        observed = _finite(arguments, "observed_temperature_tendency") if arguments.get("observed_temperature_tendency") is not None else None
        residual = observed - modeled_tendency if observed is not None else None
        return {
            "operation": operation,
            "inputs": {
                "net_surface_heat_flux_W_m-2_positive_into_ocean": heat_flux,
                "mixed_layer_depth_m": mixed_layer_depth,
                "seawater_density_kg_m-3": density,
                "heat_capacity_J_kg-1_K-1": heat_capacity,
                **{f"{name}_K_day-1": value for name, value in terms.items()},
                "observed_temperature_tendency_K_day-1": observed,
            },
            "results": {
                "surface_flux_temperature_tendency_K_day-1": surface_tendency,
                "sum_of_supplied_budget_terms_K_day-1": modeled_tendency,
                "budget_residual_observed_minus_supplied_K_day-1": residual,
                "budget_closed_with_observation": observed is not None,
            },
            "equations": ["dT/dt = Q_net/(rho_0 c_p h_mld) + A_h + A_v + E + D + residual"],
            "reference_basis": "Mixed-layer heat conservation using Stewart chapter 5 surface-flux conventions.",
            "limitations": ["A small residual does not prove every process is represented because compensating errors are possible. Sign conventions, mixed-layer-depth criterion, time averaging and shortwave penetration must be documented."],
        }

    raise ValueError(f"Unsupported ocean-physics operation: {operation}")
