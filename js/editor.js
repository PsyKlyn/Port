const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const source = $("#source");
const preview = $("#preview");
const fields = {
  title: $("#title"),
  category: $("#category"),
  date: $("#date"),
  excerpt: $("#excerpt"),
  tags: $("#tags")
};
const dateDisplay = $("#dateDisplay");
const dateControl = $("#dateControl");
const datePopover = $("#datePopover");
const datePickerBtn = $("#datePickerBtn");
const calendarDays = $("#calendarDays");
const calendarMonth = $("#calendarMonth");
const notice = $("#editorNotice");
const noticeOk = $("#editorNoticeOk");
const screenshotInput = $("#screenshotInput");
const evidenceInput = $("#evidenceInput");
let projectRootHandle = null;
let tempAssetHandle = null;
let assetRenderMode = "data";
const pendingAssets = new Map();
const DRAFT_ID = localStorage.getItem("sardhon-writeup-draft-id") || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
localStorage.setItem("sardhon-writeup-draft-id",DRAFT_ID);
let calendarCursor = new Date();
calendarCursor.setDate(1);
const editorCard = $(".editor-card");
const modeButtons = $$(".mode-btn");

const STORAGE_KEY = "sardhon-writeup-editor-v2";
const LEGACY_KEY = "sardhonWriteup";
const PUBLISHED_KEY = "sardhon-published-writeups-v1";
let saveTimer;

