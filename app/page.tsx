"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  Archive,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  GitFork,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OrgChart } from "./org-chart";
import { ReportCentre } from "./report-centre";

type Entity = {
  id: string;
  name: string;
  reg: string;
  incorporated: string;
  opened: string;
  type: string;
  status: string;
  activity: string;
  parentId: string;
  capital: number;
  shares: number;
  shareClass: string;
  remark: string;
};
type Holder = { id: string; name: string; kind: "Company" | "Individual" };
type Ownership = {
  id: string;
  holderId: string;
  entityId: string;
  percentage: number;
  shareClass: string;
  shares: number;
};
type Officer = {
  id: string;
  entityId: string;
  name: string;
  role: string;
  appointed: string;
};
type Branch = {
  id: string;
  entityId: string;
  name: string;
  type: string;
  commenceDate: string;
  status: string;
  address: string;
  state: string;
  country: string;
};
type DocumentRow = {
  id: string;
  entityId: string;
  name: string;
  type: string;
  expiry: string;
  size: string;
  fileId?: string;
};
type Audit = { id: string; at: string; action: string; detail: string };
type UserRole = "Master Admin" | "Admin Assistant" | "Viewer";
type AppUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: "Active" | "Inactive";
};
type Section =
  | "dashboard"
  | "structure"
  | "orgchart"
  | "entities"
  | "shareholders"
  | "governance"
  | "documents"
  | "audit"
  | "users"
  | "reports"
  | "settings";
const emptyEntity = {
  name: "",
  reg: "",
  incorporated: "",
  opened: "",
  type: "Subsidiary",
  status: "Active",
  activity: "",
  parentId: "",
  capital: 0,
  shares: 0,
  shareClass: "Ordinary",
  remark: "",
};
const now = () =>
  new Date().toLocaleString("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  });

function findBrowserRegistries() {
  const candidates: any[] = [];
  const addCandidate = (value: any) => {
    if (!value || typeof value !== "object") return;
    const possible = [
      value,
      value.data,
      value.registry,
      value.state,
      value.payload,
      value.data?.registry,
      value.state?.registry,
    ];
    for (const item of possible)
      if (item && Array.isArray(item.entities) && item.entities.length > 0)
        candidates.push(item);
  };
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        addCandidate(JSON.parse(raw));
      } catch {}
    }
  } catch {}
  return candidates;
}

function mergeRegistrySources(sources: any[]) {
  const mergeRows = (key: string) => {
    const rows = new Map<string, any>();
    for (const source of sources) {
      for (const item of Array.isArray(source?.[key]) ? source[key] : []) {
        if (!item || typeof item !== "object") continue;
        const identity =
          typeof item.id === "string" && item.id
            ? item.id
            : `${key}:${JSON.stringify(item)}`;
        const previous = rows.get(identity) || {};
        const combined = { ...previous };
        for (const [field, value] of Object.entries(item))
          if (
            value !== undefined &&
            value !== null &&
            value !== "" &&
            (!Array.isArray(value) || value.length > 0)
          )
            combined[field] = value;
        combined.id ||= crypto.randomUUID();
        rows.set(identity, combined);
      }
    }
    return [...rows.values()];
  };
  return {
    entities: mergeRows("entities").map((e) => ({ ...emptyEntity, ...e })),
    holders: mergeRows("holders").map((h) => ({
      kind: "Company",
      name: "Unnamed shareholder",
      ...h,
    })),
    ownerships: mergeRows("ownerships").map((o) => ({
      holderId: "",
      entityId: "",
      percentage: 0,
      shareClass: "Ordinary",
      shares: 0,
      ...o,
    })),
    officers: mergeRows("officers").map((o) => ({
      entityId: "",
      name: "Unnamed officer",
      role: "Director",
      appointed: "",
      ...o,
    })),
    branches: mergeRows("branches").map((b) => ({
      entityId: "",
      name: "Unnamed branch",
      type: "Branch",
      commenceDate: "",
      status: "Active",
      address: "",
      state: "",
      country: "",
      ...b,
    })),
    documents: mergeRows("documents").map((d) => ({
      entityId: "",
      name: "Unnamed document",
      type: "Other",
      expiry: "",
      size: "",
      ...d,
    })),
    audit: mergeRows("audit").map((a) => ({
      at: "",
      action: "Recovered record",
      detail: "",
      ...a,
    })),
  };
}

