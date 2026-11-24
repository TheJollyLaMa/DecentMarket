const { expect } = require('chai');
const { ethers } = require('hardhat');

// Mirrors js/song-split-wallet.mjs in DecentBusking: predicts the wallet without an RPC read.
function predictWallet(factory, implementation, recipients, shares) {
  const salt = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address[]', 'uint16[]'], [recipients, shares]));
  const initCode = `0x3d602d80600a3d3981f3363d3d373d3d3d363d73${implementation.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
  return ethers.getCreate2Address(factory, salt, ethers.keccak256(initCode));
}

describe('DecentSongSplitWallets v0.1', function () {
  let factory, usdc, admin, audio, video, other, payer;

  beforeEach(async function () {
    [admin, audio, video, other, payer] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory('MockBookingToken')).deploy(6);
    factory = await (await ethers.getContractFactory('DecentSongSplitWalletFactory_v0_1')).deploy(admin.address);
    await usdc.mint(payer.address, 10_000_000n);
  });

  const create = async (recipients, shares) => {
    const address = await factory.walletFor(recipients, shares);
    await factory.connect(other).createWallet(recipients, shares);
    return ethers.getContractAt('DecentSongSplitWallet_v0_1', address);
  };

  it('predicts each wallet off-chain, creates it idempotently and keeps the split readable', async function () {
    const recipients = [audio.address, video.address];
    const predicted = predictWallet(factory.target, await factory.implementation(), recipients, [5000, 5000]);
    expect(await factory.walletFor(recipients, [5000, 5000])).to.equal(predicted);
    await expect(factory.createWallet(recipients, [5000, 5000])).to.emit(factory, 'WalletCreated');
    await expect(factory.createWallet(recipients, [5000, 5000])).not.to.emit(factory, 'WalletCreated');
    expect(await factory.isWallet(predicted)).to.equal(true);
    const wallet = await ethers.getContractAt('DecentSongSplitWallet_v0_1', predicted);
    expect(await wallet.split()).to.deep.equal([recipients, [5000n, 5000n]]);
    expect(await factory.walletFor(recipients, [6000, 4000])).not.to.equal(predicted);
    expect(await factory.walletFor([video.address, audio.address], [5000, 5000])).not.to.equal(predicted);
    await expect(wallet.initialize([other.address], [10000])).to.be.revertedWithCustomError(wallet, 'AlreadyInitialized');
    const implementation = await ethers.getContractAt('DecentSongSplitWallet_v0_1', await factory.implementation());
    await expect(implementation.initialize([other.address], [10000])).to.be.revertedWithCustomError(wallet, 'AlreadyInitialized');
  });

  it('accepts exactly the splits DJuke accepts', async function () {
    const bad = [
      [[], []],
      [[audio.address], [5000]],
      [[audio.address, video.address], [5000]],
      [[audio.address, video.address], [5000, 4999]],
      [[audio.address, video.address], [10000, 0]],
      [[audio.address, audio.address], [5000, 5000]],
      [Array.from({ length: 17 }, (_, i) => ethers.getAddress(`0x${(i + 1).toString(16).padStart(40, '0')}`)), Array(17).fill(588)],
    ];
    for (const [recipients, shares] of bad) {
      await expect(factory.createWallet(recipients, shares)).to.be.revertedWithCustomError(factory, 'InvalidSplit');
    }
    await expect(factory.createWallet([ethers.ZeroAddress, audio.address], [5000, 5000]))
      .to.be.revertedWithCustomError(factory, 'InvalidRecipient');
    await create([audio.address], [10000]);
  });

  it('lets anyone push a payment to the owners by share, with the remainder to the last owner', async function () {
    const wallet = await create([audio.address, video.address, other.address], [7000, 2000, 1000]);
    await usdc.connect(payer).transfer(wallet.target, 1_000_001n);
    const tx = wallet.connect(payer).distribute(usdc.target);
    await expect(tx).to.emit(wallet, 'Distributed').withArgs(usdc.target, 1_000_001n);
    await expect(tx).to.emit(wallet, 'Paid').withArgs(usdc.target, other.address, 100_001n);
    await expect(tx).to.changeTokenBalances(usdc, [audio, video, other, wallet], [700_000n, 200_000n, 100_001n, -1_000_001n]);
    await expect(wallet.distribute(usdc.target)).to.be.revertedWithCustomError(wallet, 'NothingToDistribute');
  });

  it('lets only the factory owner recover stuck assets, following ownership transfers', async function () {
    const wallet = await create([audio.address, video.address], [5000, 5000]);
    await usdc.connect(payer).transfer(wallet.target, 3n);
    await expect(wallet.connect(audio).recover(usdc.target, audio.address, 3n)).to.be.revertedWithCustomError(wallet, 'NotOwner');
    await expect(wallet.recover(usdc.target, ethers.ZeroAddress, 3n)).to.be.revertedWithCustomError(wallet, 'InvalidRecipient');
    await expect(wallet.recover(usdc.target, other.address, 2n)).to.changeTokenBalances(usdc, [wallet, other], [-2n, 2n]);
    await factory.transferOwnership(video.address);
    await factory.connect(video).acceptOwnership();
    await expect(wallet.recover(usdc.target, admin.address, 1n)).to.be.revertedWithCustomError(wallet, 'NotOwner');
    await expect(wallet.connect(video).recover(usdc.target, video.address, 1n)).to.changeTokenBalance(usdc, video, 1n);
  });
});
