// Exports DecentNFT, DJuke and DeVert ABIs after `npx hardhat compile`.
const fs = require("fs");
const path = require("path");

const contracts = [
  ["LivePerformanceEscrow.sol", "LivePerformanceEscrow", "LivePerformanceEscrow.json"],
  ["LivePerformanceEscrow.sol", "LivePerformanceEscrow", "LivePerformanceEscrow.json"],
  ["DecentNFT_v0.3.sol", "DecentNFT_v0_3", "DecentNFT_v0.3.json"],
  ["DecentJukeBox_v0.1.sol", "DecentJukeBox_v0_1", "DecentJukeBox_v0.1.json"],
  ["DecentJukeBox_v0.2.sol", "DecentJukeBox_v0_2", "DecentJukeBox_v0.2.json"],
  ["DeVert_v0.1.sol", "DeVert_v0_1", "DeVert_v0.1.json"],
  ["DeVertQueue_v0.1.sol", "DeVertQueue_v0_1", "DeVertQueue_v0.1.json"],
  ["DeVertQueue_v0.2.sol", "DeVertQueue_v0_2", "DeVertQueue_v0.2.json"],
];
for (const [source, name, output] of contracts) {
  const artifact = path.join(__dirname, `../artifacts/contracts/${source}/${name}.json`);
  if (!fs.existsSync(artifact)) throw new Error(`Missing ${artifact}; run npx hardhat compile`);
  const target = path.join(__dirname, "../abis", output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(JSON.parse(fs.readFileSync(artifact, "utf8")).abi, null, 2) + "\n");
  console.log("ABI exported to", target);
}
