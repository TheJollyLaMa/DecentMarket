export async function connectW3upClient(autoConnect = false) {
  try {
    console.log("Initializing w3up client...");
    const client = await window.w3up.create();
    console.log("Client ready:", client);

    // Always check for existing credentials/spaces
    const spaces = await client.spaces();
    console.log("[W3UP] Spaces found:", spaces.map(s => s.did()));

    if (spaces && spaces.length > 0) {
      const space = spaces[0];
      await client.setCurrentSpace(space.did());
      console.log("[W3UP] Connected to space (auto-restored):", space.did());
      const ipfsIcon = document.getElementById("ipfsIcon");
      if (ipfsIcon) ipfsIcon.style.display = "inline-block";
      return {
        client,
        spaceDid: space.did(),
      };
    }

    if (!autoConnect) {
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
      console.log("[W3UP] Connected to space:", space.did());
      const ipfsIcon = document.getElementById("ipfsIcon");
      if (ipfsIcon) ipfsIcon.style.display = "inline-block";
      return {
        client,
        spaceDid: space.did(),
      };
    }

    // If autoConnect is true but no stored credentials, just return a client object to avoid null breaks
    console.warn("[W3UP] No stored credentials found for autoConnect, returning client anyway.");
    return { client, spaceDid: null };
  } catch (err) {
    console.error("Error initializing w3up client:", err);
    return null;
  }
}