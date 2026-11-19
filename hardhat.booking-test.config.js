const config = require('./hardhat.config');
config.networks.hardhat = { chainId: 8453, hardfork: 'cancun' };
module.exports = config;
