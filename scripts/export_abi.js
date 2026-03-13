// scripts/export_abi.js
// Exports the compiled ABI of DecentNFT_v0_2 from Hardhat artifacts to abis/.
//
// Run after `npx hardhat compile`:
//   node scripts/export_abi.js

const fs = require("fs");
const path = require("path");

const ARTIFACT_PATH = path.join(
  __dirname,
  "../artifacts/contracts/DecentNFT_v0.2.sol/DecentNFT_v0_2.json"
);
const OUTPUT_PATH = path.join(__dirname, "../abis/DecentNFT_v0.2.json");

if (!fs.existsSync(ARTIFACT_PATH)) {
  console.error("Artifact not found. Run `npx hardhat compile` first.");
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(artifact.abi, null, 2));
console.log("ABI exported to", OUTPUT_PATH);
