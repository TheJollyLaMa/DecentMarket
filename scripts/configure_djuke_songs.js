// Registers DecentBusking playlist songs on DJuke in batched admin multicalls.
// Dry-run by default; set CONFIRM_CONFIGURE=yes to broadcast.
//   DJUKE_ADDRESS=0x... DBUSK_SONGS=path/to/djuke-songs.json npx hardhat run scripts/configure_djuke_songs.js --network base
const fs = require("fs");
const { ethers, network } = require("hardhat");

const BATCH_SIZE = Number(process.env.DJUKE_BATCH_SIZE || 25);

async function main() {
  const [admin] = await ethers.getSigners();
  if (Number((await ethers.provider.getNetwork()).chainId) !== 8453) throw new Error("DJuke songs must be configured on Base");
  const address = process.env.DJUKE_ADDRESS;
  if (!ethers.isAddress(address || "")) throw new Error("Set DJUKE_ADDRESS");
  const songs = JSON.parse(fs.readFileSync(process.env.DBUSK_SONGS, "utf8")).songs;
  if (!Array.isArray(songs) || !songs.length) throw new Error("No songs to configure");
  const djuke = await ethers.getContractAt("DecentJukeBox_v0_1", address, admin);
  if (!(await djuke.hasRole(await djuke.DEFAULT_ADMIN_ROLE(), admin.address))) throw new Error("Signer is not the DJuke admin");

  const pending = [];
  for (const song of songs) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(song.songId) || !song.audioURI?.startsWith("ipfs://")) throw new Error("Invalid song entry");
    const current = await djuke.getSong(song.songId);
    if (current.audioURI && current.audioURI !== song.audioURI) throw new Error(`Song ${song.trackId} already registered with different audio`);
    const same = current.audioURI === song.audioURI && current.enabled &&
      JSON.stringify(current.recipients.map(value => value.toLowerCase())) === JSON.stringify(song.recipients.map(value => value.toLowerCase())) &&
      JSON.stringify(current.sharesBps.map(Number)) === JSON.stringify(song.sharesBps);
    if (!same) pending.push(song);
  }
  console.log(`${songs.length} songs; ${pending.length} need configuration in ${Math.ceil(pending.length / BATCH_SIZE)} transaction(s).`);
  if (network.name === "base" && process.env.CONFIRM_CONFIGURE !== "yes") {
    console.log("Dry run complete. Re-run with CONFIRM_CONFIGURE=yes to broadcast.");
    return;
  }
  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const calls = pending.slice(start, start + BATCH_SIZE).map(song => djuke.interface.encodeFunctionData("configureSong",
      [song.songId, song.audioURI, song.recipients, song.sharesBps]));
    const tx = await djuke.multicall(calls);
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error(`Batch failed: ${tx.hash}`);
    console.log(`Configured ${Math.min(start + BATCH_SIZE, pending.length)}/${pending.length} — ${tx.hash}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