function today(){
  const d=new Date();
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function formatDate(value){
  if(!value) return "";
  const [y,m,d]=String(value).split("-");
  return y&&m&&d ? `${m}/${d}/${y}` : value;
}
function syncDateDisplay(){
  if(dateDisplay) dateDisplay.value=formatDate(fields.date.value);
}
function dateFromParts(y,m,d){
  return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
function renderCalendar(){
  if(!calendarDays||!calendarMonth) return;
  const y=calendarCursor.getFullYear();
  const m=calendarCursor.getMonth();
  calendarMonth.textContent=calendarCursor.toLocaleDateString(undefined,{month:"long",year:"numeric"});
  const first=new Date(y,m,1).getDay();
  const count=new Date(y,m+1,0).getDate();
  const prevCount=new Date(y,m,0).getDate();
  const selected=fields.date.value;
  const cells=[];
  for(let i=0;i<42;i++){
    const dayNum=i-first+1;
    let cellY=y,cellM=m,day=dayNum,muted=false;
    if(dayNum<1){cellM=m-1;cellY=m===0?y-1:y;day=prevCount+dayNum;muted=true;}
    else if(dayNum>count){cellM=m+1;cellY=m===11?y+1:y;day=dayNum-count;muted=true;}
    const value=dateFromParts(cellY,cellM,day);
    const btn=document.createElement("button");
    btn.type="button"; btn.className="calendar-day"; btn.textContent=day;
    if(muted) btn.classList.add("muted");
    if(value===selected) btn.classList.add("selected");
    if(value===today()) btn.classList.add("today");
    btn.dataset.date=value;
    cells.push(btn);
  }
  calendarDays.replaceChildren(...cells);
}
function setDateValue(value){
  fields.date.value=value||"";
  syncDateDisplay();
  const label=fields.date.closest("label");
  const empty=!value;
  fields.date.classList.toggle("invalid",empty);
  if(label) label.classList.toggle("invalid",empty);
  if(dateControl) dateControl.classList.toggle("invalid",empty);
  scheduleSave();
}
function positionCalendar(){
  if(!datePopover || datePopover.hidden || !datePickerBtn) return;
  const rect=datePickerBtn.getBoundingClientRect();
  const margin=12;
  const width=Math.min(360, window.innerWidth-margin*2);
  datePopover.style.width=`${width}px`;
  datePopover.style.maxHeight=`${Math.max(280, window.innerHeight-margin*2)}px`;
  // Measure after the width is applied so the placement can flip dynamically.
  const popRect=datePopover.getBoundingClientRect();
  let left=rect.right-popRect.width;
  if(left<margin) left=margin;
  if(left+popRect.width>window.innerWidth-margin) left=window.innerWidth-margin-popRect.width;
  const below=window.innerHeight-rect.bottom-margin;
  const above=rect.top-margin;
  let top;
  if(below>=Math.min(popRect.height,430) || below>=above){
    top=rect.bottom+8;
  }else{
    top=rect.top-Math.min(popRect.height,430)-8;
  }
  top=Math.max(margin,Math.min(top,window.innerHeight-popRect.height-margin));
  datePopover.style.left=`${Math.round(left)}px`;
  datePopover.style.top=`${Math.round(top)}px`;
}
function toggleCalendar(open){
  if(!datePopover||!datePickerBtn) return;
  const next=typeof open==="boolean"?open:datePopover.hidden;
  datePopover.hidden=!next;
  datePickerBtn.setAttribute("aria-expanded",next?"true":"false");
  if(next){ renderCalendar(); requestAnimationFrame(positionCalendar); }
}
function showEditorNotice(){
  if(!notice) return;
  notice.hidden=false;
  document.body.classList.add("notice-open");
  requestAnimationFrame(()=>noticeOk?.focus());
}
function hideEditorNotice(){
  if(!notice) return;
  notice.hidden=true;
  document.body.classList.remove("notice-open");
}

function slugify(value){
  return value.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g,"")
    .replace(/[\s_-]+/g,"-")
    .replace(/^-+|-+$/g,"");
}
function esc(value=""){
  return String(value).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}
function safeUrl(url,image=false){
  const raw=(url||"").trim();
  if(/^(https?:|mailto:|data:)/i.test(raw)) return raw;
  if(image){
    const key=raw.replace(/^\.\//,"");
    const pending=pendingAssets.get(key);
    if(pending){
      // Live editor/Write-ups reader uses the embedded data URL. Physical
      // published pages store all images in the shared Write-ups/images folder.
      if(assetRenderMode === "relative") return `../images/${pending.name}`;
      return pending.dataUrl;
    }
    if(/^(?:\.\.?\/|assets\/|\/|images\/)/i.test(raw)) return raw;
  }
  return "#";
}
function inline(s=""){
  let out=esc(s);
  out=out.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g,
    (_,alt,url,title)=>`<img src="${esc(safeUrl(url,true))}" alt="${esc(alt)}"${title?` title="${esc(title)}"`:""}>`);
  out=out.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g,
    (_,label,url,title)=>`<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer"${title?` title="${esc(title)}"`:""}>${label}</a>`);
  out=out.replace(/`([^`]+)`/g,"<code>$1</code>");
  out=out.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
  out=out.replace(/__([^_]+)__/g,"<strong>$1</strong>");
  out=out.replace(/\*([^*]+)\*/g,"<em>$1</em>");
  out=out.replace(/_([^_]+)_/g,"<em>$1</em>");
  return out;
}
function miniMarkdown(s){
  return s.split("\n").map(line=>{
    if(/^###\s/.test(line)) return `<h3>${inline(line.replace(/^###\s/,""))}</h3>`;
    if(/^##\s/.test(line)) return `<h2>${inline(line.replace(/^##\s/,""))}</h2>`;
    return line.trim()?`<p>${inline(line)}</p>`:"";
  }).join("");
}

function encodeCopy(text){
  return encodeURIComponent(text);
}

function copyButton(text){
  return `<button class="copy-btn" type="button" data-copy="${encodeCopy(text)}"><i class="fa-regular fa-copy"></i><span>Copy</span></button>`;
}

function renderMarkdown(md=source.value, updatePreview=true){
  const normalized=String(md||"").replace(/\r\n?/g,"\n");
  const lines=normalized.split("\n");
  const out=[];
  let i=0;

  while(i<lines.length){
    const l=lines[i];

    if(!l.trim()){i++;continue;}

    const marker=l.match(/^\s*<!--\s*BLOCK:([a-z0-9_-]+):([a-f0-9-]+)\s*-->\s*$/i);
    if(marker){
      const type=marker[1], id=marker[2];
      const body=[]; i++;
      while(i<lines.length && !new RegExp(`^\\s*<!--\\s*\\/BLOCK:${type}:${id}\\s*-->\\s*$`,"i").test(lines[i])){
        body.push(lines[i]); i++;
      }
      if(i<lines.length)i++;
      const rendered=renderMarkdown(body.join("\n"), false);
      out.push(`<div class="inserted-block" data-block-id="${esc(id)}" data-block-type="${esc(type)}">${rendered}</div>`);
      continue;
    }

    const fence=l.match(/^\s*```([^`]*)\s*$/);
    if(fence){
      const lang=fence[1].trim().toLowerCase()||"text";
      const arr=[];
      i++;
      while(i<lines.length && !/^\s*```\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const text=arr.join("\n");
      const terminal=["terminal","shell","bash","zsh"].includes(lang);
      const response=["http-response","response"].includes(lang);
      const cls=terminal?"terminal-card":response?"response-card":"code-card";
      const bodyCls=terminal?"terminal-body":response?"response-body":"code-body";
      const displayLang=lang==="http-response"?"HTTP RESPONSE":lang.toUpperCase();

      out.push(
        `<div class="${cls}">
          <div class="block-top"><span>${esc(displayLang)}</span>${copyButton(text)}</div>
          <pre class="${bodyCls}">${esc(text)}</pre>
        </div>`
      );
      continue;
    }

    if(/^:::finding\b/i.test(l)){
      const sev=l.trim().split(/\s+/)[1]||"HIGH";
      const arr=[]; i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      out.push(`<div class="finding-card"><div class="severity">${esc(sev)} / FINDING</div><div class="finding-content">${miniMarkdown(arr.join("\n"))}</div></div>`);
      continue;
    }

    if(/^:::attack\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      out.push(`<div class="attack-card">${arr.filter(Boolean).map((x,n)=>`<div class="attack-step"><span>${n+1}</span><div>${inline(x.replace(/^\d+\.\s*/,""))}</div></div>`).join("")}</div>`);
      continue;
    }

    if(/^:::mitre\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      out.push(`<div class="mitre-card"><strong>MITRE ATT&CK</strong><div class="mitre-tags">${arr.filter(Boolean).map(x=>`<span>${inline(x)}</span>`).join("")}</div></div>`);
      continue;
    }

    if(/^:::cvss\b/i.test(l)){
      const parts=l.trim().split(/\s+/).slice(1);
      const score=parts[0]||"6.5";
      const label=parts.slice(1).join(" ")||"MEDIUM";
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      out.push(`<div class="cvss-card"><div><div class="cvss-score">${esc(score)}</div><div class="cvss-label">CVSS SCORE</div></div><div class="cvss-label">${inline(arr.join(" "))}</div><div class="cvss-badge">${esc(label)}</div></div>`);
      continue;
    }

    if(/^:::(vulnerability|vuln)\b/i.test(l)){
      const parts=l.trim().split(/\s+/).slice(1);
      const sev=(parts.shift()||"HIGH").toUpperCase();
      const title=parts.join(" ")||"Security Finding";
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      out.push(`<div class="vuln-summary severity-${sev.toLowerCase()}"><div class="vuln-top"><span class="vuln-severity">${esc(sev)}</span><span>VULNERABILITY</span></div><h3>${inline(title)}</h3><div class="vuln-body">${miniMarkdown(arr.join("\n"))}</div></div>`);
      continue;
    }

    if(/^:::steps\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const steps=arr.filter(Boolean).map((x,n)=>`<div class="procedure-step"><span>${n+1}</span><div>${inline(x.replace(/^\d+[.)]\s*/,""))}</div></div>`).join("");
      out.push(`<div class="procedure-card"><div class="block-heading">PROCEDURE</div>${steps}</div>`);
      continue;
    }

    if(/^:::flow\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const nodes=arr.filter(Boolean).map(x=>inline(x.replace(/^[-*]\s*/,""))).join('<span class="flow-arrow"><i class="fa-solid fa-arrow-right"></i></span>');
      out.push(`<div class="flow-card"><div class="block-heading">ATTACK FLOW</div><div class="flow-track">${nodes}</div></div>`);
      continue;
    }

    if(/^:::command\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const split=arr.join("\n").split(/^\s*---\s*OUTPUT\s*---\s*$/im);
      const cmd=split[0].trim(); const output=(split[1]||"").trim();
      out.push(`<div class="command-output-card"><div class="block-heading">COMMAND + OUTPUT</div><div class="command-part"><span>COMMAND</span><pre>${esc(cmd)}</pre>${copyButton(cmd)}</div>${output?`<div class="output-part"><span>OUTPUT</span><pre>${esc(output)}</pre>${copyButton(output)}</div>`:""}</div>`);
      continue;
    }

    if(/^:::credentials\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const rows=arr.filter(Boolean).map(x=>{const m=x.match(/^([^:]+):\s*(.*)$/); return m?`<div><span>${esc(m[1].trim())}</span><code>${esc(m[2].trim())}</code></div>`:`<div><span>VALUE</span><code>${esc(x)}</code></div>`}).join("");
      out.push(`<div class="credentials-card"><div class="block-heading">CREDENTIALS / LOOT</div>${rows}</div>`);
      continue;
    }

    if(/^:::ioc\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const rows=arr.filter(Boolean).map(x=>{const m=x.match(/^([^:]+):\s*(.*)$/); return m?`<div><span>${esc(m[1].trim())}</span><strong>${esc(m[2].trim())}</strong></div>`:`<div><span>IOC</span><strong>${esc(x)}</strong></div>`}).join("");
      out.push(`<div class="ioc-card"><div class="block-heading">INDICATORS OF COMPROMISE</div>${rows}</div>`);
      continue;
    }

    if(/^:::flag\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      out.push(`<div class="flag-card"><div class="flag-icon"><i class="fa-solid fa-flag"></i></div><div><div class="block-heading">FLAG / PROOF CAPTURED</div><code>${esc(arr.join(" ").trim())}</code></div></div>`);
      continue;
    }

    if(/^:::(tip|warning|danger|success)\b/i.test(l)){
      const kind=(l.trim().split(/\s+/)[0].replace(/^:::/,"")||"tip").toLowerCase();
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const labels={tip:"TIP",warning:"WARNING",danger:"DANGER",success:"SUCCESS"};
      out.push(`<div class="callout ${kind}"><strong>${labels[kind]}</strong><div>${miniMarkdown(arr.join("\n"))}</div></div>`);
      continue;
    }

    if(/^:::gallery\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const cards=arr.filter(x=>/^!\[/.test(x.trim())).map((x,n)=>{
        const m=x.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)/);
        return m?`<figure><div class="gallery-placeholder" data-src="${esc(safeUrl(m[2],true))}"><img src="${esc(safeUrl(m[2],true))}" alt="${esc(m[1])}" onerror="this.parentElement.classList.add('missing');this.style.display='none'"></div><figcaption>${esc(m[1]||`Evidence ${n+1}`)}</figcaption></figure>`:"";
      }).join("");
      out.push(`<section class="evidence-gallery"><div class="block-heading">EVIDENCE GALLERY</div><div class="gallery-grid">${cards}</div></section>`);
      continue;
    }

    if(/^:::lifecycle\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const stages=["Discovered","Validated","Exploited","Remediated","Closed"];
      const rows=arr.filter(Boolean).map((x,n)=>{
        const m=x.match(/^([^|]+)\|(.+)$/);
        return `<div class="lifecycle-step"><span>${String(n+1).padStart(2,"0")}</span><div><strong>${esc((m?m[1]:stages[n]||"Stage").trim())}</strong><p>${inline((m?m[2]:x).trim())}</p></div></div>`;
      }).join("");
      out.push(`<section class="lifecycle-card"><div class="block-heading">VULNERABILITY LIFECYCLE</div>${rows}</section>`);
      continue;
    }

    if(/^:::impact\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const rows=arr.filter(Boolean).map(x=>{const m=x.match(/^([^:]+):\s*(.*)$/);return `<div><span>${esc((m?m[1]:"Impact").trim())}</span><strong>${inline((m?m[2]:x).trim())}</strong></div>`}).join("");
      out.push(`<section class="impact-card"><div class="block-heading">IMPACT</div>${rows}</section>`);
      continue;
    }

    if(/^:::exploitability\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const rows=arr.filter(Boolean).map(x=>{const m=x.match(/^([^:]+):\s*(.*)$/);return `<div><span>${esc((m?m[1]:"Factor").trim())}</span><strong>${inline((m?m[2]:x).trim())}</strong></div>`}).join("");
      out.push(`<section class="exploitability-card"><div class="block-heading">EXPLOITABILITY</div>${rows}</section>`);
      continue;
    }

    if(/^:::remediation\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      out.push(`<section class="remediation-card"><div class="block-heading">REMEDIATION</div><div>${miniMarkdown(arr.join("\n"))}</div></section>`);
      continue;
    }

    if(/^:::recon\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const rows=arr.filter(Boolean).map(x=>{const m=x.match(/^([^:]+):\s*(.*)$/);return `<div><span>${esc((m?m[1]:"Metric").trim())}</span><strong>${inline((m?m[2]:x).trim())}</strong></div>`}).join("");
      out.push(`<section class="recon-dashboard"><div class="block-heading">RECON DASHBOARD</div><div class="dashboard-grid">${rows}</div></section>`);
      continue;
    }

    if(/^:::portscan\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const rows=arr.filter(Boolean).map(x=>x.split("|").map(v=>v.trim())).filter(r=>r.length>=3).map(r=>`<tr>${r.slice(0,4).map((c,n)=>`<${n===3?"td":"td"}>${inline(c)}</td>`).join("")}</tr>`).join("");
      out.push(`<section class="portscan-card"><div class="block-heading">PORT SCAN</div><table><thead><tr><th>PORT</th><th>SERVICE</th><th>VERSION</th><th>STATE</th></tr></thead><tbody>${rows}</tbody></table></section>`);
      continue;
    }

    if(/^:::directories\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const rows=arr.filter(Boolean).map(x=>x.split("|").map(v=>v.trim())).filter(r=>r.length>=2).map(r=>`<tr>${r.map(c=>`<td>${inline(c)}</td>`).join("")}</tr>`).join("");
      out.push(`<section class="directories-card"><div class="block-heading">DIRECTORY ENUMERATION</div><table><thead><tr><th>PATH</th><th>STATUS</th><th>NOTE</th></tr></thead><tbody>${rows}</tbody></table></section>`);
      continue;
    }

    if(/^:::interactive\b/i.test(l)){
      const lang=(l.trim().split(/\s+/)[1]||"bash").toUpperCase();
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const split=arr.join("\n").split(/^\s*---\s*OUTPUT\s*---\s*$/im);
      const code=split[0].trim(), output=(split[1]||"").trim();
      out.push(`<section class="interactive-code-card"><div class="interactive-head"><span>${esc(lang)}</span><div>${copyButton(code)}<button class="interactive-toggle" type="button"><i class="fa-regular fa-eye"></i><span>Show Output</span></button></div></div><pre class="interactive-code">${esc(code)}</pre><pre class="interactive-output" hidden>${esc(output||"No output supplied.")}</pre></section>`);
      continue;
    }

    if(/^:::splithttp\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const parts=arr.join("\n").split(/^\s*---\s*RESPONSE\s*---\s*$/im);
      const req=parts[0].replace(/^\s*---\s*REQUEST\s*---\s*/i,"").trim(), res=(parts[1]||"").trim();
      out.push(`<section class="split-http-card"><div class="block-heading">REQUEST / RESPONSE</div><div class="split-http-grid"><div><div class="split-label">REQUEST</div><pre>${esc(req)}</pre>${copyButton(req)}</div><div><div class="split-label">RESPONSE</div><pre>${esc(res)}</pre>${copyButton(res)}</div></div></section>`);
      continue;
    }

    if(/^:::toc\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const links=arr.filter(x=>/^#{1,3}\s+/.test(x)).map(x=>{
        const level=(x.match(/^#+/)||["#"])[0].length;
        const text=x.replace(/^#{1,3}\s+/,"").trim();
        const id=text.toLowerCase().replace(/[^a-z0-9\s-]/g,"").replace(/[\s_-]+/g,"-").replace(/^-+|-+$/g,"")||"section";
        return `<li class="toc-level-${level}"><a href="#${esc(id)}">${inline(text)}</a></li>`;
      }).join("");
      out.push(`<nav class="inline-toc"><div class="block-heading">CONTENTS</div><ol>${links}</ol></nav>`);
      continue;
    }

    if(/^:::summary\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      out.push(`<section class="executive-summary"><div class="block-heading">EXECUTIVE SUMMARY</div>${miniMarkdown(arr.join("\n"))}</section>`);
      continue;
    }

    if(/^:::findingid\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const rows=arr.filter(Boolean).map(x=>{const m=x.match(/^([^:]+):\s*(.*)$/);return `<div><span>${esc((m?m[1]:"Field").trim())}</span><strong>${inline((m?m[2]:x).trim())}</strong></div>`}).join("");
      out.push(`<section class="finding-id-card"><div class="block-heading">FINDING ID</div>${rows}</section>`);
      continue;
    }

    if(/^:::mapping\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const rows=arr.filter(Boolean).map(x=>{const m=x.split("|").map(v=>v.trim());return `<div><span>${inline(m[0]||"Mapping")}</span><strong>${inline(m.slice(1).join(" | "))}</strong></div>`}).join("");
      out.push(`<section class="mapping-card"><div class="block-heading">CWE / OWASP MAPPING</div>${rows}</section>`);
      continue;
    }

    if(/^:::references\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const rows=arr.filter(Boolean).map(x=>{const m=x.split("|").map(v=>v.trim());return `<li>${m[1]?`<a href="${esc(safeUrl(m[1]))}" target="_blank" rel="noopener">${inline(m[0])}</a>`:inline(x)}</li>`}).join("");
      out.push(`<section class="references-card"><div class="block-heading">REFERENCES</div><ol>${rows}</ol></section>`);
      continue;
    }

    if(/^:::spoiler\b/i.test(l)){
      const title=l.replace(/^:::spoiler\s*/i,"").trim()||"Hidden content";
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      out.push(`<details class="spoiler-card"><summary>${esc(title)}</summary><div>${miniMarkdown(arr.join("\n"))}</div></details>`);
      continue;
    }

    if(/^:::anchor\b/i.test(l)){
      const id=(l.trim().split(/\s+/)[1]||"section").replace(/[^a-z0-9_-]/gi,"-").toLowerCase();
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      out.push(`<section id="${esc(id)}" class="anchor-block">${renderMarkdown(arr.join("\n"), false)}</section>`);
      continue;
    }

    if(/^:::timeline\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const rows=arr.filter(Boolean).map((x,n)=>{const m=x.match(/^([^|]+)\|(.+)$/); const t=m?m[1].trim():String(n+1).padStart(2,"0"); const text=m?m[2].trim():x; return `<div class="timeline-row"><span>${esc(t)}</span><div>${inline(text)}</div></div>`}).join("");
      out.push(`<div class="timeline-card"><div class="block-heading">TIMELINE</div>${rows}</div>`);
      continue;
    }

    if(/^:::tree\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      out.push(`<div class="tree-card"><div class="block-heading">FILE / DIRECTORY TREE</div><pre>${esc(arr.join("\n"))}</pre></div>`);
      continue;
    }

    if(/^:::compare\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      const rows=arr.filter(Boolean).map(x=>x.split("|").map(v=>v.trim())).filter(r=>r.length>=2);
      out.push(`<div class="compare-card"><div class="block-heading">COMPARISON</div><div class="compare-grid">${rows.map(r=>`<div><span>BEFORE</span><p>${inline(r[0])}</p></div><div><span>AFTER</span><p>${inline(r.slice(1).join(" | "))}</p></div>`).join("")}</div></div>`);
      continue;
    }

    if(/^:::screenshot\b/i.test(l)){
      const arr=[];i++;
      while(i<lines.length&&!/^:::\s*$/.test(lines[i])){arr.push(lines[i]);i++;}
      if(i<lines.length)i++;
      let imageLine=arr.find(x=>/^!\[/.test(x.trim()));
      const notes=arr.filter(x=>x!==imageLine&&x.trim()).map(x=>x.replace(/^[-*]\s*/,""));
      const imageMatch=imageLine?.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      const image=imageMatch?`<img src="${esc(safeUrl(imageMatch[2],true))}" alt="${esc(imageMatch[1])}" onerror="this.style.display='none'">`:"";
      out.push(`<figure class="screenshot-card">${image}<figcaption>${esc(imageMatch?.[1]||"Screenshot")}</figcaption>${notes.length?`<div class="annotation-list">${notes.map((x,n)=>`<div><span>${n+1}</span>${inline(x)}</div>`).join("")}</div>`:""}</figure>`);
      continue;
    }

    if(/^:::\s*$/.test(l)){i++;continue;}

    if(/^!\[/.test(l)&&l.includes("](")){
      const m=l.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if(m){
        out.push(`<figure class="evidence-card"><img src="${esc(safeUrl(m[2],true))}" alt="${esc(m[1])}" onerror="this.style.display='none'"><figcaption>${esc(m[1])}</figcaption></figure>`);
        i++;continue;
      }
    }

    if(/^>\s*\[!/.test(l)){
      const kind=(l.match(/\[!(.*?)\]/)||[])[1]||"NOTE";
      const arr=[];i++;
      while(i<lines.length&&/^>/.test(lines[i])){arr.push(lines[i].replace(/^>\s?/,"").trim());i++;}
      out.push(`<div class="callout ${kind.toLowerCase()}"><strong>${esc(kind)}</strong><div>${inline(arr.join(" "))}</div></div>`);
      continue;
    }

    if(l.trim()==="---"){out.push("<hr>");i++;continue;}

    if(l.startsWith("|")){
      const rows=[];
      while(i<lines.length&&lines[i].startsWith("|")){rows.push(lines[i]);i++;}
      if(rows.length>=2){
        const head=rows[0].split("|").slice(1,-1);
        const body=rows.slice(2).map(r=>r.split("|").slice(1,-1));
        out.push(`<div class="table-card"><table><thead><tr>${head.map(c=>`<th>${inline(c.trim())}</th>`).join("")}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${inline(c.trim())}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
    }

    if(/^#{1,3}\s/.test(l)){
      const level=l.match(/^#+/)[0].length;
      out.push(`<h${level}>${inline(l.replace(/^#+\s/,""))}</h${level}>`);
      i++;continue;
    }

    if(/^\d+\.\s/.test(l)){
      const arr=[];
      while(i<lines.length&&/^\d+\.\s/.test(lines[i])){arr.push(lines[i].replace(/^\d+\.\s/,""));i++;}
      out.push(`<ol>${arr.map(x=>`<li>${inline(x)}</li>`).join("")}</ol>`);
      continue;
    }

    if(/^[-*]\s/.test(l)){
      const arr=[];
      while(i<lines.length&&/^[-*]\s/.test(lines[i])){arr.push(lines[i].replace(/^[-*]\s/,""));i++;}
      out.push(`<ul>${arr.map(x=>`<li>${inline(x)}</li>`).join("")}</ul>`);
      continue;
    }

    const para=[l];i++;
    while(i<lines.length&&lines[i].trim()&&!/^#|^\s*```|^:::|^>|^\||^[-*]\s/.test(lines[i])){
      para.push(lines[i]);i++;
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }

  const title=fields.title.value.trim()||"Untitled Security Write-up";
  const category=fields.category.value.trim()||"SECURITY WRITE-UP";
  const date=fields.date.value||today();

  const renderedHtml = out.join("");
  if(updatePreview){
    /* Preserve the reader's position unless they were already at the bottom.
       When content grows while typing, a preview that is already being read at
       the bottom follows the new content just like the Markdown editor does. */
    const previewWasAtBottom = preview
      ? (preview.scrollHeight - preview.scrollTop - preview.clientHeight) <= 28
      : false;

    preview.innerHTML=`<div class="eyebrow">${esc(category)} · ${esc(date)}</div><h1>${esc(title)}</h1>${fields.excerpt.value.trim()?`<p class="preview-intro">${esc(fields.excerpt.value.trim())}</p>`:""}${renderedHtml}`;
    $("#lineCount").textContent=`${lines.length} lines`;

    if(previewWasAtBottom){
      requestAnimationFrame(()=>{
        preview.scrollTop=Math.max(0,preview.scrollHeight-preview.clientHeight);
      });
    }
  }
  return renderedHtml;
}

function getState(){
  return {
    title:fields.title.value,
    category:fields.category.value,
    date:fields.date.value,
    excerpt:fields.excerpt.value,
    tags:fields.tags.value,
    source:source.value
  };
}

function applyState(data={}){
  fields.title.value=data.title??data.titleInput??"";
  fields.category.value=data.category??data.tagInput??"TRYHACKME";
  fields.date.value=data.date??data.dateInput??today();
  fields.excerpt.value=data.excerpt??"";
  fields.tags.value=data.tags??"";
  syncDateDisplay();
  calendarCursor=new Date(fields.date.value||today()+"T00:00:00");
  calendarCursor.setDate(1);
  renderMarkdown();
}

function saveDraft(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(getState()));
  $("#saveState").innerHTML='<span></span> Draft saved locally';
  flash("Draft saved locally");
}

