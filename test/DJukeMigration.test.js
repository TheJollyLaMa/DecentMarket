const { expect } = require("chai");
const { ethers } = require("hardhat");
const { validateCatalog, MigrationProvider } = require("../scripts/deploy_djuke_v02");

describe("DJuke migration catalog", function () {
  it("serializes migration RPC requests below the public provider rate limit", async function () {
    const http = require("node:http");
    const received = [];
    const server = http.createServer((request, response) => {
      let body = "";
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        received.push(Date.now());
        const payload = JSON.parse(body);
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: "0x1" }));
      });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const provider = new MigrationProvider(`http://127.0.0.1:${server.address().port}`);
    try {
      await Promise.all([provider.send("eth_blockNumber", []), provider.send("eth_blockNumber", []), provider.send("eth_blockNumber", [])]);
      expect(received.length).to.equal(3);
      expect(received[2] - received[0]).to.be.at.least(170);
    } finally {
      provider.destroy();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
  it("requires unique recording identities and exact existing recipient splits", async function () {
    const [owner] = await ethers.getSigners();
    const song = { songId: ethers.id("song"), audioURI: "ipfs://recording", recipients: [owner.address], sharesBps: [10000] };
    expect(validateCatalog([song])).to.match(/^0x[0-9a-f]{64}$/);
    expect(() => validateCatalog([song, song])).to.throw("duplicate");
    expect(() => validateCatalog([{ ...song, sharesBps: [9000] }])).to.throw("split");
    expect(() => validateCatalog([])).to.throw("size");
  });

  (process.env.BASE_FORK_RPC ? it : it.skip)("rehearses gas-funded fulfillment against Base USDC and the production fund router", async function () {
    const { network } = require("hardhat");
    await network.provider.send("evm_mine");
    const [admin, worker] = await ethers.getSigners();
    const owner = "0x807061DF657A7697c04045dA7d16D941861cAABc";
    const oldAddress = "0x153ef59a57C9A88cbB7822252B5d9D0B11E48F0E";
    const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const routerAddress = "0x8ecca903e2a6Daa8CCbB933700e4F2C58C44A4B5";
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [owner] });
    await network.provider.send("hardhat_setBalance", [owner, "0x56BC75E2D63100000"]);
    const listener = await ethers.getSigner(owner);
    const token = new ethers.Contract(usdcAddress, ["function balanceOf(address) view returns(uint256)", "function transfer(address,uint256) returns(bool)",
      "function approve(address,uint256) returns(bool)"], listener);
    if (await token.balanceOf(owner) < 250000n) {
      const issuer = await ethers.getContractAt(["function masterMinter() view returns(address)", "function configureMinter(address,uint256) returns(bool)",
        "function mint(address,uint256) returns(bool)"], usdcAddress);
      const master = await issuer.masterMinter();
      await network.provider.request({ method: "hardhat_impersonateAccount", params: [master] });
      await network.provider.send("hardhat_setBalance", [master, "0x56BC75E2D63100000"]);
      await issuer.connect(await ethers.getSigner(master)).configureMinter(admin.address, 1000000);
      await issuer.connect(admin).mint(owner, 1000000);
    }
    const jukebox = await (await ethers.getContractFactory("contracts/DecentJukeBox_v0.2.sol:DecentJukeBox_v0_2")).deploy(usdcAddress, routerAddress,
      ethers.id("dbusk-repo-dev"), ethers.id("dbusk-pinners"), admin.address, worker.address, ethers.parseEther("0.001"));
    const songId = ethers.id("fork-gas-song");
    await jukebox.configureSong(songId, "ipfs://recording", [owner], [10000]);
    await jukebox.grantRole(await jukebox.FULFILLER_ROLE(), worker.address);
    await token.approve(jukebox.target, 250000);
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 120;
    const quote = { listener: owner, songId, maxPrice: 250000, fulfillmentCostWei: 1000000, nonce: 0, deadline };
    const types = { GasQuote: [{ name: "listener", type: "address" }, { name: "songId", type: "bytes32" },
      { name: "maxPrice", type: "uint256" }, { name: "fulfillmentCostWei", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
    const signature = await worker.signTypedData({ name: "DecentJukeBox", version: "0.2", chainId: 8453, verifyingContract: jukebox.target }, types, quote);
    const beforeWorker = await ethers.provider.getBalance(worker.address);
    await jukebox.connect(listener).requestPlayWithGas(songId, 250000, 1000000, deadline, signature, { value: 2000000 });
    expect(await ethers.provider.getBalance(worker.address)).to.equal(beforeWorker + 2000000n);
    const router = new ethers.Contract(routerAddress, ["function fundBalances(bytes32,address) view returns(uint256)"], ethers.provider);
    const beforeRepo = await router.fundBalances(ethers.id("dbusk-repo-dev"), usdcAddress);
    const beforePinners = await router.fundBalances(ethers.id("dbusk-pinners"), usdcAddress);
    const receipt = await (await jukebox.connect(worker).fulfill(0, songId, 0, ethers.id("fork-played"))).wait();
    expect(receipt.gasUsed < 1000000n).to.equal(true);
    expect(await router.fundBalances(ethers.id("dbusk-repo-dev"), usdcAddress)).to.equal(beforeRepo + 5000n);
    expect(await router.fundBalances(ethers.id("dbusk-pinners"), usdcAddress)).to.equal(beforePinners + 20000n);
    expect(await jukebox.artistCredits(owner)).to.equal(225000n);
    expect(await ethers.provider.getCode(oldAddress)).to.not.equal("0x");
    await jukebox.connect(listener).withdrawArtistCredit();
    expect(await jukebox.artistCredits(owner)).to.equal(0);
  });
});