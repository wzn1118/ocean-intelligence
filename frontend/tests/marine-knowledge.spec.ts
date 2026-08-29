import { expect, test } from "@playwright/test";

const APP_URL = process.env.OCEAN_APP_URL ?? "http://127.0.0.1:5173/";

test("clicking the sea reveals a traceable offline Wikipedia translation", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ocean-ui-explorer-guide-seen", JSON.stringify(false));
  });
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "marine-knowledge-test",
          email: "marine-knowledge@local.test",
          display_name: "海域百科测试",
          created_at: new Date().toISOString(),
        },
        csrf_token: "marine-knowledge-test-token",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    });
  });
  await page.route("**/api/marine/context?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query_point: { longitude: 130, latitude: -2.5 }, sea_name: "塞兰海", sea_name_en: "Seram Sea",
        display_name: "塞兰海", region_codes: ["71"], region_label: "71 · 塞兰海",
        place_type: "边缘海", place_source: "Marine Regions", place_source_url: "https://www.marineregions.org/",
        confidence: "high", matched_places: [], fisheries: [{
          scientific_name: "Thunnus albacares", scientific_name_authorship: "(Bonnaterre, 1788)",
          chinese_name: "黄鳍金枪鱼", common_name: "Yellowfin tuna", english_name: "Yellowfin tuna",
          taxon_rank: "species", taxonomic_status: "accepted", taxon_class: "Actinopterygii",
          taxon_order: "Scombriformes", family: "Scombridae", taxon_group: "鱼类", aphia_id: 127029,
          fao_alpha3_code: "YFT", fao_isscaap_group: "36", fao_asfis_version: "2026-1",
          fao_fishstat_data: true, fishery_relevance: "fao_fishstat", evidence_count: 12,
          dataset_count: 3, first_year: 2018, latest_year: 2025, minimum_distance_km: 18.4,
          evidence_strength: "high", evidence_kind: "nearby_observation", source_url: "https://obis.org/",
          asfis_source_url: "https://www.fao.org/fishery/en/collection/asfis/", worms_source_url: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=127029",
        }], fisheries_total_records: 12, fisheries_species_count: 1,
        fisheries_scanned_records: 0, biodiversity_total_records: 0, fisheries_results_complete: true,
        fisheries_search_radius_km: 100, fisheries_radius_degrees: 1, fisheries_source: "OBIS + FAO ASFIS + WoRMS",
        fisheries_source_url: "https://api.obis.org/", fisheries_asfis_version: "2026-1",
        fisheries_asfis_source_url: "https://www.fao.org/fishery/en/collection/asfis/",
        fao_area: { code: "61", name: "西北太平洋", name_en: "Pacific, Northwest", source_url: "https://www.fao.org/fishery/en/area/61" },
        fetched_at: new Date().toISOString(), errors: [], caveats: ["分布记录不等于实时渔获量。"],
        cache: { state: "fresh", age_seconds: 0, ttl_seconds: 21600 },
      }),
    });
  });
  await page.route("**/api/marine/knowledge?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query_point: { longitude: 130, latitude: -2.5 }, sea_name: "塞兰海", sea_name_en: "Seram Sea",
        display_name: "塞兰海", place_type: "海", parent_ocean: "太平洋",
        fao_area: { code: "61", name: "西北太平洋", name_en: "Pacific, Northwest", source_url: "https://www.fao.org/fishery/en/area/61" },
        overview: "塞兰海是印度尼西亚岛屿之间的一片海域。",
        live_summary: null,
        encyclopedia: {
          title: "塞兰海", source_title: "Seram Sea", language: "zh-CN", original_language: "en",
          content_scope: "translated_introduction", translation_method: "openqi:gpt-5.6-sol",
          extract: "塞兰海是印度尼西亚散布的岛屿之间数个小型海域之一。",
          paragraphs: ["塞兰海是印度尼西亚散布的岛屿之间数个小型海域之一。它是太平洋的一部分，位于布鲁岛和塞兰岛之间。"],
          url: "https://en.wikipedia.org/wiki/Seram_Sea", page_id: 12345, revision_id: 1366627251,
          page_updated_at: "2026-08-20T04:06:46Z", snapshot_at: new Date().toISOString(),
          source_name: "维基百科中文资料", license: "CC BY-SA 4.0 / GFDL", offline: true,
        },
        historical_significance: [], human_geography: [], maritime_routes: [], coastal_livelihoods: [], marine_culture: [],
        key_terms: ["塞兰海", "Seram Sea", "太平洋"], fact_sheet: [], physical_geography: [],
        oceanographic_processes: [], ecosystems: [], learning_prompts: [],
        references: [
          { id: "marine-regions", title: "Marine Regions 海域地名", source_name: "Marine Regions", url: "https://www.marineregions.org/" },
          { id: "wikimedia-1", title: "Seram Sea", source_name: "英文维基百科", url: "https://en.wikipedia.org/wiki/Seram_Sea" },
        ],
        provider: "内置维基百科简体中文资料", live_retrieved: false, atlas_count: 813, atlas_version: "2026.08",
        retrieved_at: new Date().toISOString(), errors: [], caveats: [], cache: { state: "fresh", age_seconds: 0, ttl_seconds: 21600 },
      }),
    });
  });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".province-map-label", { hasText: "中国台湾省" })).toHaveCount(1);
  await expect(page.locator(".province-map-label", { hasText: "中国香港特别行政区" })).toHaveCount(1);
  await expect(page.locator(".province-map-label", { hasText: "中国澳门特别行政区" })).toHaveCount(1);
  await expect(page.locator(".country-map-label", { hasText: "中华人民共和国" })).toHaveCount(1);
  await expect(page.locator(".country-map-label", { hasText: "尼泊尔" })).toHaveCount(0);
  await expect(page.locator(".country-map-label", { hasText: "孟加拉国" })).toHaveCount(0);
  await expect(page.locator(".country-map-label", { hasText: "巴勒斯坦国" })).toHaveCount(1);
  await expect(page.locator(".country-map-label", { hasText: "索马里兰地区" })).toHaveCount(1);
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  const card = page.locator(".marine-knowledge-card");
  await page.waitForTimeout(1_500);
  for (const [x, y] of [[0.18, 0.72], [0.42, 0.34], [0.76, 0.72], [0.14, 0.42]]) {
    await canvas.click({ position: { x: bounds.width * x, y: bounds.height * y }, force: true });
    if (await card.count()) break;
    await page.waitForTimeout(500);
  }
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("塞兰海");
  await expect(card).toContainText("所属海洋 太平洋");
  await expect(card).toContainText("维基百科简体中文译文");
  await expect(card).toContainText("原条目：Seram Sea");
  await expect(card).toContainText("页面修订 #1,366,627,251");
  await expect(card).toContainText("位于布鲁岛和塞兰岛之间");
  await expect(card).not.toContainText("历史脉络");
  await expect(card).not.toContainText("沿岸社会");
  await expect(card).not.toContainText("航运与海上联系");
  await expect(card).toContainText("点位物种证据");
  await expect(card).toContainText("黄鳍金枪鱼（Thunnus albacares）");
  await expect(card).not.toContainText("极地鳄");
  await expect(page.locator(".marine-context-section-title")).toContainText("1/1 种");
  await expect(card).not.toContainText("具体海域档案");
  await expect(card.getByRole("link", { name: /查看原始条目/ })).toHaveAttribute("href", /en\.wikipedia\.org\/wiki\/Seram_Sea/);
});