function scheduleSave(){
  $("#saveState").innerHTML='<span style="background:#a98cff;box-shadow:0 0 10px rgba(169,140,255,.45)"></span> Saving…';
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>localStorage.setItem(STORAGE_KEY,JSON.stringify(getState())),350);
  renderMarkdown();
}

function flash(text){
  const msg=$("#message");
  if(msg) msg.textContent=text;
  clearTimeout(flash.timer);
  flash.timer=setTimeout(()=>{if(msg)msg.textContent=""},1700);
}

async function copyText(text,button=null){
  try{
    await navigator.clipboard.writeText(text);
  }catch{
    const ta=document.createElement("textarea");
    ta.value=text;
    ta.style.position="fixed";
    ta.style.opacity="0";
    document.body.appendChild(ta);
    ta.focus();ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  if(button) setCopied(button);
}

function setCopied(button){
  if(!button)return;
  button.classList.add("copied");
  const icon=button.querySelector("i");
  const label=button.querySelector("span");
  if(icon) icon.className="fa-solid fa-check";
  if(label) label.textContent="Copied";
  clearTimeout(button._copyTimer);
  button._copyTimer=setTimeout(()=>{
    button.classList.remove("copied");
    if(icon) icon.className="fa-regular fa-copy";
    if(label){
      if(button.id==="copyEntryBtn") label.textContent="Copy Portfolio Entry";
      else if(button.id==="copyHtmlBtn") label.textContent="Copy HTML";
      else label.textContent="Copy";
    }
  },1200);
}

function insertAtSelection(before,after="",placeholder="text"){
  const start=source.selectionStart,end=source.selectionEnd;
  const selected=source.value.slice(start,end)||placeholder;
  source.setRangeText(before+selected+after,start,end,"select");
  source.focus();scheduleSave();
}

function makeBlockId(){
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^a-z0-9-]/gi,"");
}
function wrapInsertedBlock(text,type){
  const id=makeBlockId();
  return `<!-- BLOCK:${type}:${id} -->\n${text.trim()}\n<!-- /BLOCK:${type}:${id} -->`;
}
function insertBlockText(text,type=null){
  const pos=source.selectionStart;
  const prefix=source.value&&pos>0&&!source.value.slice(0,pos).endsWith("\n")?"\n\n":"";
  const payload=type ? wrapInsertedBlock(text,type) : text;
  source.value=source.value.slice(0,pos)+prefix+payload+source.value.slice(source.selectionEnd);
  source.focus();
  source.selectionStart=source.selectionEnd=pos+prefix.length+payload.length;
  autoGrowSource();
  renderMarkdown();
  scheduleSave();
}

function slugFolder(value){
  return slugify(value).replace(/-/g,"-") || "writeup";
}

function assetExtension(file){
  const match=(file.name||"").match(/\.([a-z0-9]+)$/i);
  return match ? `.${match[1].toLowerCase()}` : ".png";
}

function nextAssetName(type, extension){
  const prefix=type === "screenshot" ? "screenshot" : "evidence";
  const re=new RegExp(`!\\[[^\\]]*\\]\\(\\./${prefix}_(\\d+)\\.[^)]+\\)`,"gi");
  let max=0, m;
  while((m=re.exec(source.value))) max=Math.max(max,Number(m[1])||0);
  return `${prefix}_${max+1}${extension}`;
}

const FS_DB_NAME = "sardhon-writeup-filesystem";
const FS_DB_VERSION = 1;
const FS_STORE = "handles";

function openFilesystemDB(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
    const req=window.indexedDB.open(FS_DB_NAME,FS_DB_VERSION);
    req.onupgradeneeded=()=>req.result.createObjectStore(FS_STORE);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error("Could not open filesystem database"));
  });
}

async function loadStoredProjectHandle(){
  try{
    const db=await openFilesystemDB();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(FS_STORE,"readonly");
      const req=tx.objectStore(FS_STORE).get("project-root");
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error);
    });
  }catch{return null;}
}

async function storeProjectHandle(handle){
  try{
    const db=await openFilesystemDB();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(FS_STORE,"readwrite");
      tx.objectStore(FS_STORE).put(handle,"project-root");
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
    });
  }catch{}
}

async function clearStoredProjectHandle(){
  try{
    const db=await openFilesystemDB();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(FS_STORE,"readwrite");
      tx.objectStore(FS_STORE).delete("project-root");
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
    });
  }catch{}
}

async function requestWritePermission(handle){
  try{
    if(handle.queryPermission){
      const current=await handle.queryPermission({mode:"readwrite"});
      if(current==="granted") return true;
    }
    if(handle.requestPermission){
      const result=await handle.requestPermission({mode:"readwrite"});
      return result==="granted";
    }
    return true;
  }catch{
    return false;
  }
}

async function validateProjectFolder(handle){
  if(!handle) return false;
  const hasEditor=await readTextFromHandle(handle,"editor.html");
  const hasWriteups=await readTextFromHandle(handle,"writeups.html");
  return hasEditor!==null && hasWriteups!==null;
}

async function connectProjectFolder(){
  if(!window.showDirectoryPicker){
    flash("Use Chrome or Edge to connect the portfolio folder");
    return false;
  }

  try{
    const picked=await window.showDirectoryPicker({
      mode:"readwrite",
      id:"sardhon-static-portfolio"
    });

    if(!(await validateProjectFolder(picked))){
      flash("Select the Sardhon_Static_Portfolio folder");
      return false;
    }

    if(!(await requestWritePermission(picked))){
      flash("Write permission was not granted");
      return false;
    }

    projectRootHandle=picked;
    await storeProjectHandle(picked);

    const tmp=await projectRootHandle.getDirectoryHandle("tmp",{create:true});
    const draftFolder=await tmp.getDirectoryHandle(`writeup-${DRAFT_ID}`,{create:true});
    tempAssetHandle=draftFolder;

    updateProjectConnectionUI(true);
    flash("Portfolio folder connected — publishing is ready");
    return true;
  }catch(err){
    if(err?.name !== "AbortError") flash("Could not connect the portfolio folder");
    return false;
  }
}

async function ensureProjectRoot(){
  if(!window.showDirectoryPicker){
    updateProjectConnectionUI(false);
    flash("Folder publishing requires Chrome or Edge");
    return false;
  }

  // Reuse a previously granted folder handle when possible.
  if(!projectRootHandle){
    const stored=await loadStoredProjectHandle();
    if(stored){
      try{
        if(await validateProjectFolder(stored) && await requestWritePermission(stored)){
          projectRootHandle=stored;
        }else{
          await clearStoredProjectHandle();
        }
      }catch{
        await clearStoredProjectHandle();
      }
    }
  }

  // If there is no usable stored handle, explicitly connect the folder.
  if(!projectRootHandle){
    return await connectProjectFolder();
  }

  try{
    const tmp=await projectRootHandle.getDirectoryHandle("tmp",{create:true});
    const draftFolder=await tmp.getDirectoryHandle(`writeup-${DRAFT_ID}`,{create:true});
    tempAssetHandle=draftFolder;
    updateProjectConnectionUI(true);
    return true;
  }catch{
    projectRootHandle=null;
    await clearStoredProjectHandle();
    return await connectProjectFolder();
  }
}

function updateProjectConnectionUI(connected){
  const btn=$("#connectFolderBtn");
  const state=$("#projectConnectionState");
  if(btn){
    btn.classList.toggle("connected",!!connected);
    const icon=btn.querySelector("i");
    const label=btn.querySelector("span");
    if(icon) icon.className=connected ? "fa-solid fa-folder-check" : "fa-solid fa-folder-open";
    if(label) label.textContent=connected ? "Portfolio Connected" : "Connect Portfolio Folder";
  }
  if(state) state.textContent=connected ? "Folder connected" : "Folder not connected";
}

async function storeTempAsset(file, name){
  const dataUrl=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
  pendingAssets.set(name,{name,file,dataUrl});
  if(tempAssetHandle){
    try{
      const handle=await tempAssetHandle.getFileHandle(name,{create:true});
      const writable=await handle.createWritable();
      await writable.write(file);
      await writable.close();
    }catch{ /* Preview/local publishing still works if temporary disk write fails. */ }
  }
}

async function handleAssetSelection(file,type){
  if(!file) return;
  const name=nextAssetName(type,assetExtension(file));
  await storeTempAsset(file,name);
  const label=type === "screenshot" ? "Screenshot" : "Evidence";
  if(type === "screenshot") insertBlockText(`:::screenshot\n![Screenshot](./${name})\n1 — Highlight the important evidence.\n2 — Explain what the reader should notice.\n:::\n`);
  else insertBlockText(`![Evidence](./${name})\n\n*Figure: Evidence captured during testing.*\n`);
  flash(`${label} inserted`);
}

async function openAssetPicker(type){
  const input=type === "screenshot" ? screenshotInput : evidenceInput;
  if(!input) return;

  // Selecting an image must not depend on project-folder permission.
  // The selected File is staged in memory and copied to Write-ups/images
  // during publishing.
  input.value="";
  input.dataset.assetType=type;
  input.click();
}

function toolbarAction(action){
  if(action==="h1")return insertBlockText("# Section title");
  if(action==="h2")return insertBlockText("## Section title");
  if(action==="h3")return insertBlockText("### Subsection");
  if(action==="bold")return insertAtSelection("**","**","important text");
  if(action==="italic")return insertAtSelection("*","*","emphasis");
  if(action==="code")return insertAtSelection("`","`","command");
  if(action==="codeblock")return insertBlockText("```bash\nnmap -sC -sV TARGET\n```");
  if(action==="quote")return insertBlockText("> Evidence or an important observation.");
  if(action==="ul")return insertBlockText("- Observation one\n- Observation two");
  if(action==="ol")return insertBlockText("1. First step\n2. Second step");
  if(action==="link")return insertAtSelection("[","](https://example.com)","link text");
  if(action==="image")return openAssetPicker("screenshot");
  if(action==="finding")return insertBlockText(":::finding HIGH\n### Vulnerability Finding\nDescribe the vulnerability and evidence.\n:::");
}

const defaultTemplates={
  ctf:`# Context
Describe the CTF room, machine or challenge.

:::summary
Objective: Capture the flag in the authorized challenge.
Scope: Challenge host and exposed services.
Key path: Replace this with the attack path.
Overall risk: N/A
:::

## Reconnaissance
:::recon
Target: 10.10.10.10
OS: Linux
Open Ports: 22, 80
Technologies: Web, SSH
Attack Surface: Web + SSH
:::

:::portscan
22 | SSH | OpenSSH | open
80 | HTTP | Apache | open
:::

## Enumeration
:::directories
/ | 200 | Home
/admin | 403 | Admin
/login | 200 | Login
:::

## Initial Access
Document the controlled exploitation path.

## Privilege Escalation
Document the escalation path.

## Flags / Proof
:::spoiler Flag
THM{example_flag_here}
:::

## Lessons Learned
Summarize the key lessons.`,
  pentest:`# Executive Summary
:::summary
Objective: Assess the authorized target.
Scope: Web application and exposed services.
Key finding: Replace this with the principal security finding.
Overall risk: Medium
:::

## Reconnaissance
:::recon
Target: example.local
OS: Linux
Open Ports: 22, 80, 443
Technologies: Nginx, PHP
Attack Surface: Web + SSH
:::

## Findings
:::findingid
Finding ID: WEB-001
Title: Broken Access Control
Status: Open
Severity: High
:::

:::mapping
CWE-639 | Authorization Bypass Through User-Controlled Key
OWASP A01:2021 | Broken Access Control
:::

:::impact
Confidentiality: HIGH
Integrity: HIGH
Availability: LOW
Business impact: Unauthorized access to sensitive data.
:::

## Remediation
:::remediation
Apply server-side authorization checks and verify object ownership.
Retest all object-level endpoints after the fix.
:::

## References
:::references
OWASP Web Security Testing Guide | https://owasp.org/www-project-web-security-testing-guide/
CWE-639 | https://cwe.mitre.org/data/definitions/639.html
:::`,
  finding:`# Vulnerability Finding
:::findingid
Finding ID: WEB-001
Title: Broken Access Control
Status: Open
Severity: High
:::

## Finding
Explain what is vulnerable and where.

:::exploitability
Attack Vector: Network
Privileges Required: Low
User Interaction: None
Complexity: Low
:::

## Evidence
:::gallery
![Evidence 1](./evidence_1.png)
![Evidence 2](./evidence_2.png)
:::

## Impact
:::impact
Confidentiality: HIGH
Integrity: HIGH
Availability: LOW
Business impact: Explain the affected asset and consequence.
:::

## Remediation
:::remediation
Describe the recommended fix and how it should be verified.
:::

:::mapping
CWE-639 | Authorization Bypass Through User-Controlled Key
OWASP A01:2021 | Broken Access Control
:::`,
  soc:`# SOC Investigation
:::summary
Objective: Investigate a suspicious host or activity.
Scope: Authorized logs, endpoints and network telemetry.
Key finding: Replace with the investigation conclusion.
Overall risk: Medium
:::

## Timeline
:::timeline
09:14 | Suspicious process observed
09:18 | Host triage started
09:23 | IOC confirmed
09:27 | Containment completed
:::

## Recon Dashboard
:::recon
Target: HOST-001
OS: Windows
Open Ports: 445, 3389
Technologies: SMB, RDP
Attack Surface: Internal network
:::

## Indicators
:::ioc
IP Address: 10.10.10.5
Domain: suspicious.example
File: suspicious.exe
Hash: SHA256: ...
:::

## Analysis
Document process, network and authentication evidence.

## Remediation
:::remediation
Contain the host, remove persistence, reset affected credentials and validate recovery.
:::

## References
:::references
MITRE ATT&CK | https://attack.mitre.org/
OWASP | https://owasp.org/
:::`,
  blank:""
};

