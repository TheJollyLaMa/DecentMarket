const fs = require("node:fs");
const path = require("node:path");
const solc = require("solc");
const { ethers } = require("hardhat");

const ADDRESS = "0x5d07489163feBCdB39C9F579CCC36dff5A067FF9";
const COMPILER = "0.8.26";

function compile() {
  if (!solc.version().startsWith(`${COMPILER}+`)) throw new Error(`Expected solc ${COMPILER}; found ${solc.version()}`);
  const sources = {};
  for (const version of ["v0.1", "v0.2", "v0.3"]) {
    const filename = `DecentJukeBox_${version}.sol`;
    sources[`contracts/${filename}`] = { content: fs.readFileSync(path.join(__dirname, `../contracts/djuke/live/${filename}`), "utf8") };
  }
  const input = { language: "Solidity", sources, settings: {
    optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun",
    outputSelection: { "contracts/DecentJukeBox_v0.3.sol": { "DecentJukeBox_v0_3": ["evm.deployedBytecode"] } },
  } };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import(importPath) {
    try { return { contents: fs.readFileSync(path.join(__dirname, "../node_modules", importPath), "utf8") }; }
    catch { return { error: `Missing compiler import ${importPath}` }; }
  } }));
  const errors = (output.errors || []).filter(error => error.severity === "error");
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join("\n"));
  return output.contracts["contracts/DecentJukeBox_v0.3.sol"].DecentJukeBox_v0_3.evm.deployedBytecode;
}

function mask(hex, immutableReferences) {
  const bytes = Buffer.from(hex, "hex");
  for (const ranges of Object.values(immutableReferences || {})) for (const { start, length } of ranges) bytes.fill(0, start, start + length);
  return bytes;
}

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 8453n) throw new Error("Run on a Base fork configured by BASE_FORK_RPC");
  const compiled = compile();
  const live = await ethers.provider.getCode(ADDRESS);
  if (live === "0x") throw new Error(`No code at ${ADDRESS}`);
  const onchain = live.slice(2);
  const matches = onchain.length === compiled.object.length && mask(onchain, compiled.immutableReferences).equals(
    mask(compiled.object, compiled.immutableReferences));
  console.log(JSON.stringify({ address: ADDRESS, compiler: `${solc.version()}`, optimizerRuns: 200,
    viaIR: true, evmVersion: "cancun", onchainRuntimeBytes: onchain.length / 2,
    compiledRuntimeBytes: compiled.object.length / 2,
    immutableRangesMasked: Object.values(compiled.immutableReferences || {}).flat().length, matches,
    note: "Compares every runtime byte except constructor-patched immutable worker and gas-cap values; metadata is included." }, null, 2));
  if (!matches) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
