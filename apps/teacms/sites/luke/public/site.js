const menu = document.querySelector(".site-menu");
if (menu) {
  const desktop = matchMedia("(min-width: 768px)");
  const sync = () => {
    menu.open = desktop.matches;
  };
  sync();
  desktop.addEventListener("change", sync);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !desktop.matches && menu.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
}
