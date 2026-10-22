require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const DEPLOYER_PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.MINT_OWNER_PRIVATE_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [{
      version: "0.8.26",
      settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
    }],
    overrides: {
      "contracts/DecentJukeBox_v0.2.sol": {
        version: "0.8.26",
        settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", viaIR: true },
      },
      "contracts/DecentJukeBox_v0.3.sol": {
        version: "0.8.26",
        settings: { optimizer: { enabled: true, runs: 1 }, evmVersion: "cancun", viaIR: true },
      },
      "contracts/DJukePlaylistModule.sol": {
        version: "0.8.26",
        settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", viaIR: true },
      },
    },
  },
  networks: {
    hardhat: process.env.BASE_FORK_RPC
      ? { chainId: 8453, hardfork: "cancun", forking: { url: process.env.BASE_FORK_RPC },
          chains: { 8453: { hardforkHistory: { cancun: 0 } } } }
      : {},
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    amoy: {
      url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 80002,
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 137,
    },
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 8453,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || {
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || "",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
