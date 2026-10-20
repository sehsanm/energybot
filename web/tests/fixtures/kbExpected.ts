// web/tests/fixtures/kbExpected.ts
// Cluster slug → article slugs. Extended by every cluster task; kbContent.test.ts enforces exact match.
export const EXPECTED_KB: Record<string, string[]> = {
  bills: ["01-tariff-tiers", "02-peak-hours", "03-reading-your-bill", "04-gas-tariff", "05-smart-prepaid-meter", "06-bill-spike-troubleshooting"],
  cooling: ["01-ac-savings", "02-cooler-comparison", "03-buying-ac", "04-natural-ventilation", "05-summer-peak-readiness"],
  heating: ["01-boiler-thermostat", "02-boiler-service", "03-radiator-balancing", "04-room-heaters", "05-floor-heating", "06-smart-thermostats"],
  "hot-water": ["01-water-heater", "02-solar-water-heater", "03-shower-habits", "04-showerhead-aerator"],
  kitchen: ["01-cooking-safety", "02-stove-efficiency", "03-kettle-tea", "04-washing-machines", "05-oven-use"],
  appliances: ["01-refrigerator-appliances", "02-standby-power", "03-energy-label-guide", "04-hidden-drains", "05-high-wattage-brief", "06-appliance-care"],
  lighting: ["01-lighting"],
  envelope: ["01-insulation"],
  solar: [],
  safety: [],
  behavior: ["01-seasonal-priorities", "02-priority-actions"],
};
