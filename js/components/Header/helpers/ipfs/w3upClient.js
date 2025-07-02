const { create } = window.w3up;

export async function connectW3upClient(autoConnect = false) {
  try {
    console.log("Initializing w3up client...");
    const client = await create();
    console.log("Client ready:", client);

    // Check for existing credentials/spaces before prompting for email
    const spaces = await client.spaces();
    if (spaces && spaces.length > 0) {
      // Credentials already stored, no prompt needed
      const space = spaces[0];
      await client.setCurrentSpace(space.did());
      console.log("Connected to space (auto-restored):", space.did());
      // Reveal the IPFS icon
      const ipfsIcon = document.getElementById("ipfsIcon");
      if (ipfsIcon) ipfsIcon.style.display = "inline-block";
      return {
        client,
        spaceDid: space.did(),
      };
    }

    if (!autoConnect) {
      // Only prompt for email if not auto-connect (legacy usage)
      const email = prompt("Enter your email to login:");
      if (!email) {
        alert("Please enter a valid email to login.");
        return null;
      }
      const account = await client.login(email);
      console.log("Login successful:", account);
      if (account.plan) {
        await account.plan.wait();
        console.log("Payment plan confirmed.");
      }
      const spacesAfter = await client.spaces();
      if (!spacesAfter.length) {
        console.warn("No spaces found after login.");
        return null;
      }
      const space = spacesAfter[0];
      await client.setCurrentSpace(space.did());
      console.log("Connected to space:", space.did());
      // Reveal the IPFS icon
      const ipfsIcon = document.getElementById("ipfsIcon");
      if (ipfsIcon) ipfsIcon.style.display = "inline-block";
      return {
        client,
        spaceDid: space.did(),
      };
    } else {
      // If autoConnect is true but no stored credentials, return null
      console.warn("No stored credentials found for autoConnect.");
      return null;
    }
  } catch (err) {
    console.error("Error initializing w3up client:", err);
    return null;
  }
}