const blocks=[
  ["fa-solid fa-heading","Text / Heading","text"],
  ["fa-solid fa-code","Code Block","code"],
  ["fa-solid fa-terminal","Terminal Block","terminal"],
  ["fa-solid fa-arrow-right-arrow-left","HTTP Request","http"],
  ["fa-solid fa-arrow-right-arrow-left","HTTP Response","response"],
  ["fa-regular fa-image","Image / Evidence","evidence"],
  ["fa-solid fa-images","Evidence Gallery","gallery"],
  ["fa-solid fa-camera","Screenshot + Annotation","screenshot"],
  ["fa-solid fa-bug","Finding / Vulnerability","finding"],
  ["fa-solid fa-shield-halved","Vulnerability Summary","vulnerability"],
  ["fa-solid fa-wave-square","Vulnerability Lifecycle","lifecycle"],
  ["fa-solid fa-list-ol","Steps / Procedure","steps"],
  ["fa-solid fa-diagram-project","Attack Flow","flow"],
  ["fa-solid fa-code-compare","Command + Output","command"],
  ["fa-solid fa-key","Credentials / Loot","credentials"],
  ["fa-solid fa-fingerprint","IOC / Artifact","ioc"],
  ["fa-solid fa-circle-info","Callout / Note","callout"],
  ["fa-solid fa-lightbulb","Tip","tip"],
  ["fa-solid fa-triangle-exclamation","Warning","warning"],
  ["fa-solid fa-skull-crossbones","Danger","danger"],
  ["fa-solid fa-circle-check","Success","success"],
  ["fa-solid fa-flag","Success / Flag","flag"],
  ["fa-solid fa-table","Table","table"],
  ["fa-solid fa-route","Attack Chain","attack"],
  ["fa-solid fa-crosshairs","MITRE ATT&CK","mitre"],
  ["fa-solid fa-gauge-high","CVSS Calculator","cvss"],
  ["fa-solid fa-chart-line","Impact Block","impact"],
  ["fa-solid fa-bolt","Exploitability Block","exploitability"],
  ["fa-solid fa-wrench","Remediation Block","remediation"],
  ["fa-solid fa-radar","Recon Dashboard","recon"],
  ["fa-solid fa-network-wired","Port Scan Block","portscan"],
  ["fa-solid fa-folder-open","Directory Enumeration","directories"],
  ["fa-solid fa-terminal","Interactive Code Block","interactive"],
  ["fa-solid fa-code-branch","Request / Response Split View","splithttp"],
  ["fa-solid fa-clock-rotate-left","Timeline","timeline"],
  ["fa-solid fa-folder-tree","File / Directory Tree","tree"],
  ["fa-solid fa-table-columns","Two-Column Comparison","compare"],
  ["fa-solid fa-minus","Divider","divider"],
  ["fa-solid fa-list","Table of Contents","toc"],
  ["fa-solid fa-list-check","Executive Summary","summary"],
  ["fa-solid fa-fingerprint","Finding ID","findingid"],
  ["fa-solid fa-link","CWE / OWASP Mapping","mapping"],
  ["fa-solid fa-book","References","references"],
  ["fa-solid fa-eye-slash","Spoiler Block","spoiler"],
  ["fa-solid fa-anchor","Anchor Link","anchor"]
];

const snippets={
  text:"## New Section\nDescribe the context, observation or result here.\n",
  code:"```bash\nnmap -sC -sV TARGET\n```\n",
  terminal:"```terminal\n$ whoami\n$ id\n```\n",
  http:"```http\nGET /profile?id=123 HTTP/1.1\nHost: example.com\nCookie: session=...\n```\n",
  response:"```http-response\nHTTP/1.1 200 OK\nContent-Type: application/json\n\n{\"status\":\"ok\"}\n```\n",
  evidence:"![Evidence](./evidence_1.png)\n\n*Figure: Evidence captured during testing.*\n",
  gallery:":::gallery\n![Evidence 1](./evidence_1.png)\n![Evidence 2](./evidence_2.png)\n![Evidence 3](./evidence_3.png)\n:::\n",
  screenshot:":::screenshot\n![Screenshot](./screenshot_1.png)\n1 — Highlight the vulnerable parameter.\n2 — Show the server response.\n:::\n",
  finding:":::finding HIGH\n### IDOR — Broken Access Control\nAn authenticated user can access another user's object by changing an identifier.\n:::\n",
  vulnerability:":::vulnerability HIGH SQL Injection\nCWE: CWE-89\nOWASP: A03:2021\nAffected endpoint: /search?q=\n\nExplain the issue, impact and evidence here.\n:::\n",
  lifecycle:":::lifecycle\nDiscovered | Reconnaissance revealed the attack surface.\nValidated | Reproduced the issue in the authorized environment.\nExploited | Demonstrated controlled impact.\nRemediated | Applied and verified the fix.\n:::\n",
  steps:":::steps\n1. Discover the parameter.\n2. Test the input.\n3. Confirm the vulnerability.\n4. Document the impact.\n:::\n",
  flow:":::flow\nReconnaissance\nEnumeration\nInitial Access\nPrivilege Escalation\nProof / Flag\n:::\n",
  command:":::command\nnmap -sC -sV TARGET\n--- OUTPUT ---\n22/tcp open ssh\n80/tcp open http\n:::\n",
  credentials:":::credentials\nUsername: admin\nPassword: ********\nSource: /var/www/html/config.php\n:::\n",
  ioc:":::ioc\nIP Address: 10.10.10.5\nDomain: example.local\nFile: shell.php\nHash: SHA256: ...\n:::\n",
  callout:"> [!NOTE]\n> Important observation for the reader.\n",
  tip:":::tip\nUse this when a useful technique or shortcut deserves extra attention.\n:::\n",
  warning:":::warning\nThis action may change or destroy data in the target lab.\n:::\n",
  danger:":::danger\nOnly run this command against systems you are authorized to test.\n:::\n",
  success:":::success\nThe vulnerability was successfully reproduced.\n:::\n",
  flag:":::flag\nTHM{example_flag_here}\n:::\n",
  table:"| Port | Service | Version |\n| --- | --- | --- |\n| 22 | SSH | OpenSSH |\n| 80 | HTTP | Apache |\n",
  attack:":::attack\n1. Reconnaissance\n2. Enumeration\n3. Initial Access\n4. Privilege Escalation\n5. Proof / Flag\n:::\n",
  mitre:":::mitre\nT1059 — Command and Scripting Interpreter\nT1071 — Application Layer Protocol\n:::\n",
  cvss:":::cvss 6.5 MEDIUM\nAV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N\n:::\n",
  impact:":::impact\nConfidentiality: HIGH\nIntegrity: HIGH\nAvailability: LOW\nBusiness impact: Unauthorized access to sensitive user data.\n:::\n",
  exploitability:":::exploitability\nAttack Vector: Network\nPrivileges Required: Low\nUser Interaction: None\nComplexity: Low\nExploit maturity: Demonstrated\n:::\n",
  remediation:":::remediation\nFix the vulnerable input handling with server-side validation and parameterized queries.\nVerify the fix with regression tests and a focused retest.\n:::\n",
  recon:":::recon\nTarget: 10.10.10.10\nOS: Linux\nOpen Ports: 22, 80, 443\nTechnologies: Nginx, PHP\nAttack Surface: Web + SSH\n:::\n",
  portscan:":::portscan\n22 | SSH | OpenSSH | open\n80 | HTTP | Apache | open\n443 | HTTPS | nginx | open\n:::\n",
  directories:":::directories\n/ | 200 | Home\n/admin | 403 | Admin panel\n/login | 200 | Login\n/uploads | 301 | Uploads\n:::\n",
  interactive:":::interactive bash\n$ nmap -sC -sV TARGET\n--- OUTPUT ---\n22/tcp open ssh\n80/tcp open http\n:::\n",
  splithttp:":::splithttp\n--- REQUEST ---\nGET /profile?id=123 HTTP/1.1\nHost: example.com\nCookie: session=...\n--- RESPONSE ---\nHTTP/1.1 200 OK\nContent-Type: application/json\n\n{\"status\":\"ok\"}\n:::\n",
  timeline:":::timeline\n09:14 | Initial access\n09:18 | Web shell discovered\n09:23 | Privilege escalation\n09:27 | Root obtained\n:::\n",
  tree:":::tree\n/var/www/html\n├── index.php\n├── login.php\n├── uploads/\n│   ├── shell.php\n│   └── image.png\n└── config.php\n:::\n",
  compare:":::compare\nVulnerable request | Parameterized request\nHTTP | HTTPS\nPlaintext | Encrypted\n:::\n",
  divider:"---\n",
  toc:":::toc\n# Context\n## Reconnaissance\n## Finding\n## Remediation\n:::\n",
  summary:":::summary\nObjective: Assess the authorized target.\nScope: Web application and exposed services.\nKey finding: Replace this with the principal security finding.\nOverall risk: Medium\n:::\n",
  findingid:":::findingid\nFinding ID: WEB-001\nTitle: Broken Access Control\nStatus: Open\nSeverity: High\n:::\n",
  mapping:":::mapping\nCWE-639 | Authorization Bypass Through User-Controlled Key\nOWASP A01:2021 | Broken Access Control\n:::\n",
  references:":::references\nOWASP Web Security Testing Guide | https://owasp.org/www-project-web-security-testing-guide/\nCWE-639 | https://cwe.mitre.org/data/definitions/639.html\n:::\n",
  spoiler:":::spoiler Hidden Evidence\nSensitive evidence is hidden until the reader chooses to reveal it.\n:::\n",
  anchor:":::anchor remediation\n## Remediation\nJump here from another section with [Remediation](#remediation).\n:::\n"
};
const SAVED_BLOCKS_KEY="sardhon-editor-saved-blocks-v1";
function getSavedBlocks(){
  try{return JSON.parse(localStorage.getItem(SAVED_BLOCKS_KEY)||"[]");}catch{return [];}
}
function renderSavedBlocks(){
  const host=$("#savedBlocks"); if(!host) return;
  const saved=getSavedBlocks();
  host.innerHTML=saved.length?saved.map((x,i)=>`<div class="saved-block-row"><button class="block-button saved-block" type="button" data-saved-index="${i}"><i class="fa-regular fa-bookmark"></i><span>${esc(x.name)}</span></button><button class="saved-delete" type="button" data-saved-delete="${i}" title="Delete saved block"><i class="fa-solid fa-xmark"></i></button></div>`).join(""):`<div class="saved-empty">No saved blocks yet.</div>`;
  host.querySelectorAll("[data-saved-index]").forEach(btn=>btn.addEventListener("click",()=>{const item=getSavedBlocks()[Number(btn.dataset.savedIndex)];if(item)insertBlockText(item.text);}));
  host.querySelectorAll("[data-saved-delete]").forEach(btn=>btn.addEventListener("click",()=>{const list=getSavedBlocks();list.splice(Number(btn.dataset.savedDelete),1);localStorage.setItem(SAVED_BLOCKS_KEY,JSON.stringify(list));renderSavedBlocks();}));
}
function saveSelectionAsBlock(){
  const start=source.selectionStart,end=source.selectionEnd;
  const text=source.value.slice(start,end).trim();
  if(!text){flash("Select a block of Markdown first");source.focus();return;}
  const name=prompt("Name this reusable block:","My Security Block");
  if(!name?.trim()) return;
  const list=getSavedBlocks();
  list.unshift({name:name.trim(),text});
  localStorage.setItem(SAVED_BLOCKS_KEY,JSON.stringify(list.slice(0,20)));
  renderSavedBlocks();
  flash("Block saved");
}

function insertSecurityBlock(type){
  if(type === "screenshot") return openAssetPicker("screenshot");
  if(type === "evidence") return openAssetPicker("evidence");
  insertBlockText(snippets[type]||"",type);
}

