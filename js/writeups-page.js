const grid = document.getElementById("writeupGrid");
const search = document.getElementById("search");
const filters = document.getElementById("filters");
const empty = document.getElementById("empty");
const stage = document.getElementById("readerStage");
const sidebar = document.getElementById("readerSidebar");
const readerList = document.getElementById("readerList");
const readerContent = document.getElementById("readerContent");
const readerBody = document.getElementById("readerBody");
const PUBLISHED_KEY = "sardhon-published-writeups-v1";
let LIVE_ITEMS = [];

function slugify(value) {
  return String(value || "").toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function normalizeTags(tags) {
  const raw = Array.isArray(tags)
    ? tags
    : String(tags || "").split(",");
  const seen = new Set();
  const result = [];
  for (const value of raw) {
    const tag = String(value || "").trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}
function escapeHtml(value="") {
  return String(value).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
}
function publishedItems() {
  try {
    const raw = JSON.parse(localStorage.getItem(PUBLISHED_KEY) || "[]");
    return Array.isArray(raw) ? raw.map(w => ({ ...w, slug: w.slug || w.id || slugify(w.title) })) : [];
  } catch { return []; }
}
function allItems() {
  const staticItems = WRITEUPS.map(w => ({...w, slug:w.slug || w.id || slugify(w.title), tags:normalizeTags(w.tags)}));
  const bySlug = new Map(staticItems.map(w => [w.slug, w]));
  for (const item of LIVE_ITEMS) {
    const slug=item.slug || slugify(item.title);
    bySlug.set(slug,{...(bySlug.get(slug)||{}),...item,slug,tags:normalizeTags(item.tags),url:item.url || `/writeups.html?slug=${encodeURIComponent(slug)}`});
  }
  for (const item of publishedItems()) {
    const slug=item.slug || slugify(item.title);
    const base=bySlug.get(slug);
    bySlug.set(slug,{...(base||{}),...item,slug,tags:normalizeTags(item.tags ?? base?.tags),url:base?.url || item.url || `/writeups.html?slug=${encodeURIComponent(slug)}`});
  }
  return [...bySlug.values()];
}
function filteredItems() {
  const q = (search?.value || "").toLowerCase().trim();
  const active = String(filters?.querySelector(".filter.active")?.dataset.tag || "").trim().toLowerCase();
  return allItems().filter(w => {
    const tags = normalizeTags(w.tags);
    const text = `${w.title || ""} ${w.category || ""} ${w.excerpt || ""} ${tags.join(" ")}`.toLowerCase();
    return (!q || text.includes(q)) && (!active || tags.includes(active));
  });
}
function renderFilters() {
  const tags = [...new Set(allItems().flatMap(w => normalizeTags(w.tags)))].sort((a,b)=>a.localeCompare(b));
  filters.innerHTML = `<button class="filter active" data-tag="">All</button>` + tags.map(t => `<button class="filter" data-tag="${escapeHtml(t.toLowerCase())}">${escapeHtml(t)}</button>`).join("");
  filters.querySelectorAll(".filter").forEach(btn => btn.addEventListener("click", () => {
    filters.querySelectorAll(".filter").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    renderGrid();
    if (stage.classList.contains("reader-active")) renderReaderList();
  }));
}
function cardHtml(item) {
  return `<button class="writeup-card" type="button" data-slug="${escapeHtml(item.slug)}">
    <span class="category">${escapeHtml(item.category || "SECURITY")}</span>
    <h3>${escapeHtml(item.title || "Untitled Security Write-up")}</h3>
    ${item.excerpt ? `<p>${escapeHtml(item.excerpt)}</p>` : ""}
    <time>${escapeHtml(item.date || "")}</time>
    <span class="card-open"><i class="fa-solid fa-arrow-up-right-from-square"></i></span>
  </button>`;
}
function renderGrid() {
  const list = filteredItems();
  grid.innerHTML = list.map(cardHtml).join("");
  empty.hidden = list.length !== 0;
  grid.querySelectorAll(".writeup-card").forEach(card => card.addEventListener("click", () => selectItem(card.dataset.slug)));
}
function renderReaderList() {
  const list = filteredItems();
  readerList.innerHTML = list.length ? list.map(item => `<button class="reader-item" type="button" data-slug="${escapeHtml(item.slug)}">
    <span class="side-category">${escapeHtml(item.category || "TRYHACKME")}</span>
    <span class="side-title">${escapeHtml(item.title || "Untitled Security Write-up")}</span>
  </button>`).join("") : `<div class="detail-empty-list">No write-ups match your search.</div>`;
  readerList.querySelectorAll(".reader-item").forEach(btn => btn.addEventListener("click", () => selectItem(btn.dataset.slug)));
}
function addPublishedStyles(html) {
  // Keep article CSS inside the selected-write-up container. Older versions
  // injected the article <style> tags into <head>, which could overwrite the
  // catalogue cards (for example making their titles black).
  return new DOMParser().parseFromString(html, "text/html");
}
function bindCopyButtons(root) {
  root.querySelectorAll(".copy-btn").forEach(btn => btn.addEventListener("click", async () => {
    const text = decodeURIComponent(btn.dataset.copy || "");
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    const icon = btn.querySelector("i"), label = btn.querySelector("span");
    if (icon) icon.className = "fa-solid fa-check";
    if (label) label.textContent = "Copied";
    setTimeout(() => { if (icon) icon.className = "fa-regular fa-copy"; if (label) label.textContent = "Copy"; }, 1200);
  }));
}
function isUsableArticleHtml(html) {
  if (typeof html !== "string" || !html.trim()) return false;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const root = doc.querySelector("main") || doc.body;
    if (!root) return false;

    // A few older published records accidentally stored only the generated
    // article header (meta + H1 + excerpt). Treat those as incomplete and
    // continue to the real markdown/static article instead of rendering a
    // large, apparently-empty reader.
    const meaningful = root.querySelector(
      ".code-card,.terminal-card,.response-card,.finding-card,.callout,.table-card,.attack-card,.mitre-card,.cvss-card,.evidence-card,h2,h3,ul,ol,blockquote,pre,table,img,hr"
    );
    if (meaningful) return true;

    const text = (root.textContent || "").replace(/\s+/g, " ").trim();
    const h1 = root.querySelector("h1");
    const titleOnly = h1 && text === (h1.textContent || "").replace(/\s+/g, " ").trim();
    return !titleOnly && text.length > 120;
  } catch {
    return false;
  }
}

async function getContent(item) {
  try {
    const live = await fetch(`/api/writeups/${encodeURIComponent(item.slug)}`, {credentials:'same-origin', cache:'no-store'});
    if(live.ok){
      const data=await live.json();
      if(data.content_html) return `<main class="writeup">${data.content_html}</main>`;
    }
  } catch {}
  // Published entries carry the exact rendered Editor body in the catalogue.
  // This is the reliable local-file path: file:// pages may block fetch(), but
  // JavaScript can safely render the already-published body from writeups.js.
  if (typeof item.contentHtml === "string" && item.contentHtml.trim()) {
    return `<main class="writeup">${item.contentHtml}</main>`;
  }

  // Published entries created by the editor normally contain the complete
  // rendered article. Only trust the HTML when it actually contains article
  // content; old broken records may contain just metadata/title.
  if (isUsableArticleHtml(item.html)) return item.html;

  // Prefer the user's original markdown when an old/broken HTML publication
  // exists. This preserves the actual write-up instead of replacing it with a
  // fabricated article.
  if (typeof item.markdown === "string" && item.markdown.trim()) {
    return markdownFallbackDocument(item.markdown, item);
  }

  // Finally load the physical article exported by the editor/static project.
  const candidates = [];
  const slug = item.slug || slugify(item.title);

  // Prefer the canonical static article for known catalogue entries. This is
  // deliberately independent of localStorage so a stale publication cannot
  // hide the real article.
  const canonical = {
    "sql-injection": "Write-Ups/sql-injection.html",
    "idor-in-user-profile-endpoint": "Write-Ups/idor-in-user-profile-endpoint.html",
    "tryhackme-your-first-write-up": "Write-Ups/example.html"
  };
  if (canonical[slug]) candidates.push(canonical[slug]);

  if (item.url && !/^writeups\.html(?:\?|$)/i.test(item.url)) candidates.push(item.url);
  if (slug) {
    candidates.push(`Write-Ups/${encodeURIComponent(slug)}.html`);
    const folder = String(item.title || slug).trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "");
    if (folder) candidates.push(`Write-ups/${encodeURIComponent(folder)}/index.html`);
  }

  // Prefer embedded article bodies. This is the critical fallback for
  // portfolios opened directly from the filesystem (file://), where browsers
  // commonly block fetch() even for files in the same folder.
  if (typeof STATIC_WRITEUP_CONTENT !== "undefined" && STATIC_WRITEUP_CONTENT[slug]) {
    const embedded = STATIC_WRITEUP_CONTENT[slug];
    if (isUsableArticleHtml(embedded)) return embedded;
  }

  for (const url of [...new Set(candidates)]) {
    try {
      const r = await fetch(url, {cache:"no-store"});
      if (r.ok) {
        const text = await r.text();
        if (isUsableArticleHtml(text)) return text;
      }
    } catch {}
  }

  return `<main><div class="meta">${escapeHtml(item.category || "SECURITY")} · ${escapeHtml(item.date || "")}</div><h1>${escapeHtml(item.title || "Untitled Security Write-up")}</h1><p class="reader-unavailable">The write-up body could not be loaded.</p></main>`;
}

