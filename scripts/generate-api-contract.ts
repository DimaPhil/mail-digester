import fs from "node:fs";
import { portableContract } from "../lib/api/contracts";
const path = "contracts/operations.json";
const contract = portableContract();
if (process.argv.includes("--check")) {
  if (
    !fs.existsSync(path) ||
    JSON.stringify(JSON.parse(fs.readFileSync(path, "utf8"))) !==
      JSON.stringify(contract)
  )
    throw new Error(
      "REST/CLI contract is stale. Run npm run api:contracts, commit contracts/operations.json, and update CLI/skill examples and tests.",
    );
  console.log("Generated REST/CLI contract matches runtime schemas.");
} else {
  fs.mkdirSync("contracts", { recursive: true });
  fs.writeFileSync(path, JSON.stringify(contract, null, 2) + "\n");
}
