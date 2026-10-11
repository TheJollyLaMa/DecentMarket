function validateSchedulerAddress({ ethers, deployerAddress, scheduler }) {
  if (!ethers.isAddress(scheduler) || scheduler.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
    throw new Error("Set DEVERT_SCHEDULER_ADDRESS to a dedicated scheduler wallet");
  }
  if (scheduler.toLowerCase() === deployerAddress.toLowerCase()) {
    throw new Error("Use a dedicated scheduler wallet, not the owner wallet");
  }
  return scheduler;
}

function deploymentConfirmed(value) {
  return value === "yes";
}

function assertManifestAvailable(output, existsSync) {
  if (existsSync(output)) {
    throw new Error(`Deployment manifest already exists at ${output}; refusing duplicate deployment`);
  }
}

module.exports = { assertManifestAvailable, deploymentConfirmed, validateSchedulerAddress };