function markdownFallbackDocument(markdown, item) {
  // Render the same security-oriented markdown syntax used by the Editor.
  // This path is intentionally only a recovery path for older/broken
  // localStorage publications whose HTML contains metadata but no body.
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const inline = value => escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(/^\s*```([^`]*)\s*$/);
    if (fence) {
      const code = []; i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      const lang = (fence[1] || "text").trim().toLowerCase();
      const cls = ["terminal","shell","bash","zsh"].includes(lang) ? "terminal-card" :
                  ["http-response","response"].includes(lang) ? "response-card" : "code-card";
      const label = lang === "http-response" ? "HTTP RESPONSE" : lang.toUpperCase();
      out.push(`<div class="${cls}"><div class="block-top"><span>${escapeHtml(label)}</span></div><pre>${escapeHtml(code.join("\n"))}</pre></div>`);
      continue;
    }

    if (/^:::finding\b/i.test(line)) {
      const sev = line.trim().split(/\s+/)[1] || "HIGH"; const arr=[]; i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) arr.push(lines[i++]);
      if (i < lines.length) i++;
      const body = arr.map(x => /^###\s+/.test(x) ? `<h3>${inline(x.replace(/^###\s+/, ""))}</h3>` : `<p>${inline(x)}</p>`).join("");
      out.push(`<div class="finding-card"><div class="severity">${escapeHtml(sev)} / FINDING</div><div class="finding-content">${body}</div></div>`);
      continue;
    }

    if (/^:::attack\b/i.test(line)) {
      const arr=[]; i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) arr.push(lines[i++]);
      if (i < lines.length) i++;
      out.push(`<div class="attack-card">${arr.filter(Boolean).map((x,n)=>`<div class="attack-step"><span>${n+1}</span><div>${inline(x.replace(/^\d+\.\s*/, ""))}</div></div>`).join("")}</div>`);
      continue;
    }

    if (/^:::mitre\b/i.test(line)) {
      const arr=[]; i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) arr.push(lines[i++]);
      if (i < lines.length) i++;
      out.push(`<div class="mitre-card"><strong>MITRE ATT&amp;CK</strong><div class="mitre-tags">${arr.filter(Boolean).map(x=>`<span>${inline(x)}</span>`).join("")}</div></div>`);
      continue;
    }

    if (/^:::cvss\b/i.test(line)) {
      const parts=line.trim().split(/\s+/).slice(1); const score=parts[0]||"6.5"; const label=parts.slice(1).join(" ")||"MEDIUM"; i++; const arr=[];
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) arr.push(lines[i++]);
      if (i < lines.length) i++;
      out.push(`<div class="cvss-card"><div><div class="cvss-score">${escapeHtml(score)}</div><div class="cvss-label">CVSS SCORE</div></div><div class="cvss-label">${inline(arr.join(" "))}</div><div class="cvss-badge">${escapeHtml(label)}</div></div>`);
      continue;
    }

    if (/^>\s*\[!/i.test(line)) {
      const kind=(line.match(/\[!(.*?)\]/)||[])[1]||"NOTE"; const arr=[]; i++;
      while(i<lines.length && /^>/.test(lines[i])) arr.push(lines[i].replace(/^>\s?/, "").trim()), i++;
      out.push(`<div class="callout ${escapeHtml(kind.toLowerCase())}"><strong>${escapeHtml(kind)}</strong><div>${inline(arr.join(" "))}</div></div>`);
      continue;
    }

    if (line.trim() === "---") { out.push("<hr>"); i++; continue; }

    if (line.startsWith("|")) {
      const rows=[]; while(i<lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      if(rows.length>=2){
        const head=rows[0].split("|").slice(1,-1); const body=rows.slice(2).map(r=>r.split("|").slice(1,-1));
        out.push(`<div class="table-card"><table><thead><tr>${head.map(c=>`<th>${inline(c.trim())}</th>`).join("")}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${inline(c.trim())}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
    }

    if (/^###\s+/.test(line)) { out.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`); i++; continue; }
    if (/^##\s+/.test(line)) { out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`); i++; continue; }
    if (/^#\s+/.test(line)) { out.push(`<h2>${inline(line.replace(/^#\s+/, ""))}</h2>`); i++; continue; }
    if (/^>\s?/.test(line)) { out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`); i++; continue; }

    if (/^[-*]\s+/.test(line)) {
      const items=[]; while(i<lines.length && /^[-*]\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^[-*]\s+/, ""))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`); continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items=[]; while(i<lines.length && /^\d+\.\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\d+\.\s+/, ""))}</li>`);
      out.push(`<ol>${items.join("")}</ol>`); continue;
    }

    const para=[line]; i++;
    while(i<lines.length && lines[i].trim() && !/^#|^\s*```|^:::|^>|^\||^[-*]\s/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }

  return `<!doctype html><html><body><main><div class="meta">${escapeHtml(item.category || "SECURITY")} · ${escapeHtml(item.date || "")}</div><h1>${escapeHtml(item.title || "Untitled Security Write-up")}</h1>${item.excerpt ? `<p class="intro">${escapeHtml(item.excerpt)}</p>` : ""}<div class="article-content">${out.join("")}</div></main></body></html>`;
}

async function showReader(item) {
  readerBody.innerHTML = `<div class="reader-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Loading write-up...</span></div>`;
  const doc = addPublishedStyles(await getContent(item));
  const main = doc.querySelector("main") || doc.body;
  const sourceRoot = main.cloneNode(true);
  sourceRoot.querySelectorAll("script, .interactive-grid, .ambient, header, footer").forEach(el => el.remove());

  // Older published HTML was generated by wrapping the editor preview in a
  // second metadata/title/intro header. If two identical H1s exist in the
  // leading section, discard the first header block and keep the editor's
  // rendered version. This also repairs already-published localStorage data.
  const headings = Array.from(sourceRoot.querySelectorAll(":scope > h1"));
  if (headings.length >= 2) {
    const titles = headings.map(h => h.textContent.trim().toLowerCase());
    const allSame = titles.every(t => t === titles[0]);
    if (allSame) {
      const keep = headings[headings.length - 1];
      const firstMeta = sourceRoot.querySelector(":scope > .meta, :scope > .eyebrow, :scope > .published-meta");
      const metaClone = firstMeta ? firstMeta.cloneNode(true) : null;
      const fragment = document.createDocumentFragment();
      if (metaClone) fragment.appendChild(metaClone);
      fragment.appendChild(keep);
      let node = keep.nextElementSibling;
      while (node) {
        const next = node.nextElementSibling;
        fragment.appendChild(node);
        node = next;
      }
      sourceRoot.replaceChildren(fragment);
    }
  }

  readerBody.innerHTML = "";
  const article = document.createElement("div");
  article.className = "published-body writeup";
  article.innerHTML = sourceRoot.innerHTML;
  readerBody.appendChild(article);
  bindCopyButtons(article);
  document.title = `${item.title || "Write-up"} | Sardhon`;
}
function setUrl(slug) {
  const url = new URL(location.href);
  if (slug) url.searchParams.set("slug", slug); else url.searchParams.delete("slug");
  history.replaceState({slug: slug || null}, "", url);
}
async function selectItem(slug, fromUrl=false) {
  const item = allItems().find(w => w.slug === slug);
  if (!item) return;

  // Keep the reader layout mounted while changing articles. This prevents
  // the catalogue/search area from jumping or disappearing when a different
  // write-up is selected.
  document.body.classList.add("reader-mode");
  document.body.classList.remove("reader-controls-collapsed"); // controls intentionally never collapse
  stage.classList.add("reader-active");
  sidebar.hidden = false;
  readerContent.hidden = false;
  grid.setAttribute("aria-hidden", "true");

  renderReaderList();
  await showReader(item);
  readerContent.scrollTop = 0;
  renderReaderList();
  readerList.querySelectorAll(".reader-item").forEach(btn => btn.classList.toggle("active", btn.dataset.slug === item.slug));
  if (!fromUrl) setUrl(item.slug);
}
function closeReader() {
  document.body.classList.remove("reader-mode");
  stage.classList.remove("reader-active", "rearranging");
  sidebar.hidden = true;
  readerContent.hidden = true;
  grid.removeAttribute("aria-hidden");
  setUrl("");
  document.title = "Write-ups | Sardhon";
  window.scrollTo({top:0, behavior:"smooth"});
}
search?.addEventListener("input", () => { renderGrid(); if(stage.classList.contains("reader-active")) renderReaderList(); });
window.addEventListener("popstate", () => {
  const slug = new URLSearchParams(location.search).get("slug");
  if (slug) selectItem(slug, true); else closeReader();
});

async function loadLiveWriteups(){
  try{
    const response=await fetch('/api/writeups',{credentials:'same-origin',cache:'no-store'});
    if(response.ok){ LIVE_ITEMS=await response.json(); }
  }catch{}
  renderFilters();
  renderGrid();
  const initialSlug=new URLSearchParams(location.search).get('slug');
  const initialItem=initialSlug || allItems()[0]?.slug;
  if(initialItem) selectItem(initialItem,true);
}
loadLiveWriteups();
