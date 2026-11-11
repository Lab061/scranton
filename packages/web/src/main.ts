import { initAnalytics } from "./analytics.ts";

initAnalytics();

await import("./office.js");
const { setupMachines } = await import("./machines.ts");
setupMachines();
