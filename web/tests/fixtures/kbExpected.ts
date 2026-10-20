// web/tests/fixtures/kbExpected.ts
// Cluster slug → article slugs. Extended by every cluster task; kbContent.test.ts enforces exact match.
export const EXPECTED_KB: Record<string, string[]> = {
  bills: ["01-tariff-tiers", "02-peak-hours", "03-reading-your-bill", "04-gas-tariff", "05-smart-prepaid-meter", "06-bill-spike-troubleshooting"],
  cooling: ["01-ac-savings", "02-cooler-comparison", "03-buying-ac", "04-natural-ventilation", "05-summer-peak-readiness"],
  heating: ["01-boiler-thermostat", "02-boiler-service", "03-radiator-balancing", "04-room-heaters", "05-floor-heating", "06-smart-thermostats"],
  "hot-water": ["01-water-heater"],
  kitchen: ["01-cooking-safety"],
  appliances: ["01-refrigerator-appliances", "02-standby-power"],
  lighting: ["01-lighting"],
  envelope: ["01-insulation"],
  solar: [],
  safety: [],
  behavior: ["01-seasonal-priorities", "02-priority-actions"],
};
