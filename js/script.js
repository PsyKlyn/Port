const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const menuBtn = $("#menuBtn");
const navLinks = $("#navLinks");
menuBtn?.addEventListener("click", () => navLinks.classList.toggle("open"));
$$(".nav-links a").forEach(a => a.addEventListener("click", () => navLinks.classList.remove("open")));

const grid = $("#writeupGrid");
const search = $("#search");
const filters = $("#filters");
const empty = $("#empty");
const showMore = $(".show-more-btn");

function slugifyWriteup(value) {
  return String(value || "").toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getPublishedWriteups() {
  try {
    const items = JSON.parse(localStorage.getItem("sardhon-published-writeups-v1") || "[]");
    return Array.isArray(items) ? items.map(w => {
      const slug = w.slug || w.id || slugifyWriteup(w.title);
      return {
        ...w,
        slug,
        url: `writeups.html?slug=${encodeURIComponent(slug)}`,
        published: true
      };
    }) : [];
  } catch { return []; }
}

function allWriteups() {
  const published = getPublishedWriteups();
  const publishedSlugs = new Set(published.map(w => w.slug || slugifyWriteup(w.title)));
  return [...published, ...WRITEUPS.filter(w => !publishedSlugs.has(w.slug || slugifyWriteup(w.title)))].map(w => ({
    ...w,
    slug: w.slug || slugifyWriteup(w.title),
    url: `writeups.html?slug=${encodeURIComponent(w.slug || slugifyWriteup(w.title))}`
  }));
}

function renderFilters() {
  if (!filters) return;
  const tags = [...new Set(allWriteups().flatMap(w => w.tags || []))].sort();
  filters.innerHTML = `<button class="filter active" data-tag="">All</button>` +
    tags.map(t => `<button class="filter" data-tag="${t}">${t}</button>`).join("");
  $$(".filter", filters).forEach(btn => btn.addEventListener("click", () => {
    $$(".filter", filters).forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    renderWriteups();
  }));
}

function renderWriteups() {
  if (!grid) return;
  const isHome = grid.classList.contains("home-writeup-grid");
  const q = (search?.value || "").toLowerCase().trim();
  const active = filters ? $(".filter.active", filters)?.dataset.tag || "" : "";
  let list = allWriteups().filter(w => {
    const text = `${w.title} ${w.category} ${w.excerpt} ${(w.tags || []).join(" ")}`.toLowerCase();
    return (!q || text.includes(q)) && (!active || (w.tags || []).includes(active));
  });
  if (isHome) list = list.slice(0, 3);
  grid.innerHTML = list.map(w => `
    <a class="writeup-card" href="${w.url}">
      <span class="category">${w.category || "SECURITY"}</span>
      <h3>${w.title || "Untitled Security Write-up"}</h3>
      ${w.excerpt ? `<p>${w.excerpt}</p>` : ""}
      <time>${w.date || ""}</time>
    </a>`).join("");
  if (empty) empty.hidden = list.length !== 0;
  if (showMore) showMore.style.display = allWriteups().length > 3 ? "inline-flex" : "none";
}

if (grid) {
  if (filters) renderFilters();
  renderWriteups();
  search?.addEventListener("input", renderWriteups);
}


const observer = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add("visible");
      observer.unobserve(e.target);
    }
  });
}, {threshold:.1});
$$(".reveal").forEach(x => observer.observe(x));
$("#year").textContent = new Date().getFullYear();


