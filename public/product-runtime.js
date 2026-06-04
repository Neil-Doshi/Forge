(() => {
  const dataNode = document.getElementById("forge-runtime-data");
  const connections = dataNode ? JSON.parse(dataNode.textContent || "[]") : [];
  const showScreen = (id) => {
    document.querySelectorAll("[data-hf-screen]").forEach((screen) => {
      screen.classList.toggle("is-active", screen.id === id);
    });
    document.querySelectorAll("[data-hf-overlay]").forEach((overlay) => {
      overlay.hidden = true;
    });
  };
  const openOverlay = (id) => {
    const overlay = document.getElementById(id);
    if (overlay) overlay.hidden = false;
  };
  const closeOverlay = (id) => {
    const overlay = document.getElementById(id);
    if (overlay) overlay.hidden = true;
  };
  for (const connection of connections) {
    const root = document.getElementById(connection.source);
    const trigger = connection.selector && root ? root.querySelector(connection.selector) : null;
    const fallback = root
      ? Array.from(root.querySelectorAll("button,a,[role='button'],[data-forge-id]")).find((element) => {
          const label = (element.textContent || element.getAttribute("aria-label") || "").trim();
          return label === connection.label;
        })
      : null;
    const element = trigger || fallback;
    if (!element) continue;
    element.addEventListener("click", (event) => {
      event.preventDefault();
      if (connection.action === "open-overlay") openOverlay(connection.target);
      else if (connection.action === "close-overlay") closeOverlay(connection.target);
      else showScreen(connection.target);
    });
  }
  document.querySelectorAll("[data-hf-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const overlay = button.closest("[data-hf-overlay]");
      if (overlay) overlay.hidden = true;
    });
  });
})();
