import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Everything the office page draws for one machine. */
export const snapshotRpc = defineRpc({
  name: "office.snapshot",
  input: z.object({}).default({}),
  output: z.object({
    hostname: z.string(),
    collectedAt: z.number(),
    pluginVersion: z.string(),
    agents: z.array(z.record(z.string(), z.unknown())),
    labelColors: z.record(z.string(), z.string()),
  }),
});