// Interactive square-grid hover effect.
// A 3x3 glow is triggered by pointer movement, fades while the pointer is still,
// and retriggers immediately even when the pointer moves only slightly inside
// the same grid cell. Previous positions remain briefly as a smooth trail.
(() => {
  const grid = document.getElementById("interactiveGrid");
  if (!grid) return;

  let cols = 0;
  let rows = 0;
  let size = 28;
  let cells = [];
  let activeCol = -1;
  let activeRow = -1;
  let activeStarted = 0;
  let trail = new Map();
  let raf = 0;

  // Longer than before so fast movement produces a smoother light trail.
  const FADE_MS = 1350;
  const TRAIL_FADE_MS = 1350;

  const intensity = [
    [0.30, 0.52, 0.30],
    [0.52, 1.00, 0.52],
    [0.30, 0.52, 0.30]
  ];

  const buildGrid = () => {
    size = window.innerWidth <= 600 ? 22 : 26;
    cols = Math.ceil(window.innerWidth / size) + 1;
    rows = Math.ceil(window.innerHeight / size) + 1;

    grid.style.setProperty("--cell-size", `${size}px`);
    grid.style.setProperty("--grid-cols", cols);
    grid.innerHTML = "";
    cells = [];
    trail = new Map();
    activeCol = -1;
    activeRow = -1;
    activeStarted = 0;

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < cols * rows; i++) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      cell.style.setProperty("--heat", "0");
      cells.push(cell);
      fragment.appendChild(cell);
    }
    grid.appendChild(fragment);
  };

  const indexAt = (col, row) => row * cols + col;

  const footprint = (col, row) => {
    const result = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = col + dx;
        const r = row + dy;
        if (c >= 0 && r >= 0 && c < cols && r < rows) {
          result.push({
            index: indexAt(c, r),
            heat: intensity[dy + 1][dx + 1]
          });
        }
      }
    }
    return result;
  };

  const triggerAt = (col, row, now) => {
    // If the pointer moved only slightly but remains in the same cell,
    // restart the glow anyway. This is the important re-trigger behavior.
    activeCol = col;
    activeRow = row;
    activeStarted = now;
  };

  const moveTo = (x, y) => {
    const col = Math.floor(x / size);
    const row = Math.floor(y / size);
    if (col < 0 || row < 0 || col >= cols || row >= rows) return;

    const now = performance.now();

    // Every actual mouse movement retriggers the glow. If the grid cell
    // changed, the previous block becomes a fading trail.
    if (activeCol >= 0 && activeRow >= 0 && (col !== activeCol || row !== activeRow)) {
      for (const { index, heat } of footprint(activeCol, activeRow)) {
        const existing = trail.get(index);
        trail.set(index, {
          heat: Math.max(existing?.heat || 0, heat),
          started: now
        });
      }
    }

    triggerAt(col, row, now);
  };

  const fade = now => {
    // Reset cells first. Then compose trail + current glow every frame.
    for (const cell of cells) cell.style.setProperty("--heat", "0");

    // Older positions fade smoothly.
    for (const [index, item] of trail) {
      const cell = cells[index];
      if (!cell) {
        trail.delete(index);
        continue;
      }

      const progress = Math.min(1, (now - item.started) / TRAIL_FADE_MS);
      const heat = item.heat * Math.pow(1 - progress, 2.05);

      if (heat <= 0.002) {
        trail.delete(index);
        continue;
      }

      cell.style.setProperty("--heat", heat.toFixed(3));
    }

    // Current position also fades when the mouse is completely still.
    // A tiny mouse movement calls moveTo() and restarts activeStarted.
    if (activeCol >= 0 && activeRow >= 0) {
      const progress = Math.min(1, (now - activeStarted) / FADE_MS);
      const currentFade = Math.pow(1 - progress, 1.7);

      if (currentFade <= 0.002) {
        activeCol = -1;
        activeRow = -1;
        activeStarted = 0;
      } else {
        for (const { index, heat } of footprint(activeCol, activeRow)) {
          const cell = cells[index];
          if (!cell) continue;

          const currentHeat = heat * currentFade;
          const existing = parseFloat(cell.style.getPropertyValue("--heat")) || 0;
          cell.style.setProperty("--heat", Math.max(existing, currentHeat).toFixed(3));
        }
      }
    }

    raf = requestAnimationFrame(fade);
  };

  const leaveGrid = () => {
    if (activeCol < 0 || activeRow < 0) return;
    const now = performance.now();
    for (const { index, heat } of footprint(activeCol, activeRow)) {
      const existing = trail.get(index);
      trail.set(index, {
        heat: Math.max(existing?.heat || 0, heat),
        started: now
      });
    }
    activeCol = -1;
    activeRow = -1;
    activeStarted = 0;
  };

  buildGrid();
  raf = requestAnimationFrame(fade);

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(buildGrid, 100);
  }, { passive: true });

  window.addEventListener("mousemove", event => {
    moveTo(event.clientX, event.clientY);
  }, { passive: true });

  document.addEventListener("mouseleave", leaveGrid, { passive: true });
})();
