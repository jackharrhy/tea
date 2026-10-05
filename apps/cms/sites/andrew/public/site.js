const menu = document.querySelector(".site-menu");
if (menu) {
  const query = matchMedia("(min-width:1024px)");
  menu.open = query.matches;
  query.addEventListener("change", () => {
    menu.open = query.matches;
  });
}