export default function Home() {
  type SessionUser = {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    mustChange: boolean;
  };
  const [section, setSection] = useState<Section>("dashboard"),
    [entities, setEntities] = useState<Entity[]>([]),
    [holders, setHolders] = useState<Holder[]>([]),
    [ownerships, setOwnerships] = useState<Ownership[]>([]),
    [officers, setOfficers] = useState<Officer[]>([]),
    [branches, setBranches] = useState<Branch[]>([]),
    [documents, setDocuments] = useState<DocumentRow[]>([]),
    [audit, setAudit] = useState<Audit[]>([]),
    [users, setUsers] = useState<AppUser[]>([]),
    [session, setSession] = useState<SessionUser | null>(null),
    [authReady, setAuthReady] = useState(false),
    [loginForm, setLoginForm] = useState({ email: "", password: "" }),
    [loginError, setLoginError] = useState(""),
    [loginBusy, setLoginBusy] = useState(false),
    [newPassword, setNewPassword] = useState(""),
    [backupVersions, setBackupVersions] = useState<any[]>([]),
    [backupsBusy, setBackupsBusy] = useState(false);
  const [ready, setReady] = useState(false),
    [registryLoaded, setRegistryLoaded] = useState(false),
    [search, setSearch] = useState(""),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [openNavGroup, setOpenNavGroup] = useState("OVERVIEW"),
    [modal, setModal] = useState<
      "entity" | "ownership" | "branch" | "officer" | "document" | "user" | null
    >(null),
    [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState(emptyEntity),
    [of, setOf] = useState({
      holder: "",
      kind: "Company" as Holder["kind"],
      entityId: "",
      percentage: 100,
      shareClass: "Ordinary",
      shares: 0,
    }),
    [bf, setBf] = useState({
      entityId: "",
      name: "",
      type: "Branch",
      commenceDate: "",
      status: "Active",
      address: "",
      state: "",
      country: "",
    }),
    [gf, setGf] = useState({
      entityId: "",
      name: "",
      role: "Director",
      appointed: "",
    }),
    [df, setDf] = useState({
      entityId: "",
      name: "",
      type: "SSM / Statutory",
      expiry: "",
      size: "",
      file: null as File | null,
    }),
    [uf, setUf] = useState({
      name: "",
      email: "",
      role: "Viewer" as UserRole,
      status: "Active" as AppUser["status"],
    });
  const importRef = useRef<HTMLInputElement>(null),
    docRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fetch("/api/auth?action=me")
      .then((r) => r.json())
      .then((d) => setSession(d.user || null))
      .finally(() => setAuthReady(true));
  }, []);
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const response = await fetch("/api/state?scope=registry"),
          cloud = await response.json();
        let d = cloud.data;
        try {
          const browserRegistries = findBrowserRegistries();
          const sources = [...browserRegistries, ...(d ? [d] : [])];
          if (sources.some((source) => source?.entities?.length)) {
            const merged = mergeRegistrySources(sources);
            const cloudCount = [
              "entities",
              "holders",
              "ownerships",
              "officers",
              "branches",
              "documents",
              "audit",
            ].reduce((sum, key) => sum + (cloud.data?.[key]?.length || 0), 0);
            const mergedCount = Object.values(merged).reduce(
              (sum, rows) => sum + rows.length,
              0,
            );
            d = { ...merged, users: cloud.data?.users || [] };
            if (mergedCount > cloudCount) {
              const migrated = await fetch("/api/state?scope=registry", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(d),
              });
              if (!migrated.ok)
                throw new Error("Registry recovery merge was rejected.");
            }
          }
        } catch {}
        if (d) {
          setEntities(d.entities || []);
          setHolders(d.holders || []);
          setOwnerships(d.ownerships || []);
          setOfficers(d.officers || []);
          setBranches(
            (d.branches || []).map((branch: Partial<Branch>) => ({
              ...branch,
              state: branch.state || "",
              country: branch.country || "",
            })) as Branch[],
          );
          setDocuments(d.documents || []);
          setAudit(d.audit || []);
          const loaded: AppUser[] = Array.isArray(d.users)
            ? d.users.filter(
                (u: Partial<AppUser>) =>
                  typeof u?.email === "string" && u.email.length > 0,
              )
            : [];
          const mine = loaded.findIndex(
            (u) => u.email.toLowerCase() === session.email.toLowerCase(),
          );
          if (mine >= 0)
            loaded[mine] = {
              ...loaded[mine],
              id: session.id,
              role: session.role,
            };
          else
            loaded.push({
              id: session.id,
              name: session.name,
              email: session.email,
              role: session.role,
              status: "Active",
            });
          setUsers(loaded);
        } else {
          setUsers([
            {
              id: session.id,
              name: session.name,
              email: session.email,
              role: session.role,
              status: "Active",
            },
          ]);
        }
      } catch {}
      setReady(true);
      setRegistryLoaded(true);
    })();
  }, [session]);
  useEffect(() => {
    if (!ready || !registryLoaded || !session || session.role === "Viewer")
      return;
    const data = {
      entities,
      holders,
      ownerships,
      officers,
      branches,
      documents,
      audit,
      users,
    };
    if (entities.length > 0)
      try {
        localStorage.setItem(
          "structura-emergency-backup-v2",
          JSON.stringify({ ...data, savedAt: new Date().toISOString() }),
        );
      } catch {}
    const timer = setTimeout(
      () =>
        fetch("/api/state?scope=registry", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        }).catch(() => {}),
      700,
    );
    return () => clearTimeout(timer);
  }, [
    ready,
    registryLoaded,
    session,
    entities,
    holders,
    ownerships,
    officers,
    branches,
    documents,
    audit,
    users,
  ]);
  const currentUser = session;
  const isMaster = session?.role === "Master Admin",
    canEdit = isMaster || session?.role === "Admin Assistant",
    canCreate = isMaster,
    canDelete = isMaster;
  const log = (action: string, detail: string) =>
    setAudit((v) => [
      { id: crypto.randomUUID(), at: now(), action, detail },
      ...v,
    ]);
  const holderName = (id: string) =>
    holders.find((h) => h.id === id)?.name || "Unknown";
  const total = (entityId: string) =>
    ownerships
      .filter((o) => o.entityId === entityId)
      .reduce((s, o) => s + o.percentage, 0);
  const balanced = entities.filter(
    (e) => Math.abs(total(e.id) - 100) < 0.001,
  ).length;
  const expiring = documents.filter(
    (d) =>
      d.expiry &&
      new Date(d.expiry).getTime() - Date.now() < 1000 * 60 * 60 * 24 * 90,
  ).length;
  const filtered = entities.filter((e) =>
    (e.name + e.reg + e.activity).toLowerCase().includes(search.toLowerCase()),
  );
  const effective = useMemo(
    () =>
      ownerships.map((o) => {
        const holder = holders.find((h) => h.id === o.holderId);
        let value = o.percentage;
        if (holder?.kind === "Company") {
          const ownerEntity = entities.find(
            (e) => e.name.toLowerCase() === holder.name.toLowerCase(),
          );
          if (ownerEntity) {
            const upstream = ownerships.filter(
              (x) => x.entityId === ownerEntity.id,
            );
            if (upstream.length === 1)
              value = (value * upstream[0].percentage) / 100;
          }
        }
        return { ...o, effective: value };
      }),
    [ownerships, holders, entities],
  );
  const openNew = (kind: typeof modal) => {
    if (kind === "user" && !isMaster) return;
    if (kind !== "user" && !canCreate) return;
    setEditId(null);
    if (kind === "entity") setEf(emptyEntity);
    if (kind === "ownership")
      setOf({
        holder: "",
        kind: "Company",
        entityId: entities[0]?.id || "",
        percentage: 100,
        shareClass: "Ordinary",
        shares: 0,
      });
    if (kind === "branch")
      setBf({
        entityId: entities[0]?.id || "",
        name: "",
        type: "Branch",
        commenceDate: "",
        status: "Active",
        address: "",
        state: "",
        country: "",
      });
    if (kind === "officer")
      setGf({
        entityId: entities[0]?.id || "",
        name: "",
        role: "Director",
        appointed: "",
      });
    if (kind === "document")
      setDf({
        entityId: entities[0]?.id || "",
        name: "",
        type: "SSM / Statutory",
        expiry: "",
        size: "",
        file: null,
      });
    if (kind === "user")
      setUf({ name: "", email: "", role: "Viewer", status: "Active" });
    setModal(kind);
  };
  function saveEntity() {
    if (!ef.name.trim()) return;
    if (editId) {
      setEntities((v) => v.map((e) => (e.id === editId ? { ...e, ...ef } : e)));
      log("Entity updated", ef.name);
    } else {
      setEntities((v) => [...v, { id: crypto.randomUUID(), ...ef }]);
      log("Entity created", ef.name);
    }
    setModal(null);
  }
  function saveOwnership() {
    if (!of.holder.trim() || !of.entityId) return;
    const currentOwnership = editId
        ? ownerships.find((ownership) => ownership.id === editId)
        : undefined,
      currentHolder = currentOwnership
        ? holders.find((holder) => holder.id === currentOwnership.holderId)
        : undefined;
    let h = currentHolder || holders.find(
      (h) => h.name.toLowerCase() === of.holder.toLowerCase(),
    );
    if (currentHolder) {
      h = { ...currentHolder, name: of.holder.trim(), kind: of.kind };
      setHolders((rows) =>
        rows.map((holder) => (holder.id === currentHolder.id ? h! : holder)),
      );
    }
    if (!h) {
      h = { id: crypto.randomUUID(), name: of.holder, kind: of.kind };
      setHolders((v) => [...v, h!]);
    }
    const row = {
      holderId: h.id,
      entityId: of.entityId,
      percentage: Number(of.percentage),
      shareClass: of.shareClass,
      shares: Number(of.shares),
    };
    if (editId)
      setOwnerships((v) =>
        v.map((o) => (o.id === editId ? { ...o, ...row } : o)),
      );
    else setOwnerships((v) => [...v, { id: crypto.randomUUID(), ...row }]);
    log(
      editId ? "Ownership updated" : "Ownership created",
      `${of.holder} — ${of.percentage}%`,
    );
    setModal(null);
  }
  function saveBranch() {
    if (!bf.name.trim() || !bf.entityId) return;
    const row = { ...bf };
    if (editId)
      setBranches((v) =>
        v.map((b) => (b.id === editId ? { ...b, ...row } : b)),
      );
    else setBranches((v) => [...v, { id: crypto.randomUUID(), ...row }]);
    log(
      editId ? "Outlet / branch updated" : "Outlet / branch added",
      `${bf.name} · ${entities.find((e) => e.id === bf.entityId)?.name || "Entity"}`,
    );
    setModal(null);
  }
  function saveOfficer() {
    if (!gf.name.trim()) return;
    const row = { ...gf };
    if (editId)
      setOfficers((v) =>
        v.map((o) => (o.id === editId ? { ...o, ...row } : o)),
      );
    else setOfficers((v) => [...v, { id: crypto.randomUUID(), ...row }]);
    log(
      editId ? "Officer updated" : "Officer added",
      `${gf.name} · ${gf.role}`,
    );
    setModal(null);
  }
  async function saveUser() {
    if (!isMaster || !uf.name.trim() || !uf.email.trim()) return;
    if (
      users.some(
        (u) =>
          u.email.toLowerCase() === uf.email.toLowerCase() && u.id !== editId,
      )
    ) {
      alert("This email address is already registered.");
      return;
    }
    const row = { ...uf, email: uf.email.trim().toLowerCase() };
    const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          editId
            ? { action: "update-user", id: editId, ...row }
            : { action: "create-user", ...row },
        ),
      }),
      result = await response.json();
    if (!response.ok) {
      alert(result.error || "User could not be saved.");
      return;
    }
    if (editId)
      setUsers((v) => v.map((u) => (u.id === editId ? { ...u, ...row } : u)));
    else {
      setUsers((v) => [...v, { id: result.id, ...row }]);
      alert(
        `User created. Temporary password: ${result.tempPassword}\n\nPlease provide it securely. The user must change it at first login.`,
      );
    }
    log(editId ? "User updated" : "User added", `${uf.name} · ${uf.role}`);
    setModal(null);
  }
  async function resetUserPassword(u: AppUser) {
    const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset-password", id: u.id }),
      }),
      d = await r.json();
    if (!r.ok) {
      alert(d.error || "Password could not be reset.");
      return;
    }
    alert(
      `Temporary password for ${u.name}: ${d.tempPassword}\n\nThe user must change it at the next login.`,
    );
  }
  async function saveDocument() {
    const selected = df.file || docRef.current?.files?.[0] || null;
    if (!df.name.trim() || !selected) return;
    const body = new FormData();
    body.append("file", selected);
    const response = await fetch("/api/files", { method: "POST", body });
    if (!response.ok) {
      alert("The file could not be uploaded. Please try again.");
      return;
    }
    const stored = await response.json();
    setDocuments((v) => [
      ...v,
      {
        id: crypto.randomUUID(),
        entityId: df.entityId,
        name: df.name,
        type: df.type,
        expiry: df.expiry,
        size: df.size,
        fileId: stored.id,
      },
    ]);
    log("Document uploaded", df.name);
    setModal(null);
  }
  function editEntity(e: Entity) {
    setEditId(e.id);
    setEf({ ...e });
    setModal("entity");
  }
  function editOwnership(o: Ownership) {
    const h = holders.find((h) => h.id === o.holderId);
    setEditId(o.id);
    setOf({
      holder: h?.name || "",
      kind: h?.kind || "Company",
      entityId: o.entityId,
      percentage: o.percentage,
      shareClass: o.shareClass,
      shares: o.shares,
    });
    setModal("ownership");
  }
  function editBranch(b: Branch) {
    setEditId(b.id);
    setBf({
      entityId: b.entityId,
      name: b.name,
      type: b.type,
      commenceDate: b.commenceDate,
      status: b.status,
      address: b.address,
      state: b.state || "",
      country: b.country || "",
    });
    setModal("branch");
  }
  function editOfficer(o: Officer) {
    setEditId(o.id);
    setGf({
      entityId: o.entityId,
      name: o.name,
      role: o.role,
      appointed: o.appointed,
    });
    setModal("officer");
  }
  function editUser(u: AppUser) {
    if (!isMaster) return;
    setEditId(u.id);
    setUf({ name: u.name, email: u.email, role: u.role, status: u.status });
    setModal("user");
  }
  function remove(kind: string, id: string, label: string) {
    if (!canDelete) return;
    if (kind === "entity") {
      setEntities((v) => v.filter((x) => x.id !== id));
      setOwnerships((v) => v.filter((x) => x.entityId !== id));
      setOfficers((v) => v.filter((x) => x.entityId !== id));
      setBranches((v) => v.filter((x) => x.entityId !== id));
      setDocuments((v) => v.filter((x) => x.entityId !== id));
    }
    if (kind === "ownership")
      setOwnerships((v) => v.filter((x) => x.id !== id));
    if (kind === "branch") setBranches((v) => v.filter((x) => x.id !== id));
    if (kind === "officer") setOfficers((v) => v.filter((x) => x.id !== id));
    if (kind === "document") setDocuments((v) => v.filter((x) => x.id !== id));
    if (
      kind === "user" &&
      users.find((u) => u.id === id)?.email !== session?.email
    )
      setUsers((v) => v.filter((x) => x.id !== id));
    log(`${kind} deleted`, label);
  }
  function exportWorkbook() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        entities.map((e) => ({
          ID: e.id,
          "Company Name": e.name,
          "Registration No": e.reg,
          "Incorporation Date": e.incorporated,
          "Opening Date": e.opened,
          Type: e.type,
          Status: e.status,
          Activity: e.activity,
          "Parent ID": e.parentId,
          "Share Capital": e.capital,
          "Issued Shares": e.shares,
          "Default Share Class": e.shareClass,
          Remark: e.remark || "",
        })),
      ),
      "Entities",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        ownerships.map((o) => ({
          ID: o.id,
          Shareholder: holderName(o.holderId),
          "Shareholder Type": holders.find((h) => h.id === o.holderId)?.kind,
          Company: entities.find((e) => e.id === o.entityId)?.name,
          "Ownership %": o.percentage,
          "Effective %": effective.find((x) => x.id === o.id)?.effective,
          "Share Class": o.shareClass,
          Shares: o.shares,
        })),
      ),
      "Ownership",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        branches.map((b) => ({
          ID: b.id,
          Company: entities.find((e) => e.id === b.entityId)?.name,
          "Outlet / Branch Name": b.name,
          Type: b.type,
          "Commencement Date": b.commenceDate,
          Status: b.status,
          Address: b.address,
          State: b.state || "",
          Country: b.country || "",
        })),
      ),
      "Outlets & Branches",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        officers.map((o) => ({
          ...o,
          Company: entities.find((e) => e.id === o.entityId)?.name,
        })),
      ),
      "Officers",
    );
    XLSX.writeFile(wb, "Structura_Group_Registry.xlsx");
    log("Excel exported", "Full Structura workbook");
  }
  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        [
          "Company Name",
          "Registration No",
          "Incorporation Date",
          "Opening Date",
          "Type",
          "Status",
          "Activity",
          "Parent Company",
          "Share Capital",
          "Issued Shares",
          "Default Share Class",
          "Remark",
        ],
        [
          "Example Sdn Bhd",
          "202601012345",
          "2026-01-01",
          "2026-02-01",
          "Subsidiary",
          "Active",
          "F&B outlet",
          "",
          100000,
          100000,
          "Ordinary",
          "Operating company for Klang Valley outlets",
        ],
      ]),
      "Entities",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        [
          "Shareholder",
          "Shareholder Type",
          "Company",
          "Ownership %",
          "Share Class",
          "Shares",
        ],
        [
          "Example Holding Sdn Bhd",
          "Company",
          "Example Sdn Bhd",
          100,
          "Ordinary",
          100000,
        ],
      ]),
      "Ownership",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        [
          "Company",
          "Outlet / Branch Name",
          "Type",
          "Commencement Date",
          "Status",
          "Address",
          "State",
          "Country",
        ],
        [
          "Example Sdn Bhd",
          "KLCC Outlet",
          "Outlet",
          "2026-03-01",
          "Active",
          "Kuala Lumpur",
          "Kuala Lumpur",
          "Malaysia",
        ],
      ]),
      "Outlets & Branches",
    );
    XLSX.writeFile(wb, "Structura_Import_Template.xlsx");
  }
  function importExcel(file: File) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const wb = XLSX.read(r.result, { type: "array" }),
          er = XLSX.utils.sheet_to_json<Record<string, any>>(
            wb.Sheets["Entities"] || wb.Sheets[wb.SheetNames[0]],
          ),
          or = wb.Sheets["Ownership"]
            ? XLSX.utils.sheet_to_json<Record<string, any>>(
                wb.Sheets["Ownership"],
              )
            : [],
          br = wb.Sheets["Outlets & Branches"]
            ? XLSX.utils.sheet_to_json<Record<string, any>>(
                wb.Sheets["Outlets & Branches"],
              )
            : [];
        const es: Entity[] = er
          .filter((x) => x["Company Name"])
          .map((x) => ({
            id: crypto.randomUUID(),
            name: String(x["Company Name"]),
            reg: String(x["Registration No"] || ""),
            incorporated: String(x["Incorporation Date"] || ""),
            opened: String(x["Opening Date"] || ""),
            type: String(x.Type || "Subsidiary"),
            status: String(x.Status || "Active"),
            activity: String(x.Activity || ""),
            parentId: "",
            capital: Number(x["Share Capital"] || 0),
            shares: Number(x["Issued Shares"] || 0),
            shareClass: String(x["Default Share Class"] || "Ordinary"),
            remark: String(x.Remark || ""),
          }));
        const hs: Holder[] = [],
          os: Ownership[] = [];
        or.forEach((x) => {
          const e = es.find((y) => y.name === String(x.Company));
          if (!e || !x.Shareholder) return;
          let h = hs.find((y) => y.name === String(x.Shareholder));
          if (!h) {
            h = {
              id: crypto.randomUUID(),
              name: String(x.Shareholder),
              kind:
                x["Shareholder Type"] === "Individual"
                  ? "Individual"
                  : "Company",
            };
            hs.push(h);
          }
          os.push({
            id: crypto.randomUUID(),
            holderId: h.id,
            entityId: e.id,
            percentage: Number(x["Ownership %"] || 0),
            shareClass: String(x["Share Class"] || "Ordinary"),
            shares: Number(x.Shares || 0),
          });
        });
        const bs: Branch[] = br
          .map((x) => {
            const e = es.find((y) => y.name === String(x.Company));
            return e && x["Outlet / Branch Name"]
              ? {
                  id: crypto.randomUUID(),
                  entityId: e.id,
                  name: String(x["Outlet / Branch Name"]),
                  type: String(x.Type || "Branch"),
                  commenceDate: String(x["Commencement Date"] || ""),
                  status: String(x.Status || "Active"),
                  address: String(x.Address || ""),
                  state: String(x.State || ""),
                  country: String(x.Country || ""),
                }
              : null;
          })
          .filter(Boolean) as Branch[];
        setEntities(es);
        setHolders(hs);
        setOwnerships(os);
        setBranches(bs);
        setOfficers([]);
        setDocuments([]);
        log(
          "Excel imported",
          `${es.length} entities, ${os.length} ownership records and ${bs.length} locations`,
        );
      } catch {
        alert(
          "The Excel file could not be read. Please use the Structura template.",
        );
      }
    };
    r.readAsArrayBuffer(file);
  }
  function backup() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              entities,
              holders,
              ownerships,
              officers,
              branches,
              documents,
              audit,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    a.download = "Structura_Backup.json";
    a.click();
  }
  async function login() {
    setLoginError("");
    if (!loginForm.email.trim() || !loginForm.password) {
      setLoginError("Please enter your email address and password.");
      return;
    }
    setLoginBusy(true);
    try {
      const r = await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "login", ...loginForm }),
        }),
        text = await r.text();
      let d: any = {};
      try {
        d = JSON.parse(text);
      } catch {}
      if (!r.ok) {
        setLoginError(
          d.error || "The sign-in service was unavailable. Please try again.",
        );
        return;
      }
      setSession(d.user);
      setReady(false);
      setRegistryLoaded(false);
    } catch {
      setLoginError(
        "Unable to connect. Please check your internet connection and try again.",
      );
    } finally {
      setLoginBusy(false);
    }
  }
  async function logout() {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setSession(null);
    setReady(false);
    setRegistryLoaded(false);
    setEntities([]);
    setUsers([]);
  }
  async function changePassword() {
    const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "change-password",
          password: newPassword,
        }),
      }),
      d = await r.json();
    if (!r.ok) {
      setLoginError(d.error);
      return;
    }
    setSession((s) => (s ? { ...s, mustChange: false } : s));
    setNewPassword("");
  }
  async function restoreLatest() {
    if (
      !confirm(
        "Restore the latest automatic backup? Current registry data will be replaced.",
      )
    )
      return;
    const r = await fetch("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "restore-latest-nonempty",
        scope: "registry",
      }),
    });
    if (r.ok) location.reload();
    else alert("No automatic backup is available yet.");
  }
  async function loadBackupVersions() {
    setBackupsBusy(true);
    try {
      const response = await fetch("/api/state", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "list-backups", scope: "registry" }),
        }),
        result = await response.json();
      if (!response.ok) throw new Error(result.error || "Versions could not be loaded");
      setBackupVersions(result.backups || []);
    } catch (error: any) {
      alert(error.message || "Versions could not be loaded.");
    }
    setBackupsBusy(false);
  }
  async function restoreVersion(version: any) {
    if (!confirm(`Restore the registry saved on ${new Date(version.createdAt).toLocaleString()}?\n\nThe current registry will be backed up first.`)) return;
    const response = await fetch("/api/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "restore-version", scope: "registry", id: version.id }),
      }),
      result = await response.json();
    if (!response.ok) return alert(result.error || "This version could not be restored.");
    localStorage.removeItem("structura-final-v1");
    localStorage.removeItem("group-structure-v1");
    localStorage.removeItem("structura-emergency-backup-v2");
    location.reload();
  }
  if (!authReady)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <GitFork />
          <h1>Structura</h1>
          <p>Preparing your secure workspace…</p>
        </div>
      </div>
    );
  if (!session)
    return (
      <LoginScreen
        form={loginForm}
        setForm={setLoginForm}
        error={loginError}
        login={login}
        busy={loginBusy}
      />
    );
  if (session.mustChange)
    return (
      <PasswordChange
        name={session.name}
        password={newPassword}
        setPassword={setNewPassword}
        error={loginError}
        save={changePassword}
        logout={logout}
      />
    );
  const healthChecks = entities.flatMap((e) => [
      !!e.reg,
      !!e.incorporated,
      !!e.opened,
      Math.abs(total(e.id) - 100) < 0.001,
      !!e.remark,
      officers.some((o) => o.entityId === e.id),
    ]),
    healthScore = healthChecks.length
      ? Math.round(
          (healthChecks.filter(Boolean).length / healthChecks.length) * 100,
        )
      : 0;
  const navGroups: { label: string; items: [Section, string, any][] }[] = [
      {
        label: "OVERVIEW",
        items: [["dashboard", "Dashboard", LayoutDashboard]],
      },
      {
        label: "CORPORATE REGISTRY",
        items: [
          ["structure", "Group structure", Network],
          ["entities", "Entities & ownership", Building2],
          ["shareholders", "Shareholders", Users],
          ["governance", "Governance", ShieldCheck],
          ["documents", "Documents & reminders", FileText],
        ],
      },
      {
        label: "ORGANISATION",
        items: [["orgchart", "Organisation chart", Users]],
      },
      {
        label: "REPORTING & CONTROL",
        items: [
          ["reports", "Reports & charts", FileText],
          ["audit", "Change history", History],
        ],
      },
      {
        label: "ADMINISTRATION",
        items: (isMaster
          ? [
              ["users", "User maintenance", UserCog],
              ["settings", "System settings", ShieldCheck],
            ]
          : []) as [Section, string, any][],
      },
    ],
    nav = navGroups.flatMap((g) => g.items);
  return (
    <main className="sf-shell">
      <aside className={`sf-side${sidebarCollapsed ? " collapsed" : ""}`}>
        <div className="sf-brand">
          <i>
            <GitFork />
          </i>
          <div>
            <strong>Structura</strong>
            <small>Corporate Registry</small>
          </div>
          <button className="sf-collapse" type="button" title={sidebarCollapsed ? "Expand navigation" : "Hide navigation"} aria-label={sidebarCollapsed ? "Expand navigation" : "Hide navigation"} onClick={() => setSidebarCollapsed((value) => !value)}>
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>
        <nav>
          {sidebarCollapsed ? nav.map(([key, label, Icon]) => (
            <button key={key} className={section === key ? "active" : ""} title={label} aria-label={label} onClick={() => setSection(key)}>
              <Icon /><span>{label}</span>
              {key === "documents" && expiring > 0 ? <b>{expiring}</b> : null}
            </button>
          )) : navGroups.filter((g) => g.items.length).map((group) => (
              <div className="sf-nav-group" key={group.label}>
                <button type="button" className={`sf-group-toggle${openNavGroup === group.label ? " open" : ""}`} aria-expanded={openNavGroup === group.label} onClick={() => setOpenNavGroup((current) => current === group.label ? "" : group.label)}>
                  <span>{group.label}</span><ChevronDown />
                </button>
                <div className={`sf-nav-items${openNavGroup === group.label ? "" : " closed"}`}>
                  {group.items.map(([key, label, Icon]) => (
                  <button
                    key={key}
                    className={section === key ? "active" : ""}
                    onClick={() => { setSection(key); setOpenNavGroup(group.label); }}
                  >
                    <Icon />
                    <span>{label}</span>
                    {key === "documents" && expiring > 0 ? (
                      <b>{expiring}</b>
                    ) : null}
                  </button>
                  ))}
                </div>
              </div>
            ))}
        </nav>
        <div className="sf-health">
          <label>DATA & COMPLIANCE HEALTH</label>
          <strong>{healthScore}% complete</strong>
          <div>
            <i
              style={{
                width: `${healthScore}%`,
              }}
            />
          </div>
          <small>
            Checks ownership, dates, remarks, officers and registration data
          </small>
        </div>
        <div className="sf-user">
          <span>
            {(currentUser?.name || "User")
              .split(" ")
              .map((x) => x[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <div>
            <strong>{currentUser?.name || "Restricted user"}</strong>
            <small>{currentUser?.role || "No access"}</small>
          </div>
          <button className="sf-logout" title="Log out" onClick={logout}>
            <LogOut />
          </button>
        </div>
      </aside>
      <section className={`sf-work${sidebarCollapsed ? " expanded" : ""}`}>
        <header className="sf-header">
          <div>
            <p>
              STRUCTURA / {nav.find((n) => n[0] === section)?.[1].toUpperCase()}
            </p>
            <h1>{nav.find((n) => n[0] === section)?.[1]}</h1>
            <span>
              Corporate records, ownership intelligence and statutory reminders.
            </span>
          </div>
          <div className="sf-actions">
            <input
              ref={importRef}
              hidden
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) =>
                e.target.files?.[0] && importExcel(e.target.files[0])
              }
            />
            {isMaster && (
              <Button variant="outline" onClick={downloadTemplate}>
                <FileDown />
                Template
              </Button>
            )}
            {isMaster && (
              <Button
                variant="outline"
                onClick={() => importRef.current?.click()}
              >
                <Upload />
                Import Excel
              </Button>
            )}
            <Button variant="outline" onClick={() => window.print()}>
              <FileText />
              Print
            </Button>
            <Button onClick={exportWorkbook}>
              <Download />
              Export Excel
            </Button>
          </div>
        </header>
        {entities.length === 0 && section !== "audit" && section !== "users" ? (
          <div className="sf-empty-banner">
            <AlertTriangle />
            <div>
              <strong>Your registry is empty</strong>
              <span>
                Old demonstration figures have been removed. Import the
                Structura Excel template or add your first entity.
              </span>
            </div>
            {canCreate && (
              <Button onClick={() => openNew("entity")}>
                <Plus />
                Add first entity
              </Button>
            )}
          </div>
        ) : null}
        {section === "dashboard" && (
          <Dashboard
            entities={entities}
            ownerships={ownerships}
            officers={officers}
            documents={documents}
            balanced={balanced}
            expiring={expiring}
            onGo={setSection}
          />
        )}
        {section === "structure" && (
          <Structure
            entities={entities}
            ownerships={ownerships}
            holders={holders}
            effective={effective}
            branches={branches}
            onEdit={() => setSection("entities")}
            canEdit={canEdit}
          />
        )}
        {section === "entities" && (
          <>
            <div className="sf-subnav">
              <div>
                {canCreate && (
                  <Button onClick={() => openNew("entity")}>
                    <Plus />
                    Add entity
                  </Button>
                )}
                {canCreate && (
                  <Button
                    variant="outline"
                    onClick={() => openNew("ownership")}
                  >
                    <Plus />
                    Add ownership
                  </Button>
                )}
                {canCreate && (
                  <Button
                    variant="outline"
                    disabled={!entities.length}
                    onClick={() => openNew("branch")}
                  >
                    <Plus />
                    Add outlet / branch
                  </Button>
                )}
              </div>
              <div className="sf-search">
                <Search />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search registry"
                />
              </div>
            </div>
            <DataTable
              variant="six"
              headers={[
                "Company",
                "Dates",
                "Capital & shares",
                "Ownership",
                "Remark",
                "Actions",
              ]}
            >
              {filtered.map((e) => (
                <div className="sf-row" key={e.id}>
                  <span>
                    <strong>{e.name}</strong>
                    <small>
                      {e.reg || "No registration number"} · {e.type} ·{" "}
                      {branches.filter((b) => b.entityId === e.id).length}{" "}
                      locations
                    </small>
                  </span>
                  <span>
                    <strong>{e.incorporated || "—"}</strong>
                    <small>Opened {e.opened || "—"}</small>
                  </span>
                  <span>
                    <strong>RM {e.capital.toLocaleString()}</strong>
                    <small>
                      {e.shares.toLocaleString()} {e.shareClass} shares
                    </small>
                  </span>
                  <span>
                    <strong className={total(e.id) === 100 ? "good" : "bad"}>
                      {total(e.id)}%
                    </strong>
                    <small>
                      {total(e.id) === 100 ? "Balanced" : "Needs review"}
                    </small>
                  </span>
                  <span>
                    <strong>{e.remark || "—"}</strong>
                  </span>
                  <Actions
                    edit={canEdit ? () => editEntity(e) : undefined}
                    del={
                      canDelete
                        ? () => remove("entity", e.id, e.name)
                        : undefined
                    }
                  />
                </div>
              ))}
            </DataTable>
            <h2 className="sf-section-title">Outlet & branch register</h2>
            <DataTable
              headers={[
                "Location",
                "Legal entity",
                "Type / status",
                "Commenced",
                "Actions",
              ]}
            >
              {branches.map((b) => (
                <div className="sf-row" key={b.id}>
                  <span>
                    <strong>{b.name}</strong>
                    <small>
                      {b.address || "No address recorded"}
                      {[b.state, b.country].filter(Boolean).length
                        ? ` · ${[b.state, b.country].filter(Boolean).join(", ")}`
                        : ""}
                    </small>
                  </span>
                  <span>
                    <strong>
                      {entities.find((e) => e.id === b.entityId)?.name ||
                        "Unknown"}
                    </strong>
                  </span>
                  <span>
                    <strong>{b.type}</strong>
                    <small>{b.status}</small>
                  </span>
                  <span>
                    <strong>{b.commenceDate || "—"}</strong>
                  </span>
                  <Actions
                    edit={canEdit ? () => editBranch(b) : undefined}
                    del={
                      canDelete
                        ? () => remove("branch", b.id, b.name)
                        : undefined
                    }
                  />
                </div>
              ))}
            </DataTable>
            <h2 className="sf-section-title">Ownership register</h2>
            <DataTable
              headers={[
                "Shareholder",
                "Investee company",
                "Direct / effective",
                "Shareholding",
                "Actions",
              ]}
            >
              {ownerships.map((o) => (
                <div className="sf-row" key={o.id}>
                  <span>
                    <strong>{holderName(o.holderId)}</strong>
                    <small>
                      {holders.find((h) => h.id === o.holderId)?.kind}
                    </small>
                  </span>
                  <span>
                    <strong>
                      {entities.find((e) => e.id === o.entityId)?.name ||
                        "Unknown"}
                    </strong>
                  </span>
                  <span>
                    <strong>{o.percentage}% direct</strong>
                    <small>
                      {effective
                        .find((x) => x.id === o.id)
                        ?.effective.toFixed(2)}
                      % effective
                    </small>
                  </span>
                  <span>
                    <strong>{o.shares.toLocaleString()} shares</strong>
                    <small>{o.shareClass}</small>
                  </span>
                  <Actions
                    edit={canEdit ? () => editOwnership(o) : undefined}
                    del={
                      canDelete
                        ? () =>
                            remove("ownership", o.id, holderName(o.holderId))
                        : undefined
                    }
                  />
                </div>
              ))}
            </DataTable>
          </>
        )}
        {section === "shareholders" && (
          <DataTable
            headers={["Shareholder", "Type", "Holdings", "Companies", "Status"]}
          >
            {holders.map((h) => {
              const os = ownerships.filter((o) => o.holderId === h.id);
              return (
                <div className="sf-row simple" key={h.id}>
                  <span>
                    <strong>{h.name}</strong>
                  </span>
                  <span>
                    <mark>{h.kind}</mark>
                  </span>
                  <span>
                    <strong>
                      {os.reduce((s, o) => s + o.shares, 0).toLocaleString()}{" "}
                      shares
                    </strong>
                  </span>
                  <span>
                    <strong>{os.length}</strong>
                    <small>ownership records</small>
                  </span>
                  <span>
                    <mark className="active-pill">Active</mark>
                  </span>
                </div>
              );
            })}
          </DataTable>
        )}
        {section === "governance" && (
          <>
            <div className="sf-subnav">
              <div>
                {canCreate && (
                  <Button onClick={() => openNew("officer")}>
                    <Plus />
                    Add director / secretary
                  </Button>
                )}
              </div>
            </div>
            <DataTable
              headers={[
                "Name",
                "Role",
                "Company",
                "Appointment date",
                "Actions",
              ]}
            >
              {officers.map((o) => (
                <div className="sf-row" key={o.id}>
                  <span>
                    <strong>{o.name}</strong>
                  </span>
                  <span>
                    <mark>{o.role}</mark>
                  </span>
                  <span>
                    <strong>
                      {entities.find((e) => e.id === o.entityId)?.name ||
                        "Unknown"}
                    </strong>
                  </span>
                  <span>
                    <strong>{o.appointed || "—"}</strong>
                  </span>
                  <Actions
                    edit={canEdit ? () => editOfficer(o) : undefined}
                    del={
                      canDelete
                        ? () => remove("officer", o.id, o.name)
                        : undefined
                    }
                  />
                </div>
              ))}
            </DataTable>
          </>
        )}
        {section === "documents" && (
          <>
            <div className="sf-subnav">
              <div>
                {canCreate && (
                  <Button onClick={() => openNew("document")}>
                    <Plus />
                    Attach document
                  </Button>
                )}
              </div>
            </div>
            <DataTable
              headers={[
                "Document",
                "Company",
                "Category",
                "Expiry / reminder",
                "Actions",
              ]}
            >
              {documents.map((d) => (
                <div className="sf-row" key={d.id}>
                  <span>
                    {d.fileId ? (
                      <a href={`/api/files?id=${d.fileId}`}>
                        <strong>{d.name}</strong>
                      </a>
                    ) : (
                      <strong>{d.name}</strong>
                    )}
                    <small>
                      {d.size || "File reference"}
                      {d.fileId ? " · Cloud stored" : ""}
                    </small>
                  </span>
                  <span>
                    <strong>
                      {entities.find((e) => e.id === d.entityId)?.name ||
                        "Unknown"}
                    </strong>
                  </span>
                  <span>
                    <mark>{d.type}</mark>
                  </span>
                  <span>
                    <strong
                      className={
                        d.expiry &&
                        new Date(d.expiry) < new Date(Date.now() + 7776000000)
                          ? "bad"
                          : ""
                      }
                    >
                      {d.expiry || "No expiry"}
                    </strong>
                  </span>
                  <Actions
                    del={
                      canDelete
                        ? () => remove("document", d.id, d.name)
                        : undefined
                    }
                  />
                </div>
              ))}
            </DataTable>
          </>
        )}
        {section === "orgchart" && (
          <OrgChart
            canEdit={canEdit}
            canCreate={canCreate}
            canDelete={canDelete}
          />
        )}
        {section === "reports" && (
          <ReportCentre
            entities={entities}
            holders={holders}
            ownerships={ownerships}
            branches={branches}
          />
        )}
        {section === "audit" && (
          <>
            <div className="sf-subnav">
              <div>
                {isMaster && (
                  <Button variant="outline" onClick={backup}>
                    <Archive />
                    Download backup
                  </Button>
                )}
              </div>
            </div>
            <DataTable
              headers={["Date & time", "Activity", "Details", "User", "Status"]}
            >
              {audit.map((a) => (
                <div className="sf-row simple" key={a.id}>
                  <span>
                    <strong>{a.at}</strong>
                  </span>
                  <span>
                    <strong>{a.action}</strong>
                  </span>
                  <span>
                    <small>{a.detail}</small>
                  </span>
                  <span>
                    <strong>{currentUser?.name || "System user"}</strong>
                  </span>
                  <span>
                    <mark className="active-pill">Recorded</mark>
                  </span>
                </div>
              ))}
            </DataTable>
          </>
        )}
        {section === "users" && isMaster && (
          <>
            <div className="sf-subnav">
              <div>
                <Button onClick={() => openNew("user")}>
                  <Plus />
                  Add user
                </Button>
              </div>
            </div>
            <section className="sf-card">
              <h2>Role access matrix</h2>
              <p>
                Master Admin has full control. Admin Assistant can view, edit
                and print. Viewer can only view and print. User maintenance is
                available only to Master Admin.
              </p>
            </section>
            <h2 className="sf-section-title">Registered users</h2>
            <DataTable headers={["User", "Email", "Role", "Status", "Actions"]}>
              {users.map((u) => (
                <div className="sf-row" key={u.id}>
                  <span>
                    <strong>{u.name}</strong>
                    <small>
                      {u.email === session.email
                        ? "Current user"
                        : "Structura user"}
                    </small>
                  </span>
                  <span>
                    <strong>{u.email}</strong>
                  </span>
                  <span>
                    <mark>{u.role}</mark>
                  </span>
                  <span>
                    <mark
                      className={u.status === "Active" ? "active-pill" : ""}
                    >
                      {u.status}
                    </mark>
                  </span>
                  <Actions
                    edit={() => editUser(u)}
                    extra={
                      u.email !== session.email ? (
                        <Button
                          variant="ghost"
                          title="Reset password"
                          onClick={() => resetUserPassword(u)}
                        >
                          <KeyRound />
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ))}
            </DataTable>
          </>
        )}
        {section === "settings" && isMaster && (
          <>
            <div className="settings-grid">
              <section className="sf-card">
                <h2>Cloud data storage</h2>
                <p>
                  Registry records, users and automatic versions are stored in
                  the hosted database. Document attachments are stored
                  separately in secure cloud file storage.
                </p>
                <mark className="active-pill">Connected</mark>
              </section>
              <section className="sf-card">
                <h2>Automatic recovery</h2>
                <p>
                  Structura keeps the latest 200 versions whenever registry or
                  organisation data changes.
                </p>
                <Button variant="outline" onClick={restoreLatest}>
                  <History />
                  Restore latest backup
                </Button>
                <Button variant="outline" onClick={loadBackupVersions} disabled={backupsBusy}>
                  <History />
                  {backupsBusy ? "Loading versions…" : "View recovery versions"}
                </Button>
              </section>
              <section className="sf-card">
                <h2>Manual backup</h2>
                <p>
                  Download a complete JSON copy for independent safekeeping or
                  migration.
                </p>
                <Button variant="outline" onClick={backup}>
                  <Archive />
                  Download backup
                </Button>
              </section>
              <section className="sf-card">
                <h2>Data validation</h2>
                <p>
                  {healthScore}% complete across registration details,
                  incorporation and start dates, ownership balance, remarks and
                  appointed officers.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setSection("entities")}
                >
                  <ShieldCheck />
                  Review incomplete data
                </Button>
              </section>
            </div>
            {backupVersions.length > 0 && (
              <>
                <h2 className="sf-section-title">Recovery Centre</h2>
                <DataTable headers={["Saved date", "Entities", "Ownerships", "Other records", "Action"]}>
                  {backupVersions.map((version) => (
                    <div className="sf-row" key={version.id}>
                      <span><strong>{new Date(version.createdAt).toLocaleString()}</strong><small>{version.createdBy || "System"}</small></span>
                      <span><strong>{version.entities}</strong></span>
                      <span><strong>{version.ownerships}</strong></span>
                      <span><strong>{version.branches} outlets · {version.officers} officers</strong></span>
                      <span><Button variant="outline" onClick={() => restoreVersion(version)}>Restore this version</Button></span>
                    </div>
                  ))}
                </DataTable>
              </>
            )}
          </>
        )}
      </section>
      <footer className="sf-copyright">
        © {new Date().getFullYear()} DMS INTELLIGENT SOLUTIONS SDN BHD. All rights reserved.
      </footer>
      <Editor
        modal={modal}
        close={() => setModal(null)}
        edit={!!editId}
        entities={entities}
        ef={ef}
        setEf={setEf}
        of={of}
        setOf={setOf}
        bf={bf}
        setBf={setBf}
        gf={gf}
        setGf={setGf}
        df={df}
        setDf={setDf}
        uf={uf}
        setUf={setUf}
        docRef={docRef}
        saveEntity={saveEntity}
        saveOwnership={saveOwnership}
        saveBranch={saveBranch}
        saveOfficer={saveOfficer}
        saveDocument={saveDocument}
        saveUser={saveUser}
        holders={holders}
        ownerships={ownerships}
        branches={branches}
      />
    </main>
  );
}

function Dashboard({
  entities,
  ownerships,
  officers,
  documents,
  balanced,
  expiring,
  onGo,
}: {
  entities: Entity[];
  ownerships: Ownership[];
  officers: Officer[];
  documents: DocumentRow[];
  balanced: number;
  expiring: number;
  onGo: (s: Section) => void;
}) {
  return (
    <>
      <div className="sf-metrics">
        <article>
          <label>LEGAL ENTITIES</label>
          <strong>{entities.length}</strong>
          <small>
            <Building2 />
            Corporate records
          </small>
        </article>
        <article>
          <label>OWNERSHIP LINKS</label>
          <strong>{ownerships.length}</strong>
          <small>
            <Network />
            Direct shareholdings
          </small>
        </article>
        <article>
          <label>OFFICERS</label>
          <strong>{officers.length}</strong>
          <small>
            <Users />
            Directors and secretaries
          </small>
        </article>
        <article className="dark">
          <label>UPCOMING REMINDERS</label>
          <strong>{expiring}</strong>
          <small>
            <CalendarClock />
            Within 90 days
          </small>
        </article>
      </div>
      <div className="sf-grid">
        <section className="sf-card">
          <h2>Registry completion</h2>
          <div className="sf-progress">
            <i
              style={{
                width: `${entities.length ? (balanced / entities.length) * 100 : 0}%`,
              }}
            />
          </div>
          <strong>
            {balanced}/{entities.length} entities balanced
          </strong>
          <p>Each entity’s direct ownership should total exactly 100%.</p>
          <Button variant="outline" onClick={() => onGo("entities")}>
            Review ownership
          </Button>
        </section>
        <section className="sf-card">
          <h2>Document control</h2>
          <strong>{documents.length} files registered</strong>
          <p>
            {expiring} expiry reminders require attention within the next 90
            days.
          </p>
          <Button variant="outline" onClick={() => onGo("documents")}>
            Open documents
          </Button>
        </section>
      </div>
    </>
  );
}
function Structure({
  entities,
  ownerships,
  holders,
  effective,
  branches,
  onEdit,
  canEdit,
}: {
  entities: Entity[];
  ownerships: Ownership[];
  holders: Holder[];
  effective: (Ownership & { effective: number })[];
  branches: Branch[];
  onEdit: () => void;
  canEdit: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleLocations = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const roots = entities.filter((e) => !e.parentId);
  return (
    <section className="sf-card structure-card">
      <div className="sf-card-head">
        <div>
          <h2>Organisation chart maintenance</h2>
          <p>
            Entity hierarchy is controlled by each entity’s Parent Company
            field.
          </p>
        </div>
        <div>
          <Button variant="outline" onClick={() => window.print()}>
            <Download />
            Export PDF
          </Button>
          {canEdit && (
            <Button onClick={onEdit}>
              <Pencil />
              Maintain chart
            </Button>
          )}
        </div>
      </div>
      <div className="sf-tree">
        {roots.map((root) => (
          <div className="sf-tree-group" key={root.id}>
            <EntityNode e={root} branches={branches} expanded={expanded.has(root.id)} onToggle={() => toggleLocations(root.id)} />
            <div className="sf-tree-children">
              {entities
                .filter((e) => e.parentId === root.id)
                .map((e) => {
                  const os = ownerships.filter((o) => o.entityId === e.id);
                  return (
                    <div key={e.id}>
                      <b>
                        {os
                          .map(
                            (o) =>
                              `${holders.find((h) => h.id === o.holderId)?.name}: ${o.percentage}% (${effective.find((x) => x.id === o.id)?.effective.toFixed(1)}% effective)`,
                          )
                          .join(" · ") || "Ownership pending"}
                      </b>
                      <EntityNode e={e} branches={branches} expanded={expanded.has(e.id)} onToggle={() => toggleLocations(e.id)} />
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
function EntityNode({ e, branches, expanded, onToggle }: { e: Entity; branches: Branch[]; expanded: boolean; onToggle: () => void }) {
  const locations = branches.filter((branch) => branch.entityId === e.id);
  return (
    <div className="sf-entity-stack">
      <article className="sf-node">
        <i><Building2 /></i>
        <div>
          <label>{e.type}</label>
          <strong>{e.name}</strong>
          <small>{e.reg || "Registration pending"}</small>
          <small>Incorp. {e.incorporated || "—"} · Opened {e.opened || "—"}</small>
          {locations.length > 0 && (
            <button className="sf-node-expand" type="button" onClick={onToggle}>
              {expanded ? <ChevronDown /> : <ChevronRight />}
              {locations.length} outlet / branch{locations.length === 1 ? "" : "es"}
            </button>
          )}
        </div>
        <em>{e.status}</em>
      </article>
      {expanded && locations.length > 0 && (
        <div className="sf-node-locations">
          {locations.map((location) => (
            <article key={location.id}>
              <Building2 />
              <div><strong>{location.name}</strong><small>{[location.state, location.country].filter(Boolean).join(", ") || location.address || "Location not stated"} · Commenced {location.commenceDate || "—"}</small></div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
function DataTable({
  headers,
  children,
  variant,
}: {
  headers: string[];
  children: React.ReactNode;
  variant?: string;
}) {
  return (
    <section className={`sf-table ${variant || ""}`}>
      <div className="sf-row sf-head">
        {headers.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      {children}
      <div className="sf-table-foot">End of records</div>
    </section>
  );
}
function Actions({
  edit,
  del,
  extra,
}: {
  edit?: () => void;
  del?: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="sf-row-actions">
      {edit && (
        <Button variant="ghost" title="Edit" onClick={edit}>
          <Pencil />
        </Button>
      )}
      {extra}
      {del && (
        <Button variant="ghost" title="Delete" onClick={del}>
          <Trash2 />
        </Button>
      )}
    </div>
  );
}
function Editor({
  modal,
  close,
  edit,
  entities,
  ef,
  setEf,
  of,
  setOf,
  bf,
  setBf,
  gf,
  setGf,
  df,
  setDf,
  uf,
  setUf,
  docRef,
  saveEntity,
  saveOwnership,
  saveBranch,
  saveOfficer,
  saveDocument,
  saveUser,
  holders,
  ownerships,
  branches,
}: any) {
  if (!modal) return null;
  const requestClose = () => {
    if (
      window.confirm(
        edit
          ? "Cancel editing? Any unsaved changes will be discarded."
          : "Cancel this form? Any information entered will be discarded.",
      )
    )
      close();
  };
  const titles = {
    entity: edit ? "Edit entity" : "Add entity",
    ownership: edit ? "Edit ownership" : "Add ownership",
    branch: edit ? "Edit outlet / branch" : "Add outlet / branch",
    officer: edit ? "Edit officer" : "Add director / secretary",
    document: "Attach document",
    user: edit ? "Edit user" : "Add user",
  };
  const unique = (values: string[]) =>
    [...new Set(values.map((value) => value?.trim()).filter(Boolean))];
  const activityOptions = unique(entities.map((entity: Entity) => entity.activity));
  const shareClassOptions = unique([
    ...entities.map((entity: Entity) => entity.shareClass),
    ...ownerships.map((ownership: Ownership) => ownership.shareClass),
  ]);
  const addressOptions = unique(branches.map((branch: Branch) => branch.address));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{titles[modal as keyof typeof titles]}</DialogTitle>
          <DialogDescription>
            Complete the details below. Required fields are shown first.
          </DialogDescription>
        </DialogHeader>
        {modal === "entity" && (
          <div className="form sf-form">
            <F label="Company name">
              <Input
                value={ef.name}
                onChange={(e) => setEf({ ...ef, name: e.target.value })}
              />
            </F>
            <F label="Registration number">
              <Input
                value={ef.reg}
                onChange={(e) => setEf({ ...ef, reg: e.target.value })}
              />
            </F>
            <F label="Incorporation date">
              <Input
                type="date"
                value={ef.incorporated}
                onChange={(e) => setEf({ ...ef, incorporated: e.target.value })}
              />
            </F>
            <F label="Opening date">
              <Input
                type="date"
                value={ef.opened}
                onChange={(e) => setEf({ ...ef, opened: e.target.value })}
              />
            </F>
            <F label="Entity type">
              <Select
                value={ef.type}
                onChange={(v: string) => setEf({ ...ef, type: v })}
                options={[
                  "Holding Company",
                  "Subsidiary",
                  "Associate",
                  "Outlet Company",
                ]}
              />
            </F>
            <F label="Parent company">
              <select
                value={ef.parentId}
                onChange={(e) => setEf({ ...ef, parentId: e.target.value })}
              >
                <option value="">Top-level entity</option>
                {entities
                  .filter((e: Entity) => e.id !== ef.id)
                  .map((e: Entity) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </F>
            <F label="Principal activity">
              <Input
                list="activity-memory"
                value={ef.activity}
                onChange={(e) => setEf({ ...ef, activity: e.target.value })}
              />
              <datalist id="activity-memory">{activityOptions.map((value) => <option key={value} value={value} />)}</datalist>
            </F>
            <F label="Status">
              <Select
                value={ef.status}
                onChange={(v: string) => setEf({ ...ef, status: v })}
                options={["Active", "Dormant", "Under incorporation", "Closed"]}
              />
            </F>
            <F label="Share capital (RM)">
              <Input
                type="number"
                value={ef.capital}
                onChange={(e) =>
                  setEf({ ...ef, capital: Number(e.target.value) })
                }
              />
            </F>
            <F label="Issued shares">
              <Input
                type="number"
                value={ef.shares}
                onChange={(e) =>
                  setEf({ ...ef, shares: Number(e.target.value) })
                }
              />
            </F>
            <F label="Default share class">
              <Input
                list="share-class-memory"
                value={ef.shareClass}
                onChange={(e) => setEf({ ...ef, shareClass: e.target.value })}
              />
              <datalist id="share-class-memory">{shareClassOptions.map((value) => <option key={value} value={value} />)}</datalist>
            </F>
            <F label="Remark">
              <Input
                value={ef.remark || ""}
                onChange={(e) => setEf({ ...ef, remark: e.target.value })}
                placeholder="Internal note or entity purpose"
              />
            </F>
            <Button onClick={saveEntity}>
              <Save />
              {edit ? "Save changes" : "Create entity"}
            </Button>
          </div>
        )}
        {modal === "ownership" && (
          <div className="form sf-form">
            <F label="Shareholder">
              <Input
                list="shareholder-memory"
                value={of.holder}
                onChange={(e) => setOf({ ...of, holder: e.target.value })}
              />
              <datalist id="shareholder-memory">{holders.map((holder: Holder) => <option key={holder.id} value={holder.name} />)}</datalist>
            </F>
            <F label="Shareholder type">
              <Select
                value={of.kind}
                onChange={(v: string) => setOf({ ...of, kind: v })}
                options={["Company", "Individual"]}
              />
            </F>
            <F label="Investee company">
              <select
                value={of.entityId}
                onChange={(e) => setOf({ ...of, entityId: e.target.value })}
              >
                {entities.map((e: Entity) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </F>
            <F label="Ownership %">
              <Input
                type="number"
                min="0"
                max="100"
                value={of.percentage}
                onChange={(e) =>
                  setOf({ ...of, percentage: Number(e.target.value) })
                }
              />
            </F>
            <F label="Share class">
              <Input
                list="ownership-share-class-memory"
                value={of.shareClass}
                onChange={(e) => setOf({ ...of, shareClass: e.target.value })}
              />
              <datalist id="ownership-share-class-memory">{shareClassOptions.map((value) => <option key={value} value={value} />)}</datalist>
            </F>
            <F label="Number of shares">
              <Input
                type="number"
                value={of.shares}
                onChange={(e) =>
                  setOf({ ...of, shares: Number(e.target.value) })
                }
              />
            </F>
            <Button onClick={saveOwnership}>
              <Save />
              {edit ? "Save changes" : "Create ownership"}
            </Button>
          </div>
        )}
        {modal === "branch" && (
          <div className="form sf-form">
            <F label="Legal entity">
              <select
                value={bf.entityId}
                onChange={(e) => setBf({ ...bf, entityId: e.target.value })}
              >
                {entities.map((e: Entity) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </F>
            <F label="Outlet / branch name">
              <Input
                value={bf.name}
                onChange={(e) => setBf({ ...bf, name: e.target.value })}
              />
            </F>
            <F label="Location type">
              <Select
                value={bf.type}
                onChange={(v: string) => setBf({ ...bf, type: v })}
                options={[
                  "Outlet",
                  "Branch",
                  "Office",
                  "Warehouse",
                  "Central Kitchen",
                ]}
              />
            </F>
            <F label="Date commenced business">
              <Input
                type="date"
                value={bf.commenceDate}
                onChange={(e) => setBf({ ...bf, commenceDate: e.target.value })}
              />
            </F>
            <F label="Status">
              <Select
                value={bf.status}
                onChange={(v: string) => setBf({ ...bf, status: v })}
                options={["Active", "Planned", "Closed"]}
              />
            </F>
            <F label="Address">
              <Input
                list="address-memory"
                value={bf.address}
                onChange={(e) => setBf({ ...bf, address: e.target.value })}
              />
              <datalist id="address-memory">{addressOptions.map((value) => <option key={value} value={value} />)}</datalist>
            </F>
            <F label="State">
              <select value={bf.state} onChange={(e) => setBf({ ...bf, state: e.target.value })}>
                <option value="">Select state</option>
                {["Johor","Kedah","Kelantan","Melaka","Negeri Sembilan","Pahang","Perak","Perlis","Pulau Pinang","Sabah","Sarawak","Selangor","Terengganu","Kuala Lumpur","Labuan","Putrajaya","Outside Malaysia"].map((state) => <option key={state}>{state}</option>)}
              </select>
            </F>
            <F label="Country">
              <select value={bf.country} onChange={(e) => setBf({ ...bf, country: e.target.value })}>
                <option value="">Select country</option>
                {["Malaysia","Singapore","Indonesia","Thailand","Brunei","Vietnam","Philippines","China","Hong Kong","Taiwan","Australia","United Kingdom","United States","Other"].map((country) => <option key={country}>{country}</option>)}
              </select>
            </F>
            <Button onClick={saveBranch}>
              <Save />
              {edit ? "Save changes" : "Add outlet / branch"}
            </Button>
          </div>
        )}
        {modal === "officer" && (
          <div className="form sf-form">
            <F label="Name">
              <Input
                value={gf.name}
                onChange={(e) => setGf({ ...gf, name: e.target.value })}
              />
            </F>
            <F label="Role">
              <Select
                value={gf.role}
                onChange={(v: string) => setGf({ ...gf, role: v })}
                options={[
                  "Director",
                  "Company Secretary",
                  "Alternate Director",
                ]}
              />
            </F>
            <F label="Company">
              <select
                value={gf.entityId}
                onChange={(e) => setGf({ ...gf, entityId: e.target.value })}
              >
                {entities.map((e: Entity) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </F>
            <F label="Appointment date">
              <Input
                type="date"
                value={gf.appointed}
                onChange={(e) => setGf({ ...gf, appointed: e.target.value })}
              />
            </F>
            <Button onClick={saveOfficer}>
              <Save />
              {edit ? "Save changes" : "Add officer"}
            </Button>
          </div>
        )}
        {modal === "document" && (
          <div className="form sf-form">
            <F label="File">
              <input
                ref={docRef}
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    setDf({
                      ...df,
                      name: f.name,
                      size: `${(f.size / 1024).toFixed(0)} KB`,
                    });
                }}
              />
            </F>
            <F label="Company">
              <select
                value={df.entityId}
                onChange={(e) => setDf({ ...df, entityId: e.target.value })}
              >
                {entities.map((e: Entity) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </F>
            <F label="Document category">
              <Select
                value={df.type}
                onChange={(v: string) => setDf({ ...df, type: v })}
                options={[
                  "SSM / Statutory",
                  "Shareholding",
                  "Board resolution",
                  "Agreement",
                  "Licence / Permit",
                  "Tax",
                ]}
              />
            </F>
            <F label="Expiry / reminder date">
              <Input
                type="date"
                value={df.expiry}
                onChange={(e) => setDf({ ...df, expiry: e.target.value })}
              />
            </F>
            <Button onClick={saveDocument}>
              <Save />
              Attach document
            </Button>
          </div>
        )}
        {modal === "user" && (
          <div className="form sf-form">
            <F label="Full name">
              <Input
                value={uf.name}
                onChange={(e) => setUf({ ...uf, name: e.target.value })}
              />
            </F>
            <F label="Email address">
              <Input
                type="email"
                value={uf.email}
                onChange={(e) => setUf({ ...uf, email: e.target.value })}
              />
            </F>
            <F label="Access role">
              <Select
                value={uf.role}
                onChange={(v: string) => setUf({ ...uf, role: v })}
                options={["Master Admin", "Admin Assistant", "Viewer"]}
              />
            </F>
            <F label="Account status">
              <Select
                value={uf.status}
                onChange={(v: string) => setUf({ ...uf, status: v })}
                options={["Active", "Inactive"]}
              />
            </F>
            <Button onClick={saveUser}>
              <Save />
              {edit ? "Save changes" : "Create user"}
            </Button>
          </div>
        )}
        <div className="editor-cancel">
          <Button variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          <small>Unsaved information is protected from accidental closing.</small>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

function LoginScreen({ form, setForm, error, login, busy }: any) {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <i>
            <GitFork />
          </i>
          <div>
            <h1>Structura</h1>
            <p>Corporate Registry</p>
          </div>
        </div>
        <h2>Welcome back</h2>
        <p>
          Sign in to access your corporate structure, ownership and organisation
          records.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login();
          }}
        >
          <F label="Email address">
            <Input
              type="email"
              autoComplete="username"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </F>
          <F label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </F>
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in securely"}
          </button>
        </form>
        <small>Protected cloud access · Structura</small>
        <small className="auth-copyright">
          © {new Date().getFullYear()} DMS INTELLIGENT SOLUTIONS SDN BHD. All rights reserved.
        </small>
      </section>
    </main>
  );
}
function PasswordChange({
  name,
  password,
  setPassword,
  error,
  save,
  logout,
}: any) {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <i>
            <ShieldCheck />
          </i>
          <div>
            <h1>Secure your account</h1>
            <p>First sign-in</p>
          </div>
        </div>
        <h2>Hello, {name}</h2>
        <p>
          Create a private password with at least 10 characters before entering
          Structura.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <F label="New password">
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </F>
          {error && <div className="auth-error">{error}</div>}
          <Button type="submit">Save password and continue</Button>
          <Button type="button" variant="outline" onClick={logout}>
            Log out
          </Button>
        </form>
        <small className="auth-copyright">
          © {new Date().getFullYear()} DMS INTELLIGENT SOLUTIONS SDN BHD. All rights reserved.
        </small>
      </section>
    </main>
  );
}