function getPublishEntry(){
  const title=fields.title.value.trim()||"Untitled Security Write-up";
  const slug=slugify(title)||"writeup";
  const category=fields.category.value.trim()||"SECURITY";
  const date=fields.date.value||today();
  const excerpt=fields.excerpt.value.trim();
  const tags=fields.tags.value.split(",").map(x=>x.trim()).filter(Boolean);
  renderMarkdown();
  return {
    id: slug,
    title, category, date, excerpt, tags,
    slug,
    markdown: source.value,
    html: htmlDocument(),
    contentHtml: preview.innerHTML,
    publishedAt: new Date().toISOString()
  };
}

function entryText(){
  const entry=getPublishEntry();
  return `  {
    title: ${JSON.stringify(entry.title)},
    category: ${JSON.stringify(entry.category)},
    date: ${JSON.stringify(entry.date)},
    excerpt: ${JSON.stringify(entry.excerpt)},
    tags: ${JSON.stringify(entry.tags)},
    url: ${JSON.stringify(`writeups.html?slug=${encodeURIComponent(entry.slug)}`)}
  }`;
}

function getPublished(){
  try { return JSON.parse(localStorage.getItem(PUBLISHED_KEY)||"[]"); }
  catch { return []; }
}

function validatePublish(){
  const required = [fields.title, fields.category, fields.date, fields.excerpt, fields.tags];
  let firstInvalid = null;

  required.forEach(input => {
    const label = input.closest("label");
    const empty = !String(input.value || "").trim();
    input.classList.toggle("invalid", empty);
    if(label) label.classList.toggle("invalid", empty);
    if(input===fields.date && dateControl) dateControl.classList.toggle("invalid", empty);
    if(empty && !firstInvalid) firstInvalid = input;
  });

  if(firstInvalid){
    if(firstInvalid===fields.date) datePickerBtn?.focus();
    else firstInvalid.focus();
    flash("Complete all required metadata before publishing");
    return false;
  }
  return true;
}

function folderSafeTitle(value){
  return (value || "Untitled Security Write-up")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g,"-")
    .replace(/\s+/g," ")
    .trim()
    .replace(/[. ]+$/g,"") || "Untitled Security Write-up";
}

