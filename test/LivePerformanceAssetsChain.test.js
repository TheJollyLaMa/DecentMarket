const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('LivePerformanceAssetsEscrow chain gate', function () {
  it('rejects deployment outside Base', async function () {
    if ((await ethers.provider.getNetwork()).chainId === 8453n) this.skip();
    const [admin] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory('MockBookingToken')).deploy(6);
    const factory = await ethers.getContractFactory('LivePerformanceAssetsEscrow');
    await expect(factory.deploy(admin.address, token.target)).to.be.revertedWithCustomError(factory, 'InvalidBooking');
  });
});
