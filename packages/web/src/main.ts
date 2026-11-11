import { initAnalytics } from "./analytics.ts";

initAnalytics();

const year = document.getElementById("footer-year");
if (year) year.textContent = String(new Date().getFullYear());

await import("./office.js");
const { setupMachines } = await import("./machines.ts");
setupMachines();
