import fs from "node:fs";
import { z } from "zod";
import { ingestSchema } from "../lib/api/ingest";

fs.writeFileSync(
  new URL("../docs/ingest.schema.json", import.meta.url),
  JSON.stringify(z.toJSONSchema(ingestSchema, { io: "input" }), null, 2) + "\n",
);