async function writeTextFile(dirHandle,name,text){
  const handle=await dirHandle.getFileHandle(name,{create:true});
  const writable=await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function readTextFromHandle(dirHandle,name){
  try{
    const handle=await dirHandle.getFileHandle(name);
    const file=await handle.getFile();
    return await file.text();
  }catch{return null;}
}

async function updateStaticWriteupsFile(rootHandle,meta){
  try{
    const jsDir=await rootHandle.getDirectoryHandle("js",{create:true});
    const existing=await readTextFromHandle(jsDir,"writeups.js");
    let list=[];
    if(existing){
      try{ list=new Function(`${existing}\nreturn WRITEUPS;`)() || []; }catch{ list=[]; }
    }
    const next={...meta};
    const key=slugify(next.title);
    const filtered=list.filter(x=>slugify(x.title||"")!==key);
    filtered.unshift(next);
    await writeTextFile(jsDir,"writeups.js",`// Generated by the local write-up editor.\nconst WRITEUPS = ${JSON.stringify(filtered,null,2)};\n`);
  }catch(err){
    console.warn("Could not update js/writeups.js",err);
  }
}

const SHARED_WRITEUP_CSS = "/* Sardhon shared write-up theme. Keep this file identical for every published write-up. */\n:root{--writeup-bg:#09080d;--writeup-panel:#0a0910;--writeup-purple:#a98cff;--writeup-bright:#c7b7ff;--writeup-muted:#aaa2bd;--writeup-line:rgba(154,132,210,.18)}\n.writeup{color:#eeeaf7;font-family:Inter,system-ui,sans-serif;line-height:1.65}\n.writeup .eyebrow,.writeup .meta{color:#aa8de0;font:600 10px \"JetBrains Mono\",monospace;letter-spacing:.13em;margin:0}\n.writeup h1{font-size:clamp(38px,4vw,58px);line-height:1.02;margin:12px 0 25px;letter-spacing:-.045em}\n.writeup h2{font-size:27px;line-height:1.2;margin:42px 0 10px}\n.writeup h3{font-size:19px;line-height:1.3;margin:28px 0 8px}\n.writeup p,.writeup li{color:#aaa2bd;line-height:1.75}\n.writeup p{margin:9px 0}\n.writeup ul,.writeup ol{padding-left:23px}\n.writeup a{color:#b59cff}\n.writeup code{font-family:\"JetBrains Mono\",monospace;color:#d7ccff;background:rgba(169,140,255,.07);border:1px solid rgba(169,140,255,.12);border-radius:5px;padding:2px 5px}\n.writeup hr{border:0;border-top:1px solid rgba(154,132,210,.18);margin:28px 0}\n.writeup blockquote{margin:20px 0;padding:13px 16px;border-left:3px solid #a98cff;background:rgba(169,140,255,.045);color:#b7afc7}\n.writeup img{max-width:100%;height:auto}\n.writeup .code-card,.writeup .terminal-card,.writeup .response-card,.writeup .finding-card,.writeup .callout,.writeup .table-card,.writeup .attack-card,.writeup .mitre-card,.writeup .cvss-card,.writeup .evidence-card{margin:18px 0;border:1px solid rgba(154,132,210,.18);background:#0a0910;border-radius:12px;overflow:hidden}\n.writeup .block-top{height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 13px;border-bottom:1px solid rgba(154,132,210,.12);background:#0e0c15;color:#8e82a0;font:600 9px \"JetBrains Mono\",monospace;letter-spacing:.10em}\n.writeup .copy-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(169,140,255,.24);background:#0e0c14;color:#aaa2bd;border-radius:7px;padding:6px 9px;font:600 10px Inter,system-ui,sans-serif;cursor:pointer}\n.writeup .copy-btn:hover{color:#d7ccff;border-color:rgba(184,158,255,.68);box-shadow:0 0 0 1px rgba(169,140,255,.1),0 0 10px rgba(169,140,255,.2)}\n.writeup .copy-btn.copied{color:#b9f0c8;border-color:rgba(126,242,154,.42)}\n.writeup .code-body,.writeup .terminal-body,.writeup .response-body{display:block;margin:0;padding:16px;min-height:48px;max-height:520px;overflow:auto;scrollbar-width:none;white-space:pre-wrap;overflow-wrap:anywhere;color:#cfc2e5;font:12px/1.7 \"JetBrains Mono\",monospace}\n.writeup .code-body::-webkit-scrollbar,.writeup .terminal-body::-webkit-scrollbar,.writeup .response-body::-webkit-scrollbar{display:none;width:0;height:0}\n.writeup .terminal-body{background:linear-gradient(90deg,#0c1014,#090b0f)}\n.writeup .terminal-body:before{content:\"●  ●  ●\";display:block;color:#735b8f;letter-spacing:3px;margin-bottom:10px}\n.writeup .finding-card{border-color:rgba(169,140,255,.25);background:rgba(169,140,255,.035)}\n.writeup .finding-card .severity{color:#b59cff;font:700 9px \"JetBrains Mono\",monospace;padding:10px 13px;border-bottom:1px solid rgba(154,132,210,.12);letter-spacing:.08em}\n.writeup .finding-content{padding:14px}\n.writeup .callout{padding:14px 16px;border-left:3px solid #a98cff;background:linear-gradient(90deg,rgba(155,112,255,.10),rgba(155,112,255,.025))}\n.writeup .callout.warning{border-left-color:#d9a441}.writeup .callout.success{border-left-color:#58c98c}.writeup .callout strong{display:block;margin-bottom:5px}\n.writeup .table-card{overflow:auto;scrollbar-width:none}.writeup .table-card::-webkit-scrollbar{display:none}.writeup .table-card table{width:100%;border-collapse:collapse;font-size:11px}.writeup .table-card th,.writeup .table-card td{padding:9px 11px;border-bottom:1px solid rgba(154,132,210,.14);text-align:left}.writeup .table-card th{color:#d8c8f3}.writeup .table-card td{color:#a69bb5}\n.writeup .attack-card{padding:13px}.writeup .attack-step{display:flex;align-items:center;gap:10px;padding:8px;border-left:1px solid #5f477f;color:#aaa2bd}.writeup .attack-step span{width:23px;height:23px;border-radius:50%;display:grid;place-items:center;background:#171123;color:#c9a8ff;font:10px \"JetBrains Mono\",monospace;flex:none}\n.writeup .mitre-card{padding:14px}.writeup .mitre-tags{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.writeup .mitre-tags span{border:1px solid #563b7e;background:#171023;color:#bd9bff;padding:5px 7px;border-radius:6px;font:10px \"JetBrains Mono\",monospace}\n.writeup .cvss-card{padding:15px;display:flex;align-items:center;gap:18px}.writeup .cvss-score{font-size:34px;font-weight:800;color:#d8b8ff}.writeup .cvss-label{color:#a99eb9;font-size:11px}.writeup .cvss-badge{margin-left:auto;background:#a98cff;color:#140e04;padding:6px 9px;border-radius:6px;font:700 10px \"JetBrains Mono\",monospace}\n.writeup .evidence-card img{width:100%;display:block;max-height:420px;object-fit:contain}.writeup .evidence-card figcaption{padding:9px;color:#91879f;font-size:10px}\n.writeup .preview-intro{color:#aaa2bd;font-size:16px;margin:0 0 32px}\n@media(max-width:700px){.writeup h1{font-size:36px}.writeup h2{font-size:25px}.writeup .cvss-card{align-items:flex-start;flex-wrap:wrap}.writeup .cvss-badge{margin-left:0}}\n\n.writeup .block-heading{color:#8e82a0;font:700 9px \"JetBrains Mono\",monospace;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px}\n.writeup .vuln-summary{margin:18px 0;border:1px solid rgba(169,140,255,.24);border-radius:12px;background:linear-gradient(145deg,rgba(169,140,255,.06),rgba(10,9,16,.94));overflow:hidden}\n.writeup .vuln-top{display:flex;align-items:center;gap:9px;padding:10px 13px;border-bottom:1px solid rgba(154,132,210,.13);color:#81758f;font:600 9px \"JetBrains Mono\",monospace;letter-spacing:.1em}\n.writeup .vuln-severity{padding:4px 7px;border-radius:5px;background:#a98cff;color:#120d19;font-weight:800}\n.writeup .vuln-summary.severity-critical .vuln-severity,.writeup .vuln-summary.severity-high .vuln-severity{background:#e68b9a}.writeup .vuln-summary.severity-medium .vuln-severity{background:#d8ad68}.writeup .vuln-summary.severity-low .vuln-severity{background:#75c9a0}\n.writeup .vuln-summary h3{margin:14px 14px 7px;font-size:21px}.writeup .vuln-body{padding:0 14px 14px}\n.writeup .procedure-card,.writeup .flow-card,.writeup .command-output-card,.writeup .credentials-card,.writeup .ioc-card,.writeup .timeline-card,.writeup .tree-card,.writeup .compare-card{margin:18px 0;border:1px solid rgba(154,132,210,.18);background:#0a0910;border-radius:12px;overflow:hidden;padding:14px}\n.writeup .procedure-card .block-heading,.writeup .flow-card .block-heading,.writeup .command-output-card .block-heading,.writeup .credentials-card .block-heading,.writeup .ioc-card .block-heading,.writeup .timeline-card .block-heading,.writeup .tree-card .block-heading,.writeup .compare-card .block-heading{margin:0 0 12px}\n.writeup .procedure-step{display:flex;gap:11px;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(154,132,210,.08);color:#aaa2bd}.writeup .procedure-step:last-child{border-bottom:0}.writeup .procedure-step>span{width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:#171123;color:#c9a8ff;font:10px \"JetBrains Mono\",monospace;flex:none}\n.writeup .flow-track{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.writeup .flow-track>span:not(.flow-arrow){padding:9px 11px;border:1px solid rgba(169,140,255,.2);border-radius:8px;background:#100d18;color:#c8bce0;font-size:11px}.writeup .flow-arrow{color:#8f74bd;font-size:10px}\n.writeup .command-part,.writeup .output-part{position:relative;padding:10px;margin-top:8px;border:1px solid rgba(154,132,210,.12);border-radius:8px;background:#08070c}.writeup .command-part>span,.writeup .output-part>span{display:block;color:#82758f;font:700 8px \"JetBrains Mono\",monospace;letter-spacing:.12em;margin-bottom:7px}.writeup .command-part pre,.writeup .output-part pre{margin:0;padding:0 42px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:#cfc2e5;font:12px/1.7 \"JetBrains Mono\",monospace}.writeup .command-part .copy-btn,.writeup .output-part .copy-btn{position:absolute;right:8px;top:8px}\n.writeup .credentials-card>div:not(.block-heading),.writeup .ioc-card>div:not(.block-heading){display:grid;grid-template-columns:minmax(120px,.4fr) 1fr;gap:14px;padding:9px 0;border-bottom:1px solid rgba(154,132,210,.08);font-size:11px}.writeup .credentials-card>div:last-child,.writeup .ioc-card>div:last-child{border-bottom:0}.writeup .credentials-card span,.writeup .ioc-card span{color:#82758f;font:600 9px \"JetBrains Mono\",monospace;text-transform:uppercase}.writeup .credentials-card code{color:#d8c8f3}.writeup .ioc-card strong{font-weight:600;color:#bcb0cf;overflow-wrap:anywhere}\n.writeup .callout.tip{border-left-color:#9e7ee9}.writeup .callout.danger{border-left-color:#e46f83;background:linear-gradient(90deg,rgba(228,111,131,.1),rgba(228,111,131,.02))}.writeup .callout.warning{border-left-color:#d9a441;background:linear-gradient(90deg,rgba(217,164,65,.09),rgba(217,164,65,.02))}.writeup .callout.success{border-left-color:#58c98c;background:linear-gradient(90deg,rgba(88,201,140,.09),rgba(88,201,140,.02))}\n.writeup .flag-card{display:flex;align-items:center;gap:13px;margin:18px 0;padding:15px;border:1px solid rgba(88,201,140,.28);border-radius:12px;background:linear-gradient(90deg,rgba(88,201,140,.08),rgba(88,201,140,.02))}.writeup .flag-icon{width:38px;height:38px;border-radius:9px;display:grid;place-items:center;background:rgba(88,201,140,.12);color:#71d39d}.writeup .flag-card code{color:#c5f0d5;word-break:break-all}\n.writeup .timeline-row{display:grid;grid-template-columns:90px 1fr;gap:15px;padding:10px 0;border-bottom:1px solid rgba(154,132,210,.08);font-size:11px}.writeup .timeline-row:last-child{border-bottom:0}.writeup .timeline-row>span{color:#b59cff;font:700 10px \"JetBrains Mono\",monospace}.writeup .tree-card pre{margin:0;color:#cfc2e5;font:12px/1.8 \"JetBrains Mono\",monospace;white-space:pre;overflow:auto}\n.writeup .compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.writeup .compare-grid>div{padding:12px;border:1px solid rgba(154,132,210,.12);border-radius:8px;background:#0d0b13}.writeup .compare-grid span{color:#82758f;font:700 8px \"JetBrains Mono\",monospace;letter-spacing:.12em}.writeup .compare-grid p{margin:6px 0 0}\n.writeup .screenshot-card{margin:18px 0;border:1px solid rgba(154,132,210,.18);border-radius:12px;overflow:hidden;background:#0a0910}.writeup .screenshot-card img{display:block;width:100%;max-height:520px;object-fit:contain;background:#07060b}.writeup .screenshot-card figcaption{padding:10px 13px;color:#91879f;font-size:10px;border-bottom:1px solid rgba(154,132,210,.1)}.writeup .annotation-list{padding:10px 13px}.writeup .annotation-list>div{display:flex;gap:9px;align-items:flex-start;padding:7px 0;color:#aaa2bd;font-size:11px}.writeup .annotation-list span{width:20px;height:20px;display:grid;place-items:center;border-radius:50%;background:#171123;color:#c9a8ff;font:9px \"JetBrains Mono\",monospace;flex:none}\n@media(max-width:700px){.writeup .compare-grid{grid-template-columns:1fr}.writeup .timeline-row{grid-template-columns:70px 1fr}.writeup .flow-track{align-items:stretch;flex-direction:column}.writeup .flow-arrow{transform:rotate(90deg);align-self:center}}\n\n\n/* Global page scrollbar — intentionally separate from component/editor scrollbars. */\nhtml{\n  scrollbar-color:rgba(169,140,255,.82) transparent;\n  scrollbar-width:thin;\n}\nhtml::-webkit-scrollbar{width:9px;height:9px}\nhtml::-webkit-scrollbar-track{background:transparent}\nhtml::-webkit-scrollbar-thumb{\n  background:linear-gradient(180deg,#c2a9ff 0%,#8f68e8 100%);\n  border-radius:999px;\n  border:2px solid transparent;\n  background-clip:padding-box;\n}\nhtml::-webkit-scrollbar-thumb:hover{\n  background:linear-gradient(180deg,#d2c0ff 0%,#a37df5 100%);\n  background-clip:padding-box;\n}\n\n\n/* ==========================================================================\n   PROFESSIONAL SECURITY WRITE-UP BLOCKS\n   ========================================================================== */\n#readingProgress{\n  position:fixed;\n  z-index:9999;\n  top:0;\n  left:0;\n  width:100%;\n  height:3px;\n  transform-origin:left center;\n  transform:scaleX(0);\n  background:linear-gradient(90deg,#8f68e8,#c2a9ff);\n  box-shadow:0 0 14px rgba(169,140,255,.45);\n}\n#floatingToc{\n  position:fixed;\n  z-index:30;\n  right:22px;\n  top:50%;\n  transform:translateY(-50%);\n  width:210px;\n  max-height:60vh;\n  overflow:auto;\n  padding:13px;\n  border:1px solid rgba(169,140,255,.18);\n  border-radius:14px;\n  background:rgba(10,8,16,.86);\n  backdrop-filter:blur(12px);\n  box-shadow:0 18px 50px rgba(0,0,0,.30);\n}\n#floatingToc[hidden]{display:none}\n#floatingToc .toc-title{\n  color:#a98cff;\n  font:700 8px/1 \"JetBrains Mono\",monospace;\n  letter-spacing:.12em;\n  margin-bottom:10px;\n}\n#floatingToc nav{display:grid;gap:3px}\n#floatingToc a{\n  display:block;\n  padding:6px 7px;\n  border-radius:6px;\n  color:#8e859e;\n  text-decoration:none;\n  font-size:10px;\n  line-height:1.3;\n}\n#floatingToc a.h3{padding-left:17px;font-size:9px}\n#floatingToc a:hover{color:#d8ccff;background:rgba(169,140,255,.07)}\n@media(max-width:1200px){#floatingToc{display:none}}\n\n.evidence-gallery,.lifecycle-card,.impact-card,.exploitability-card,.remediation-card,\n.recon-dashboard,.portscan-card,.directories-card,.interactive-code-card,.split-http-card,\n.executive-summary,.finding-id-card,.mapping-card,.references-card,.spoiler-card,.anchor-block{\n  margin:20px 0;\n  border:1px solid rgba(154,132,210,.16);\n  border-radius:15px;\n  background:rgba(169,140,255,.025);\n}\n.block-heading{\n  padding:13px 15px;\n  color:#a98cff;\n  font:700 9px/1 \"JetBrains Mono\",monospace;\n  letter-spacing:.10em;\n  border-bottom:1px solid rgba(154,132,210,.11);\n}\n.gallery-grid{\n  display:grid;\n  grid-template-columns:repeat(3,minmax(0,1fr));\n  gap:10px;\n  padding:12px;\n}\n.gallery-grid figure{margin:0}\n.gallery-grid .gallery-placeholder{\n  min-height:130px;\n  display:grid;\n  place-items:center;\n  border-radius:10px;\n  overflow:hidden;\n  background:rgba(169,140,255,.035);\n  border:1px dashed rgba(169,140,255,.18);\n}\n.gallery-grid .gallery-placeholder.missing::before{\n  content:\"IMAGE / EVIDENCE\";\n  color:#6e657d;\n  font:700 8px \"JetBrains Mono\",monospace;\n  letter-spacing:.08em;\n}\n.gallery-grid img{display:block;width:100%;height:180px;object-fit:cover}\n.gallery-grid figcaption{padding:7px 2px;color:#81788e;font-size:9px}\n.lifecycle-step{\n  display:grid;grid-template-columns:42px 1fr;gap:10px;padding:14px 15px;border-bottom:1px solid rgba(154,132,210,.08);\n}\n.lifecycle-step:last-child{border-bottom:0}\n.lifecycle-step>span{\n  width:29px;height:29px;display:grid;place-items:center;border-radius:50%;\n  color:#bba8ff;background:rgba(169,140,255,.08);font:700 9px \"JetBrains Mono\",monospace;\n}\n.lifecycle-step strong{color:#e9e4f1;font-size:12px}\n.lifecycle-step p{margin:4px 0 0;color:#91879f;font-size:11px;line-height:1.55}\n.impact-card>div:not(.block-heading),.exploitability-card>div:not(.block-heading),\n.recon-dashboard .dashboard-grid,.finding-id-card>div:not(.block-heading),.mapping-card>div:not(.block-heading){\n  display:grid;grid-template-columns:180px 1fr;\n}\n.impact-card>div:not(.block-heading)>*,.exploitability-card>div:not(.block-heading)>*,\n.finding-id-card>div:not(.block-heading)>*,.mapping-card>div:not(.block-heading)>*{\n  margin:0;padding:11px 14px;border-bottom:1px solid rgba(154,132,210,.08);\n}\n.impact-card>div:not(.block-heading)>span,.exploitability-card>div:not(.block-heading)>span,\n.finding-id-card>div:not(.block-heading)>span,.mapping-card>div:not(.block-heading)>span{\n  color:#7d738b;font:600 9px \"JetBrains Mono\",monospace;text-transform:uppercase;\n}\n.impact-card>div:not(.block-heading)>strong,.exploitability-card>div:not(.block-heading)>strong,\n.finding-id-card>div:not(.block-heading)>strong,.mapping-card>div:not(.block-heading)>strong{color:#ded8e9;font-size:11px}\n.remediation-card>div:not(.block-heading),.executive-summary>div:not(.block-heading){padding:15px}\n.remediation-card p,.executive-summary p{color:#a59aae;line-height:1.7}\n.dashboard-grid{padding:10px 15px}\n.dashboard-grid>div{padding:11px 8px;border-bottom:1px solid rgba(154,132,210,.08)}\n.dashboard-grid span{display:block;color:#756c82;font:600 8px \"JetBrains Mono\",monospace;text-transform:uppercase}\n.dashboard-grid strong{display:block;margin-top:4px;color:#ded8e9;font-size:11px}\n.portscan-card table,.directories-card table{width:100%;border-collapse:collapse}\n.portscan-card th,.portscan-card td,.directories-card th,.directories-card td{padding:10px 12px;text-align:left;border-bottom:1px solid rgba(154,132,210,.08);font-size:10px}\n.portscan-card th,.directories-card th{color:#7e748b;font:700 8px \"JetBrains Mono\",monospace}\n.portscan-card td,.directories-card td{color:#c7bfd2}\n.interactive-head{\n  display:flex;justify-content:space-between;align-items:center;padding:9px 12px;\n  border-bottom:1px solid rgba(154,132,210,.11);color:#a98cff;font:700 8px \"JetBrains Mono\",monospace;\n}\n.interactive-head>div{display:flex;gap:7px}\n.interactive-toggle{\n  border:1px solid rgba(169,140,255,.25);border-radius:7px;padding:6px 9px;\n  background:rgba(169,140,255,.05);color:#bbaaff;font-size:9px;cursor:pointer;\n}\n.interactive-code,.interactive-output{margin:0;padding:16px;background:rgba(3,3,7,.40);overflow:auto;color:#c9c0d8;font:11px/1.7 \"JetBrains Mono\",monospace;white-space:pre-wrap}\n.interactive-output{border-top:1px dashed rgba(169,140,255,.14)}\n.split-http-grid{display:grid;grid-template-columns:1fr 1fr}\n.split-http-grid>div{position:relative;padding:14px;border-right:1px solid rgba(154,132,210,.10)}\n.split-http-grid>div:last-child{border-right:0}\n.split-label{color:#a98cff;font:700 8px \"JetBrains Mono\",monospace;margin-bottom:8px}\n.split-http-grid pre{margin:0;padding:12px;border-radius:9px;background:rgba(3,3,7,.38);color:#c9c0d8;white-space:pre-wrap;overflow:auto;font:10px/1.6 \"JetBrains Mono\",monospace}\n.references-card ol{margin:0;padding:14px 30px;color:#8f869c}\n.references-card li{padding:5px 0;font-size:10px}\n.references-card a{color:#bba8ff}\n.spoiler-card{overflow:hidden}\n.spoiler-card summary{cursor:pointer;padding:15px;color:#d9d2e6;font-size:11px;font-weight:700}\n.spoiler-card summary::marker{color:#a98cff}\n.spoiler-card>div{padding:0 15px 15px;color:#a59aae}\n.anchor-block{scroll-margin-top:80px;background:transparent;border-color:transparent}\n@media(max-width:700px){\n  .gallery-grid{grid-template-columns:1fr}\n  .impact-card>div:not(.block-heading),.exploitability-card>div:not(.block-heading),\n  .finding-id-card>div:not(.block-heading),.mapping-card>div:not(.block-heading){grid-template-columns:1fr}\n  .split-http-grid{grid-template-columns:1fr}\n  .split-http-grid>div{border-right:0;border-bottom:1px solid rgba(154,132,210,.10)}\n}\n\n.inline-toc ol{margin:0;padding:12px 30px 14px;color:#8f869c}\n.inline-toc li{padding:4px 0;font-size:10px}\n.inline-toc li.toc-level-3{padding-left:14px;font-size:9px}\n.inline-toc a{color:#aaa0b8;text-decoration:none}\n.inline-toc a:hover{color:#c7b8ff}\n\n.inserted-block-toolbar{display:none !important}\n";

async function publishToProjectFolder(entry){
  const ok=await ensureProjectRoot();
  if(!ok) return null;

  const root=projectRootHandle;
  const writeupsDir=await root.getDirectoryHandle("Write-ups",{create:true});

  // Keep one shared stylesheet and one shared image directory for every article.
  // Do not rewrite the large shared CSS file on every publish; this makes
  // repeated publishing noticeably faster while keeping the same global theme.
  const existingCss=await readTextFromHandle(writeupsDir,"writeup.css");
  if(existingCss !== SHARED_WRITEUP_CSS){
    await writeTextFile(writeupsDir,"writeup.css",SHARED_WRITEUP_CSS);
  }
  const imagesDir=await writeupsDir.getDirectoryHandle("images",{create:true});

  const folderName=folderSafeTitle(entry.title);
  const writeupDir=await writeupsDir.getDirectoryHandle(folderName,{create:true});

  // Generate the physical page from the exact same rendered preview used by
  // the editor. Physical images become ../images/<filename>.
  assetRenderMode="relative";
  renderMarkdown();
  const html=htmlDocument(true);
  assetRenderMode="data";
  renderMarkdown();

  await writeTextFile(writeupDir,"index.html",html);

  for(const asset of pendingAssets.values()){
    const handle=await imagesDir.getFileHandle(asset.name,{create:true});
    const writable=await handle.createWritable();
    await writable.write(asset.file);
    await writable.close();
  }

  const relativeUrl=`Write-ups/${encodeURIComponent(folderName)}/index.html`;

  // Update the static catalogue only after the article itself has been written.
  await updateStaticWriteupsFile(root,{
    title:entry.title,
    category:entry.category,
    date:entry.date,
    excerpt:entry.excerpt,
    tags:entry.tags,
    url:relativeUrl,
    slug:entry.slug,
    contentHtml:entry.contentHtml,
    markdown:entry.markdown
  });

  // Verify the actual filesystem output before reporting success.
  const savedArticle=await readTextFromHandle(writeupDir,"index.html");
  const savedCss=await readTextFromHandle(writeupsDir,"writeup.css");
  if(!savedArticle || !savedArticle.includes("<main class=\"writeup\">")){
    throw new Error("Published index.html could not be verified");
  }
  if(!savedCss || !savedCss.includes(".writeup")){
    throw new Error("Shared writeup.css could not be verified");
  }

  // Images are copied only after the page is generated. Verify each one exists.
  for(const asset of pendingAssets.values()){
    const imageHandle=await imagesDir.getFileHandle(asset.name);
    const imageFile=await imageHandle.getFile();
    if(!imageFile || imageFile.size===0) throw new Error(`Image ${asset.name} was not saved`);
  }

  try{
    const tmp=await root.getDirectoryHandle("tmp");
    await tmp.removeEntry(`writeup-${DRAFT_ID}`,{recursive:true});
  }catch{}

  tempAssetHandle=null;
  pendingAssets.clear();
  return relativeUrl;
}

async function publishLive(entry){
  const csrfResponse=await fetch('/api/auth/csrf',{credentials:'same-origin'});
  if(!csrfResponse.ok) throw new Error('Live publishing is unavailable');
  const csrfData=await csrfResponse.json();
  const response=await fetch('/api/writeups',{
    method:'POST',
    credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-CSRF-Token':csrfData.csrf},
    body:JSON.stringify(entry)
  });
  const data=await response.json().catch(()=>({}));
  if(response.status===401){ window.location.href='/admin/login'; throw new Error('Admin authentication required'); }
  if(!response.ok) throw new Error(data.error || 'Server rejected the write-up');
  return data;
}

async function publishWriteup(){
  const btn=$("#publishBtn");
  if(btn?.disabled) return;
  if(!validatePublish()) return;
  if(!source.value.trim()){ toggleCalendar(false); showEditorNotice(); return; }
  setPublishing(btn);
  const entry=getPublishEntry();
  try{
    const result=await publishLive(entry);
    entry.url=result.url;
    const published=getPublished();
    const index=published.findIndex(x=>x.slug===entry.slug);
    if(index>=0) published[index]=entry; else published.unshift(entry);
    localStorage.setItem(PUBLISHED_KEY,JSON.stringify(published));
    await clearDraft();
    window.location.href="/writeups.html?slug="+encodeURIComponent(entry.slug);
  }catch(err){
    console.error(err);
    resetPublishing(btn);
    flash(`Publish failed: ${err?.message || "could not publish the write-up"}`);
  }
}


function setPublishing(button){
  if(!button)return;
  button.disabled=true;
  button.classList.add("publishing");
  const icon=button.querySelector("i");
  const label=button.querySelector("span");
  if(icon) icon.className="fa-solid fa-spinner fa-spin";
  if(label) label.textContent="Publishing";
}

function resetPublishing(button){
  if(!button)return;
  button.disabled=false;
  button.classList.remove("publishing");
  const icon=button.querySelector("i");
  const label=button.querySelector("span");
  if(icon) icon.className="fa-solid fa-cloud-arrow-up";
  if(label) label.textContent="Publish Write-up";
}

function setPublished(button){
  if(!button)return;
  button.classList.add("copied");
  const icon=button.querySelector("i");
  const label=button.querySelector("span");
  if(icon) icon.className="fa-solid fa-check";
  if(label) label.textContent="Published";
  clearTimeout(button._publishTimer);
  button._publishTimer=setTimeout(()=>{
    button.classList.remove("copied");
    if(icon) icon.className="fa-solid fa-cloud-arrow-up";
    if(label) label.textContent="Publish Write-up";
  },1600);
}

function htmlDocument(relativeAssets=false){
  const title=fields.title.value.trim()||"Untitled Security Write-up";
  const category=fields.category.value.trim()||"SECURITY WRITE-UP";
  const date=fields.date.value||today();
  const excerpt=fields.excerpt.value.trim();
  const previousAssetMode=assetRenderMode;
  assetRenderMode=relativeAssets ? "relative" : previousAssetMode;
  renderMarkdown();
  // preview already contains the exact rendered Markdown body, including the
  // single metadata/title/intro header. Never add a second header here.
  const body=preview.innerHTML;
  assetRenderMode=previousAssetMode;
  renderMarkdown();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)} | Sardhon</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../writeup.css">
