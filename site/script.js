const menuButton = document.querySelector(".menu-toggle");
const mainNavigation = document.getElementById("primary-nav");

if (menuButton && mainNavigation) {
  document.documentElement.classList.add("js-enabled");

  const setMenuOpen = (open) => {
    menuButton.setAttribute("aria-expanded", String(open));
    mainNavigation.classList.toggle("open", open);
  };

  menuButton.addEventListener("click", () => {
    setMenuOpen(menuButton.getAttribute("aria-expanded") !== "true");
  });

  mainNavigation.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) setMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      setMenuOpen(false);
      menuButton.focus();
    }
  });
}
