from __future__ import annotations

import math
import unittest

from app.data.ocean_physics import calculate_ocean_physics


class OceanPhysicsTests(unittest.TestCase):
    def test_rotation_at_twenty_degrees(self) -> None:
        result = calculate_ocean_physics({"operation": "rotation", "latitude": 20})["results"]
        self.assertAlmostEqual(result["coriolis_parameter_s-1"], 4.9881e-5, places=8)
        self.assertGreater(result["inertial_period_hours"], 34)
        self.assertLess(result["inertial_period_hours"], 36)

    def test_geostrophic_velocity_uses_correct_component_signs(self) -> None:
        result = calculate_ocean_physics({
            "operation": "geostrophic_velocity",
            "latitude": 20,
            "sea_surface_height_gradient_east": 1e-7,
            "sea_surface_height_gradient_north": 2e-7,
        })["results"]
        self.assertLess(result["eastward_geostrophic_velocity_m_s-1"], 0)
        self.assertGreater(result["northward_geostrophic_velocity_m_s-1"], 0)
        self.assertAlmostEqual(result["geostrophic_speed_m_s-1"], 0.04396, places=4)

    def test_eastward_wind_drives_southward_ekman_transport_in_northern_hemisphere(self) -> None:
        result = calculate_ocean_physics({
            "operation": "wind_stress_ekman_transport",
            "latitude": 20,
            "eastward_wind": 10,
            "northward_wind": 0,
        })["results"]
        self.assertAlmostEqual(result["eastward_ekman_transport_m2_s-1"], 0.0)
        self.assertLess(result["northward_ekman_transport_m2_s-1"], 0)
        self.assertAlmostEqual(result["ekman_transport_direction_toward_degrees_true"], 180.0)

    def test_wave_flux_reports_deep_water_validity(self) -> None:
        result = calculate_ocean_physics({
            "operation": "deep_water_wave_energy_flux",
            "significant_wave_height": 2,
            "energy_period": 8,
            "water_depth": 1000,
        })
        self.assertEqual(result["warnings"], [])
        self.assertAlmostEqual(result["results"]["wave_energy_flux_kW_m-1"], 15.69, places=2)

    def test_stratification_sign_uses_depth_positive_downward(self) -> None:
        stable = calculate_ocean_physics({
            "operation": "stratification",
            "upper_density": 1023,
            "lower_density": 1026,
            "vertical_separation": 30,
        })["results"]
        self.assertEqual(stable["static_stability"], "stable")
        self.assertGreater(stable["brunt_vaisala_frequency_squared_s-2"], 0)

    def test_scale_analysis_returns_rossby_froude_and_burger_numbers(self) -> None:
        result = calculate_ocean_physics({
            "operation": "scale_analysis",
            "latitude": 20,
            "velocity_scale": 0.5,
            "horizontal_length_scale": 100_000,
            "vertical_scale": 50,
            "buoyancy_frequency": 0.01,
        })["results"]
        self.assertAlmostEqual(result["rossby_number"], 0.1, delta=0.01)
        self.assertTrue(math.isfinite(result["stratified_froude_number"]))
        self.assertTrue(math.isfinite(result["burger_number"]))

    def test_midlatitude_balances_are_rejected_at_equator(self) -> None:
        with self.assertRaisesRegex(ValueError, "ill-conditioned"):
            calculate_ocean_physics({
                "operation": "geostrophic_velocity",
                "latitude": 0,
                "sea_surface_height_gradient_east": 1e-7,
                "sea_surface_height_gradient_north": 1e-7,
            })

    def test_gradient_richardson_number_flags_only_a_candidate(self) -> None:
        result = calculate_ocean_physics({
            "operation": "gradient_richardson_number",
            "buoyancy_frequency": 0.01,
            "eastward_shear": 0.03,
            "northward_shear": 0.0,
        })
        self.assertAlmostEqual(result["results"]["gradient_richardson_number"], 1 / 9)
        self.assertTrue(result["results"]["shear_instability_candidate"])
        self.assertTrue(result["warnings"])

    def test_positive_wind_stress_curl_gives_upward_interior_ekman_velocity(self) -> None:
        result = calculate_ocean_physics({
            "operation": "ekman_pumping",
            "latitude": 20,
            "wind_stress_curl": 1e-7,
        })["results"]
        self.assertGreater(result["interior_vertical_velocity_at_ekman_base_m_s-1_positive_upward"], 0)
        self.assertLess(result["surface_boundary_layer_compensating_velocity_m_s-1"], 0)

    def test_sverdrup_transport_preserves_curl_sign(self) -> None:
        result = calculate_ocean_physics({
            "operation": "sverdrup_transport",
            "latitude": 20,
            "wind_stress_curl": 1e-7,
        })["results"]
        self.assertGreater(result["meridional_volume_transport_per_unit_zonal_width_m2_s-1"], 0)
        self.assertEqual(result["direction"], "northward")

    def test_kinematic_diagnostics_compute_vorticity_and_divergence(self) -> None:
        result = calculate_ocean_physics({
            "operation": "kinematic_diagnostics",
            "latitude": 20,
            "water_depth": 50,
            "du_dx": 1e-5,
            "du_dy": -2e-5,
            "dv_dx": 3e-5,
            "dv_dy": -1e-5,
        })["results"]
        self.assertAlmostEqual(result["horizontal_divergence_s-1"], 0.0)
        self.assertAlmostEqual(result["relative_vorticity_s-1"], 5e-5)
        self.assertIn("shallow_water_potential_vorticity_m-1_s-1", result)

    def test_finite_depth_wave_solves_dispersion_relation(self) -> None:
        result = calculate_ocean_physics({
            "operation": "finite_depth_wave",
            "wave_period": 8,
            "water_depth": 20,
            "significant_wave_height": 2,
        })["results"]
        omega = result["angular_frequency_rad_s-1"]
        wave_number = result["wave_number_rad_m-1"]
        self.assertAlmostEqual(omega**2, 9.80665 * wave_number * math.tanh(wave_number * 20), places=10)
        self.assertEqual(result["depth_regime"], "intermediate")
        self.assertLess(result["group_velocity_m_s-1"], result["phase_velocity_m_s-1"])

    def test_mixed_layer_heat_tendency_is_only_one_budget_term(self) -> None:
        result = calculate_ocean_physics({
            "operation": "mixed_layer_heat_tendency",
            "net_surface_heat_flux": 100,
            "mixed_layer_depth": 20,
        })
        self.assertAlmostEqual(result["results"]["surface_flux_temperature_tendency_K_day-1"], 0.1056, places=4)
        self.assertIn("not closed", result["limitations"][0])

    def test_coastal_upwelling_transport_projects_onto_offshore_normal(self) -> None:
        result = calculate_ocean_physics({
            "operation": "coastal_upwelling_transport",
            "latitude": 20,
            "eastward_wind_stress": 0.1,
            "northward_wind_stress": 0.0,
            "offshore_direction_degrees": 180,
        })["results"]
        self.assertGreater(result["offshore_ekman_transport_m2_s-1_positive_offshore"], 0)
        self.assertTrue(result["upwelling_favorable_surface_transport_candidate"])

    def test_eady_growth_rate_returns_positive_timescale(self) -> None:
        result = calculate_ocean_physics({
            "operation": "eady_growth_rate",
            "latitude": 30,
            "buoyancy_frequency": 0.01,
            "eastward_shear": 0.001,
            "northward_shear": 0.0,
            "vertical_scale": 100,
        })["results"]
        self.assertGreater(result["maximum_eady_growth_rate_s-1"], 0)
        self.assertGreater(result["estimated_fastest_growing_wavelength_m"], 0)

    def test_wave_current_interaction_flags_blocking_candidate(self) -> None:
        result = calculate_ocean_physics({
            "operation": "wave_current_interaction",
            "wave_period": 8,
            "water_depth": 20,
            "current_along_wave": -10,
        })["results"]
        self.assertTrue(result["opposing_current_blocking_candidate"])
        self.assertLessEqual(result["apparent_group_velocity_m_s-1"], 0)

    def test_mixed_layer_budget_returns_observed_residual(self) -> None:
        result = calculate_ocean_physics({
            "operation": "mixed_layer_budget",
            "net_surface_heat_flux": 100,
            "mixed_layer_depth": 20,
            "horizontal_advection_temperature_tendency": -0.02,
            "observed_temperature_tendency": 0.08,
        })["results"]
        self.assertTrue(result["budget_closed_with_observation"])
        self.assertAlmostEqual(result["budget_residual_observed_minus_supplied_K_day-1"], -0.0056, places=4)


if __name__ == "__main__":
    unittest.main()