</head>
<body>
<div id="readingProgress" aria-hidden="true"></div>
<main class="writeup">
${body}
</main>
<aside id="floatingToc" aria-label="Table of contents"><div class="toc-title">ON THIS PAGE</div><nav></nav></aside>
<script>
document.querySelectorAll('.copy-btn').forEach(btn=>btn.addEventListener('click',async()=>{const text=decodeURIComponent(btn.dataset.copy||'');try{await navigator.clipboard.writeText(text)}catch{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove()}const i=btn.querySelector('i'),s=btn.querySelector('span');if(i)i.className='fa-solid fa-check';if(s)s.textContent='Copied';setTimeout(()=>{if(i)i.className='fa-regular fa-copy';if(s)s.textContent='Copy'},1200)}));
const article=document.querySelector('main.writeup');
const toc=document.querySelector('#floatingToc nav');
const used=new Set();
function slugifyHeading(text){return text.toLowerCase().trim().replace(/[^a-z0-9\\s-]/g,'').replace(/[\\s_-]+/g,'-').replace(/^-+|-+$/g,'')||'section'}
if(article&&toc){
  article.querySelectorAll('h2,h3').forEach((h,i)=>{
    let id=h.id||slugifyHeading(h.textContent||'section'),base=id,n=2;
    while(used.has(id)||document.getElementById(id)){id=base+'-'+n++}
    used.add(id);h.id=id;
    const a=document.createElement('a');a.href='#'+id;a.textContent=h.textContent||'Section';a.className=h.tagName.toLowerCase();
    toc.appendChild(a);
  });
  if(!toc.children.length) document.getElementById('floatingToc').hidden=true;
}
const progress=document.getElementById('readingProgress');
function updateProgress(){
  const max=document.documentElement.scrollHeight-window.innerHeight;
  progress.style.transform='scaleX('+(max>0?Math.min(1,window.scrollY/max):0)+')';
}
window.addEventListener('scroll',updateProgress,{passive:true});window.addEventListener('resize',updateProgress,{passive:true});updateProgress();
document.querySelectorAll('.interactive-toggle').forEach(btn=>btn.addEventListener('click',()=>{const out=btn.closest('.interactive-code-card')?.querySelector('.interactive-output');if(!out)return;out.hidden=!out.hidden;const s=btn.querySelector('span');if(s)s.textContent=out.hidden?'Show Output':'Hide Output'}));
</script>
</body>
</html>`;
}

async function clearDraft(){
  // Remove both current and legacy draft storage so stale data cannot return.
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
  pendingAssets.clear();
  if(projectRootHandle){
    try{
      const tmp=await projectRootHandle.getDirectoryHandle("tmp");
      await tmp.removeEntry(`writeup-${DRAFT_ID}`,{recursive:true});
    }catch{}
  }
  tempAssetHandle=null;

  // Reset metadata to the editor's clean/default state.
  fields.title.value="";
  fields.category.value="TRYHACKME";
  fields.date.value=today();
  syncDateDisplay();
  calendarCursor=new Date(fields.date.value+"T00:00:00");
  calendarCursor.setDate(1);
  fields.excerpt.value="";
  fields.tags.value="";

  // Clearing a draft also clears any publish-validation state.
  [fields.title,fields.category,fields.date,fields.excerpt,fields.tags].forEach(input=>{
    input.classList.remove("invalid");
    const label=input.closest("label");
    if(label) label.classList.remove("invalid");
  });
  dateControl?.classList.remove("invalid");
  hideEditorNotice();

  // A cleared draft means a completely empty editor — not the default template.
  source.value="";
  renderMarkdown();
  scheduleSave();
  localStorage.removeItem(STORAGE_KEY);
  flash("Draft cleared");
}

function download(name,text,type){
  const a=document.createElement("a");
  const url=URL.createObjectURL(new Blob([text],{type}));
  a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function setViewMode(mode,persist=true){
  const safe=["editor","preview","split"].includes(mode)?mode:"split";
  editorCard.classList.remove("view-editor","view-preview","view-split");
  editorCard.classList.add(`view-${safe}`);
  modeButtons.forEach(btn=>{
    const active=btn.dataset.mode===safe;
    btn.classList.toggle("active",active);
    btn.setAttribute("aria-selected",active?"true":"false");
  });
  if(persist)localStorage.setItem("sardhonEditorViewMode",safe);
}

modeButtons.forEach(btn=>btn.addEventListener("click",()=>setViewMode(btn.dataset.mode)));
setViewMode(localStorage.getItem("sardhonEditorViewMode")||"split",false);

$("#saveBtn").addEventListener("click",saveDraft);
$("#clearDraftBtn").addEventListener("click",clearDraft);

$("#copyEntryBtn").addEventListener("click",async e=>{
  await copyText(entryText(),e.currentTarget);
  flash("Portfolio entry copied");
});

$("#copyHtmlBtn").addEventListener("click",async e=>{
  renderMarkdown();
  await copyText(htmlDocument(),e.currentTarget);
  flash("Generated HTML copied");
});

$("#exportMdBtn").addEventListener("click",()=>{
  const slug=slugify(fields.title.value)||"writeup";
  download(`${slug}.md`,source.value,"text/markdown;charset=utf-8");
  flash(`Downloaded ${slug}.md`);
});

$("#connectFolderBtn")?.addEventListener("click",async()=>{
  const ok=await connectProjectFolder();
  if(ok) updateProjectConnectionUI(true);
});
$("#publishBtn").addEventListener("click",publishWriteup);

// Restore the remembered folder connection without prompting on page load.
// If permission is missing, the Publish/Connect action will request it from
// a user gesture.
(async()=>{
  if(!window.showDirectoryPicker){ updateProjectConnectionUI(false); return; }
  const stored=await loadStoredProjectHandle();
  if(stored && await validateProjectFolder(stored)){
    projectRootHandle=stored;
    updateProjectConnectionUI(true);
  }else{
    updateProjectConnectionUI(false);
  }
})();

function blockRegex(id,type){
  return new RegExp(`<!--\\s*BLOCK:${type}:${id}\\s*-->[\\s\\S]*?<!--\\s*\\/BLOCK:${type}:${id}\\s*-->`,"i");
}
function getMarkedBlockRange(id,type){
  const re=blockRegex(id,type);
  const m=re.exec(source.value);
  if(!m) return null;
  return {start:m.index,end:m.index+m[0].length,text:m[0],match:m[0]};
}
function getAllMarkedBlocks(){
  const re=/<!--\s*BLOCK:([a-z0-9_-]+):([a-f0-9-]+)\s*-->[\s\S]*?<!--\s*\/BLOCK:\1:\2\s*-->/gi;
  const result=[]; let m;
  while((m=re.exec(source.value))) result.push({type:m[1],id:m[2],start:m.index,end:m.index+m[0].length,text:m[0]});
  return result;
}
function focusBlockEditor(id,type){
  const r=getMarkedBlockRange(id,type); if(!r)return;
  const openEnd=source.value.indexOf("\n",r.start);
  const closeStart=source.value.lastIndexOf(`<!-- /BLOCK:${type}:${id} -->`,r.end);
  source.focus();
  source.setSelectionRange(openEnd<0?r.start:openEnd+1,closeStart<0?r.end:closeStart);
  source.scrollTop=Math.max(0,source.scrollHeight*(source.selectionStart/source.value.length)-source.clientHeight/2);
  flash("Block selected in editor");
}
function mutateMarkedBlock(id,type,action){
  const current=getMarkedBlockRange(id,type);
  if(!current)return;
  const value=source.value;
  if(action==="delete"){
    source.value=value.slice(0,current.start).replace(/\n{3,}$/,"\n\n")+value.slice(current.end).replace(/^\n{3,}/,"\n\n");
  }else if(action==="duplicate"){
    const copy=current.text.replace(/([0-9a-f-]{12,})/gi,()=>makeBlockId());
    source.value=value.slice(0,current.end)+"\n\n"+copy+value.slice(current.end);
  }else if(action==="edit"){
    focusBlockEditor(id,type); return;
  }else if(action==="up" || action==="down"){
    const all=getAllMarkedBlocks(), index=all.findIndex(x=>x.id===id&&x.type===type);
    const target=index+(action==="up"?-1:1);
    if(index<0||target<0||target>=all.length){flash("No adjacent inserted block");return;}
    const other=all[target];
    const betweenA=Math.min(current.end,other.end), betweenB=Math.max(current.start,other.start);
    const between=value.slice(betweenA,betweenB);
    if(between.trim()!==""){flash("Move works when inserted blocks are adjacent");return;}
    if(action==="up"){
      source.value=value.slice(0,other.start)+current.text+between+other.text+value.slice(current.end);
    }else{
      source.value=value.slice(0,current.start)+other.text+between+current.text+value.slice(other.end);
    }
  }
  source.selectionStart=source.selectionEnd=Math.min(source.value.length,current.start);
  autoGrowSource();
  renderMarkdown();
  scheduleSave();
  if(action==="delete")flash("Block deleted");
  if(action==="duplicate")flash("Block duplicated");
  if(action==="up"||action==="down")flash(action==="up"?"Moved block up":"Moved block down");
}
preview?.addEventListener("click",async e=>{
  const btn=e.target.closest(".copy-btn");
  if(btn){
    const text=decodeURIComponent(btn.dataset.copy||"");
    await copyText(text,btn);
    flash("Code copied");
    return;
  }
  const action=e.target.closest("[data-block-action]");
  if(action){
    const block=action.closest(".inserted-block");
    if(!block)return;
    mutateMarkedBlock(block.dataset.blockId,block.dataset.blockType,action.dataset.blockAction);
    return;
  }
  const toggle=e.target.closest(".interactive-toggle");
  if(toggle){
    const card=toggle.closest(".interactive-code-card");
    const output=card?.querySelector(".interactive-output");
    if(output){
      output.hidden=!output.hidden;
      const span=toggle.querySelector("span");
      if(span)span.textContent=output.hidden?"Show Output":"Hide Output";
    }
  }
});

function autoGrowSource(){
  if(!source)return;
  // Keep the editor as a fixed-height, independently scrollable field.
  // Expanding the textarea to its scrollHeight traps the page scroll.
  source.style.height="";
}
function preserveWorkspaceScrollState(){
  return {
    pageY:window.scrollY,
    previewY:preview?.scrollTop ?? 0,
    blockY:document.querySelector("#blockButtons")?.scrollTop ?? 0,
    templateY:document.querySelector(".template-area")?.scrollTop ?? 0
  };
}

function restoreWorkspaceScrollState(state, keepSourceCaret=true){
  if(!state) return;
  window.scrollTo(0,state.pageY);
  if(preview) preview.scrollTop=state.previewY;
  const blocks=document.querySelector("#blockButtons");
  if(blocks) blocks.scrollTop=state.blockY;
  const templates=document.querySelector(".template-area");
  if(templates) templates.scrollTop=state.templateY;
  if(keepSourceCaret){
    const atEnd=source.selectionStart >= source.value.length-1;
    if(atEnd) source.scrollTop=source.scrollHeight-source.clientHeight;
  }
}


/* Write-ups reader style wheel chaining: consume wheel inside the focused pane,
   but hand the remaining page movement back to the document at the pane edge.
   This prevents a nested scrollbar from trapping the mouse. */
function chainWheelToPage(el){
  if(!el) return;
  el.addEventListener("wheel", (event)=>{
    if(Math.abs(event.deltaY) < 0.01) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop >= max - 1;
    const wantsDown = event.deltaY > 0;
    const wantsUp = event.deltaY < 0;
    if((wantsDown && atBottom) || (wantsUp && atTop)){
      event.preventDefault();
      window.scrollBy({top:event.deltaY, left:0, behavior:"auto"});
    }
  }, {passive:false});
}
chainWheelToPage(source);
chainWheelToPage(preview);

source.addEventListener("input",()=>{
  // Keep the editor fixed-height. Do not restore window.scrollY on every
  // keystroke: that caused visible page jumps/jank while typing.
  const atEnd=source.selectionStart >= source.value.length-1;
  autoGrowSource();
  scheduleSave();
  if(atEnd){
    requestAnimationFrame(()=>{
      source.scrollTop=Math.max(0,source.scrollHeight-source.clientHeight);
    });
  }
});
source.addEventListener("focus",()=>{document.documentElement.classList.add("editor-source-focused");});
source.addEventListener("blur",()=>{document.documentElement.classList.remove("editor-source-focused");});
source.addEventListener("keydown",e=>{
  if(e.key==="Tab"){
    e.preventDefault();
    const start=source.selectionStart,end=source.selectionEnd;
    source.setRangeText("  ",start,end,"end");
    autoGrowSource();
    scheduleSave();
    requestAnimationFrame(()=>{
      source.scrollTop=Math.max(0,source.scrollHeight-source.clientHeight);
    });
  }
});

[fields.title,fields.category,fields.excerpt,fields.tags].forEach(el=>{
  el.addEventListener("input",()=>{
    if(el.matches("#title,#category,#excerpt,#tags") && String(el.value||"").trim()){
      el.classList.remove("invalid");
      const label=el.closest("label");
      if(label) label.classList.remove("invalid");
    }
    scheduleSave();
  });
});

screenshotInput?.addEventListener("change",e=>handleAssetSelection(e.target.files?.[0],"screenshot"));
evidenceInput?.addEventListener("change",e=>handleAssetSelection(e.target.files?.[0],"evidence"));
window.addEventListener("resize",positionCalendar,{passive:true});
window.addEventListener("scroll",positionCalendar,{passive:true,capture:true});

datePickerBtn?.addEventListener("click",()=>toggleCalendar());
$("#calendarPrev")?.addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar();});
$("#calendarNext")?.addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar();});
calendarDays?.addEventListener("click",e=>{
  const btn=e.target.closest(".calendar-day");
  if(!btn) return;
  setDateValue(btn.dataset.date);
  calendarCursor=new Date(btn.dataset.date+"T00:00:00");
  calendarCursor.setDate(1);
  toggleCalendar(false);
});
$("#calendarToday")?.addEventListener("click",()=>{setDateValue(today());calendarCursor=new Date(today()+"T00:00:00");calendarCursor.setDate(1);toggleCalendar(false);});
$("#calendarClear")?.addEventListener("click",()=>{setDateValue("");toggleCalendar(false);});
if(datePopover && datePopover.parentElement !== document.body) document.body.appendChild(datePopover);

noticeOk?.addEventListener("click",hideEditorNotice);
notice?.addEventListener("click",e=>{if(e.target===notice)hideEditorNotice();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(notice&&!notice.hidden)hideEditorNotice();else if(datePopover&&!datePopover.hidden)toggleCalendar(false);}});
document.addEventListener("click",e=>{if(datePopover&&!datePopover.hidden&&!e.target.closest(".date-field")&&!e.target.closest("#datePopover"))toggleCalendar(false);});

$$(".toolbar button").forEach(btn=>btn.addEventListener("click",()=>toolbarAction(btn.dataset.action)));

$("#editorFullscreenBtn")?.addEventListener("click",()=>{
  const card=editorCard;
  card?.classList.toggle("editor-fullscreen");
  const btn=$("#editorFullscreenBtn");
  const active=card?.classList.contains("editor-fullscreen");
  if(btn)btn.innerHTML=active?'<i class="fa-solid fa-compress"></i>':'<i class="fa-solid fa-expand"></i>';
  if(active) window.scrollTo({top:Math.max(0,(card.getBoundingClientRect().top+window.scrollY)-20),behavior:"smooth"});
});
$("#editorFindBtn")?.addEventListener("click",()=>{
  const term=prompt("Find in Markdown:");
  if(!term)return;
  const start=source.selectionEnd||0;
  const hay=source.value.toLowerCase(), needle=term.toLowerCase();
  let at=hay.indexOf(needle,start);
  if(at<0)at=hay.indexOf(needle,0);
  if(at<0){flash("Text not found");return;}
  source.focus();source.setSelectionRange(at,at+term.length);
  source.scrollTop=Math.max(0,source.scrollHeight*(at/Math.max(1,source.value.length))-source.clientHeight/2);
});

blocks.forEach(([icon,label,type],index)=>{
  const b=document.createElement("button");
  b.className="block-button";
  b.type="button";
  b.dataset.type=type;
  b.innerHTML=`<span class="block-number" aria-hidden="true">${String(index+1).padStart(2,"0")}</span><i class="${icon}"></i><span class="block-label">${label}</span>`;
  b.addEventListener("click",()=>insertSecurityBlock(type));
  $("#blockButtons").appendChild(b);
});


function startNewWriteup(template="blank"){
  fields.title.value="";
  fields.category.value="TRYHACKME";
  fields.date.value=today();
  fields.excerpt.value="";
  fields.tags.value="";
  syncDateDisplay();
  calendarCursor=new Date(today()+"T00:00:00");
  calendarCursor.setDate(1);
  source.value=defaultTemplates[template]||"";
  [fields.title,fields.category,fields.excerpt,fields.tags].forEach(x=>x.classList.remove("invalid"));
  dateControl?.classList.remove("invalid");
  autoGrowSource();
  renderMarkdown();
  scheduleSave();
  flash(template==="blank"?"New blank write-up ready":"New write-up created from template");
}
function openTemplateModal(){
  const modal=$("#templateModal");
  if(!modal)return;
  modal.hidden=false;
  document.body.classList.add("template-modal-open");
}
function closeTemplateModal(){
  const modal=$("#templateModal");
  if(!modal)return;
  modal.hidden=true;
  document.body.classList.remove("template-modal-open");
}
$("#newWriteupBtn")?.addEventListener("click",openTemplateModal);
$("#templateModalClose")?.addEventListener("click",closeTemplateModal);
$("#templateModal")?.addEventListener("click",e=>{
  if(e.target.id==="templateModal") closeTemplateModal();
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && $("#templateModal") && !$("#templateModal").hidden) closeTemplateModal();
});
$$("[data-template],[data-new-template]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    startNewWriteup(btn.dataset.template||btn.dataset.newTemplate||"blank");
    if(btn.dataset.newTemplate) closeTemplateModal();
  });
});


// Saved reusable blocks were removed from the editor UI. Clear the old local
// storage once so the retired feature cannot consume editor space or data.
localStorage.removeItem(SAVED_BLOCKS_KEY);

const legacy=localStorage.getItem(LEGACY_KEY);
const saved=localStorage.getItem(STORAGE_KEY);
if(saved){
  try{applyState(JSON.parse(saved));}
  catch{applyState({});}
}else if(legacy){
  try{
    const x=JSON.parse(legacy);
    applyState({source:x.source,title:x.title,category:x.tag,date:x.date});
  }catch{applyState({});}
}else{
  applyState({
    title:"",
    category:"TRYHACKME",
    date:today(),
    excerpt:"",
    tags:"",
    source:defaultTemplates.pentest
  });
}
syncDateDisplay();
autoGrowSource();
$("#year").textContent=new Date().getFullYear();

/* ============================================================================
   IMMERSIVE EDITOR SCROLL CHROME
   Metadata and the global navbar do not disappear on the first scroll.
   They wait until the editor workspace reaches the browser's top edge, then
   require a few deliberate downward wheel steps before tucking away.  A
   reverse scroll brings both back immediately, creating the requested
   magnetic/sticky feel without stealing the page scroll.
   ============================================================================ */
(function installEditorChromeBehavior(){
  const panel=document.querySelector('.meta-panel');
  const workspace=document.querySelector('.workspace');
  const navbar=document.querySelector('.navbar');
  if(!workspace) return;

  let downwardTicks=0;
  let lastY=window.scrollY||0;
  let ticking=false;
  const EDGE=104;
  const RELEASE=145;
  const REQUIRED_TICKS=3;

  const setHidden=(hidden)=>{
    if(panel) panel.classList.toggle('metadata-hidden',hidden);
    if(navbar) navbar.classList.toggle('editor-nav-hidden',hidden);
  };

  const updatePosition=()=>{
    const rect=workspace.getBoundingClientRect();
    const y=window.scrollY||0;
    const nearEditorTop=rect.top<=EDGE;

    if(!nearEditorTop){
      downwardTicks=0;
      setHidden(false);
    }else if(y<lastY-2){
      // Scrolling upward from the editor reveals the chrome immediately.
      downwardTicks=0;
      setHidden(false);
    }

    lastY=y;
    ticking=false;
  };

  window.addEventListener('wheel',(event)=>{
    if(Math.abs(event.deltaY)<0.01) return;

    const rect=workspace.getBoundingClientRect();
    const nearEditorTop=rect.top<=EDGE;

    if(event.deltaY<0){
      downwardTicks=0;
      setHidden(false);
      return;
    }

    if(nearEditorTop){
      downwardTicks++;
      if(downwardTicks>=REQUIRED_TICKS) setHidden(true);
    }else{
      downwardTicks=0;
    }
  },{passive:true,capture:true});

  window.addEventListener('scroll',()=>{
    if(!ticking){
      ticking=true;
      requestAnimationFrame(updatePosition);
    }
  },{passive:true});

  window.addEventListener('resize',()=>{
    downwardTicks=0;
    setHidden(false);
  },{passive:true});

  // Initial state is always visible.
  setHidden(false);
  updatePosition();
})();

/* ============================================================================
   FINAL WHEEL HANDOFF
   Nested editor regions should scroll themselves first. When the pointer is
   already at the top/bottom edge, pass the wheel movement to the document so
   the user can continue through the rest of the editor page/footer without
   having to move the mouse outside the focused region.
   ============================================================================ */
(function installWheelHandoff(){
  const regions = [
    document.querySelector('#source'),
    document.querySelector('#preview'),
    document.querySelector('#blockButtons'),
    document.querySelector('#savedBlocks'),
    document.querySelector('.template-area')
  ].filter(Boolean);

  regions.forEach((el)=>{
    el.addEventListener('wheel',(event)=>{
      if(Math.abs(event.deltaY) < 0.01) return;

      const maxScroll = el.scrollHeight - el.clientHeight;
      const hasVerticalScroll = maxScroll > 1;

      if(!hasVerticalScroll){
        event.preventDefault();
        window.scrollBy(0,event.deltaY);
        return;
      }

      const atTop = el.scrollTop <= 1;
      const atBottom = el.scrollTop >= maxScroll - 1;
      const movingPastTop = event.deltaY < 0 && atTop;
      const movingPastBottom = event.deltaY > 0 && atBottom;

      if(movingPastTop || movingPastBottom){
        event.preventDefault();
        window.scrollBy(0,event.deltaY);
      }
    },{passive:false});
  });
})();
