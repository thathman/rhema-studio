const docSections = [
  {
    heading: "Start here",
    pages: [
      ["index.html", "Docs home"],
      ["getting-started.html", "Getting started"],
      ["core-concepts.html", "Core concepts"],
    ],
  },
  {
    heading: "Operator pages",
    pages: [
      ["operators.html", "Operator overview"],
      ["operator-bible.html", "Bible operator"],
      ["operator-worship.html", "Worship operator"],
      ["operator-timekeeper.html", "Timekeeper"],
      ["operator-screens.html", "Screens & graphics"],
      ["operator-stage.html", "Stage operator"],
      ["operator-camera.html", "Camera operator"],
      ["operator-obs-recording.html", "OBS & streaming"],
      ["operator-editor.html", "Editor operator"],
      ["operator-viewer.html", "Viewer operator"],
      ["operator-presenter.html", "Presenter & Configure"],
    ],
  },
  {
    heading: "Connected production",
    pages: [
      ["connected-operators.html", "LAN browser access"],
      ["recording.html", "Recording"],
      ["comms-and-timing.html", "Comms & timing"],
      ["devices.html", "Devices & companion apps"],
    ],
  },
  {
    heading: "Reference",
    pages: [
      ["faq.html", "FAQ"],
      ["roadmap.html", "Roadmap / in development"],
    ],
  },
];

const currentPage = window.location.pathname.split("/").pop() || "index.html";
const docsNavigation = document.querySelector("[data-docs-nav]");

if (docsNavigation) {
  for (const section of docSections) {
    const group = document.createElement("section");
    group.className = "docs-nav-group";

    const heading = document.createElement("h2");
    heading.textContent = section.heading;
    group.append(heading);

    const list = document.createElement("ul");
    for (const [href, label] of section.pages) {
      const row = document.createElement("li");
      const link = document.createElement("a");
      link.href = `./${href}`;
      link.textContent = label;
      if (href === currentPage) link.setAttribute("aria-current", "page");
      row.append(link);
      list.append(row);
    }
    group.append(list);
    docsNavigation.append(group);
  }
}

const navigationButton = document.querySelector(".docs-nav-toggle");
if (navigationButton && docsNavigation) {
  navigationButton.addEventListener("click", () => {
    const open = navigationButton.getAttribute("aria-expanded") !== "true";
    navigationButton.setAttribute("aria-expanded", String(open));
    docsNavigation.classList.toggle("open", open);
  });
}
