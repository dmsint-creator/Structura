"use client";
import { useEffect, useState } from "react";
import { Building2, Eye, LayoutTemplate, Network, Printer, Store, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

type Entity = { id: string; name: string; incorporated: string; opened: string; parentId: string; remark?: string };
type Holder = { id: string; name: string };
type Ownership = { holderId: string; entityId: string; percentage: number };
type Branch = { id: string; entityId: string; name: string; type: string; commenceDate: string; status: string; address: string; state?: string; country?: string };
type OrgNode = { id: string; parentId: string; type: string; unit: string; name: string; title: string; status: string };
type ReportKind = "entity-name" | "entity-dates" | "entity-ownership" | "entity-outlets" | "org-role" | "org-name";
type Template = "classic" | "executive" | "compact";
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]!);

export function ReportCentre({ entities, holders, ownerships, branches }: { entities: Entity[]; holders: Holder[]; ownerships: Ownership[]; branches: Branch[] }) {
  const [nodes, setNodes] = useState<OrgNode[]>([]), [template, setTemplate] = useState<Template>("executive");
  useEffect(() => { fetch("/api/state?scope=org-chart").then((r) => r.json()).then((d) => setNodes(d.data?.nodes || [])).catch(() => {}); }, []);
  const flatten = <T extends { id: string; parentId: string }>(items: T[]) => {
    const out: { item: T; depth: number }[] = [], seen = new Set<string>();
    const walk = (parent: string, depth: number) => items.filter((x) => (x.parentId || "") === parent).forEach((x) => { if (seen.has(x.id)) return; seen.add(x.id); out.push({ item: x, depth }); walk(x.id, depth + 1); });
    walk("", 0); items.filter((x) => !seen.has(x.id)).forEach((x) => out.push({ item: x, depth: 0 })); return out;
  };
  const openReport = (kind: ReportKind, autoPrint = false) => {
    const corporate = kind.startsWith("entity"), title =
      kind === "entity-name" ? "Corporate Group Structure — Entity Names" :
      kind === "entity-dates" ? "Corporate Group Structure — Entity Details" :
      kind === "entity-ownership" ? "Corporate Group Structure — Entity & Ownership" :
      kind === "entity-outlets" ? "Entity, Outlet & Branch Register" :
      kind === "org-role" ? "Organisation Chart — Roles & Departments" : "Organisation Chart — Roles, Departments & Names";
    let rows = "";
    if (corporate) rows = flatten(entities).map(({ item: e, depth }) => {
      const owners = ownerships.filter((o) => o.entityId === e.id).map((o) => `${esc(holders.find((h) => h.id === o.holderId)?.name || "Unknown")}: ${Number(o.percentage).toFixed(2).replace(/\.00$/, "")}%`).join(" · ") || "Ownership pending";
      const details = kind !== "entity-name" ? `<div class="meta"><span><b>Incorporated</b> ${esc(e.incorporated || "—")}</span><span><b>Started business</b> ${esc(e.opened || "—")}</span></div><p><b>Remark:</b> ${esc(e.remark || "—")}</p>` : "";
      const owner = kind === "entity-ownership" ? `<p class="owners"><b>Ownership:</b> ${owners}</p>` : "";
      const locations = kind === "entity-outlets" ? branches.filter((b) => b.entityId === e.id).map((b) => `<li><strong>${esc(b.name)}</strong><span>${esc(b.type)} · ${esc(b.status)} · Commenced ${esc(b.commenceDate || "—")}</span><small>${esc([b.address, b.state, b.country].filter(Boolean).join(", ") || "Location not stated")}</small></li>`).join("") : "";
      return `<article class="node" style="margin-left:${depth * 28}px"><h3>${esc(e.name)}</h3>${details}${owner}${kind === "entity-outlets" ? `<ul class="locations">${locations || "<li><span>No outlet or branch recorded</span></li>"}</ul>` : ""}</article>`;
    }).join("");
    else rows = flatten(nodes).map(({ item: n, depth }) => `<article class="org" style="margin-left:${depth * 28}px"><div><small>${esc(n.type)}</small><h3>${esc(n.title || n.type || "Role not stated")}</h3><p>${esc(n.unit || "Department not stated")}</p></div>${kind === "org-name" ? `<strong class="${n.name ? "" : "vacant"}">${esc(n.name || "Vacant")}</strong>` : ""}</article>`).join("");
    const styles = `@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#173047;font:13px Arial,sans-serif;background:#fff}header{padding:20px 22px;margin-bottom:20px;border-radius:8px}header b{font:700 28px Georgia,serif}header span{float:right}h1{font:700 21px Georgia,serif;margin:18px 0 5px}header p{margin:0}.toolbar{position:sticky;top:0;z-index:2;display:flex;justify-content:flex-end;gap:8px;padding:10px;background:#eef3f7}.toolbar button{padding:8px 13px;border:0;border-radius:5px;background:#2468ab;color:#fff;cursor:pointer}.node,.org{position:relative;margin-bottom:11px;padding:14px 16px;border-radius:7px;break-inside:avoid}.node h3,.org h3{margin:0 0 7px;font-size:14px}.node p,.org p{margin:6px 0 0;color:#536b7f;font-size:11px}.meta{display:flex;gap:26px;color:#536b7f;font-size:11px}.owners{padding-top:7px;border-top:1px solid #e4eaf0}.org{display:flex;align-items:center;justify-content:space-between}.org small{color:#71889b;text-transform:uppercase;font-size:9px}.org strong{padding:7px 10px;border-radius:4px;background:#e8f4ed;color:#267252}.org strong.vacant{background:#fff0dc;color:#9b641d}.locations{display:grid;gap:6px;margin:11px 0 0;padding:9px 0 0;border-top:1px solid #dce5ed;list-style:none}.locations li{display:grid;grid-template-columns:1.1fr 1fr;gap:3px 12px;padding:8px 10px;border-radius:5px;background:#f4f7fa}.locations li small{grid-column:1/-1;color:#718496}.classic header{border-bottom:3px solid #2468ab;background:#fff}.classic .node,.classic .org{border:1px solid #bdccda;border-left:5px solid #2b73b3}.executive header{background:#173650;color:#fff}.executive header p,.executive header span{color:#b9ccda}.executive .node,.executive .org{border:1px solid #dce5ed;border-top:4px solid #2b73b3;box-shadow:0 5px 16px #17365014}.compact header{padding:12px 0;border-bottom:2px solid #173650;border-radius:0}.compact .node,.compact .org{margin-bottom:5px;padding:9px 11px;border:0;border-bottom:1px solid #dce4ea;border-radius:0}.compact .node h3,.compact .org h3{margin-bottom:4px}.compact .locations{grid-template-columns:1fr 1fr}.compact .locations li{display:block}.compact .locations li span,.compact .locations li small{display:block;margin-top:3px}footer{margin-top:22px;padding-top:10px;border-top:1px solid #ccd7e0;color:#7c8d9b;font-size:10px}@media print{.toolbar{display:none}body{background:#fff}}`;
    const w = window.open("", "_blank"); if (!w) { alert("Please allow pop-ups to view the report."); return; }
    w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>${styles}</style></head><body class="${template}"><div class="toolbar"><button onclick="window.print()">Print / Save PDF</button><button onclick="window.close()">Close</button></div><header><b>Structura</b><span>Generated ${esc(new Date().toLocaleDateString("en-MY"))}</span><h1>${esc(title)}</h1><p>${corporate ? "Legal entity and operating location report" : "People and operating organisation report"}</p></header><main>${rows || "<p>No records available.</p>"}</main><footer>Structura Corporate Registry · Confidential</footer>${autoPrint ? "<script>window.onload=()=>window.print()<\/script>" : ""}</body></html>`); w.document.close();
  };
  const cards: [ReportKind, string, string, typeof Building2, string][] = [
    ["entity-name", "Entity names only", "A clean corporate structure showing legal entity names only.", Building2, "CORPORATE GROUP STRUCTURE"],
    ["entity-dates", "Entity details & remarks", "Entity name, incorporation date, business start date and remark.", Network, "CORPORATE GROUP STRUCTURE"],
    ["entity-ownership", "Full ownership structure", "Entity details, remarks, shareholder names and ownership percentages.", Network, "CORPORATE GROUP STRUCTURE"],
    ["entity-outlets", "Entities with outlets & branches", "Every outlet or branch under its legal entity, including commencement date and location.", Store, "OUTLET & BRANCH REPORT"],
    ["org-role", "Roles & departments", "Organisation structure showing role and department only.", Users, "ORGANISATION CHART"],
    ["org-name", "Roles, departments & names", "Full organisation chart with employee name or Vacant.", Users, "ORGANISATION CHART"],
  ];
  return <section className="report-centre">
    <div className="report-intro"><div><h2>Reports & charts</h2><p>Preview reports before printing, and choose a design template to match the audience.</p></div><Printer /></div>
    <div className="report-template-picker"><LayoutTemplate /><div><strong>Report design</strong><small>The selected template applies to View and Print / Save PDF.</small></div>{(["classic","executive","compact"] as Template[]).map((value) => <button key={value} className={template === value ? "active" : ""} onClick={() => setTemplate(value)}>{value}</button>)}</div>
    <div className="report-grid">{cards.map(([kind, title, desc, Icon, group]) => <article key={kind}><i><Icon /></i><small>{group}</small><h3>{title}</h3><p>{desc}</p><div className="report-actions"><Button variant="outline" onClick={() => openReport(kind)}><Eye />View</Button><Button onClick={() => openReport(kind, true)}><Printer />Print / PDF</Button></div></article>)}</div>
  </section>;
}
