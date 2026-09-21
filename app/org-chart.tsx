"use client";
import { useEffect, useState } from "react";
import {
  Building2,
  Download,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  Users,
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

type NodeType =
  "Group" | "Company" | "Department" | "Region" | "Outlet" | "Position";
type OrgNode = {
  id: string;
  parentId: string;
  type: NodeType;
  unit: string;
  name: string;
  title: string;
  status: "Filled" | "Vacant" | "Planned";
};
const blank: Omit<OrgNode, "id"> = {
  parentId: "",
  type: "Group",
  unit: "",
  name: "",
  title: "",
  status: "Filled",
};

export function OrgChart({
  canEdit = false,
  canCreate = false,
  canDelete = false,
}: {
  canEdit?: boolean;
  canCreate?: boolean;
  canDelete?: boolean;
}) {
  const [nodes, setNodes] = useState<OrgNode[]>([]),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [form, setForm] = useState(blank),
    [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/state?scope=org-chart"),
          cloud = await response.json();
        const cloudNodes = Array.isArray(cloud.data?.nodes)
            ? cloud.data.nodes
            : [],
          legacyNodes = (() => {
            try {
              const parsed = JSON.parse(
                localStorage.getItem("structura-org-chart-v1") || "[]",
              );
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })(),
          mergedById = new Map<string, Partial<OrgNode>>();
        for (const node of [...legacyNodes, ...cloudNodes])
          if (node && typeof node === "object") {
            const id = node.id || crypto.randomUUID();
            mergedById.set(id, { ...(mergedById.get(id) || {}), ...node, id });
          }
        const recovered = [...mergedById.values()]
              .filter((node: Partial<OrgNode>) => node && typeof node === "object")
              .map((node: Partial<OrgNode>) => ({
                ...blank,
                ...node,
                id: node.id || crypto.randomUUID(),
                status: ["Filled", "Vacant", "Planned"].includes(
                  node.status || "",
                )
                  ? (node.status as OrgNode["status"])
                  : "Filled",
              }));
        if (recovered.length) setNodes(recovered);
        if (recovered.length > cloudNodes.length)
          await fetch("/api/state?scope=org-chart", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ nodes: recovered }),
          });
      } catch {}
      setReady(true);
    })();
  }, []);
  useEffect(() => {
    if (!ready || (!canEdit && !canCreate && !canDelete)) return;
    const timer = setTimeout(
      () =>
        fetch("/api/state?scope=org-chart", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nodes }),
        }).catch(() => {}),
      700,
    );
    return () => clearTimeout(timer);
  }, [ready, nodes, canEdit, canCreate, canDelete]);
  const roots = nodes.filter(
    (n) => !n.parentId || !nodes.some((x) => x.id === n.parentId),
  );
  const add = (parentId = "") => {
    setEditing(null);
    setForm({ ...blank, parentId });
    setOpen(true);
  };
  const edit = (n: OrgNode) => {
    setEditing(n.id);
    setForm({
      parentId: n.parentId,
      type: n.type,
      unit: n.unit,
      name: n.name,
      title: n.title,
      status: n.status,
    });
    setOpen(true);
  };
  const save = () => {
    if (!form.unit.trim() && !form.title.trim()) return;
    if (editing)
      setNodes((v) => v.map((n) => (n.id === editing ? { ...n, ...form } : n)));
    else setNodes((v) => [...v, { id: crypto.randomUUID(), ...form }]);
    setOpen(false);
  };
  const remove = (id: string) => {
    const descendants = (parent: string): string[] =>
      nodes
        .filter((n) => n.parentId === parent)
        .flatMap((n) => [n.id, ...descendants(n.id)]);
    const ids = [id, ...descendants(id)];
    setNodes((v) => v.filter((n) => !ids.includes(n.id)));
  };
  return (
    <section className="oc-panel">
      <div className="oc-head">
        <div>
          <h2>People & operating organisation</h2>
          <p>
            Maintain group entities, departments, regional teams, outlets and
            planned positions.
          </p>
        </div>
        <div>
          <Button variant="outline" onClick={() => window.print()}>
            <Download />
            Export PDF
          </Button>
          {canCreate && (
            <Button onClick={() => add()}>
              <Plus />
              Add top level
            </Button>
          )}
        </div>
      </div>
      {nodes.length === 0 ? (
        <div className="oc-empty">
          <Users />
          <h3>Build your organisation chart</h3>
          <p>
            Start with the group or holding company, then add companies,
            departments, regions, outlets and positions underneath it.
          </p>
          {canCreate && (
            <Button onClick={() => add()}>
              <Plus />
              Create first chart box
            </Button>
          )}
        </div>
      ) : (
        <div className="oc-canvas">
          {roots.map((n) => (
            <Branch
              key={n.id}
              node={n}
              nodes={nodes}
              add={add}
              edit={edit}
              remove={remove}
              canEdit={canEdit}
              canCreate={canCreate}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? "Edit organisation chart box"
                : "Add organisation chart box"}
            </DialogTitle>
            <DialogDescription>
              Choose its level and reporting parent, then enter the person and
              job title where applicable.
            </DialogDescription>
          </DialogHeader>
          <div className="form oc-form">
            <label>
              Organisation level
              <select
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as NodeType })
                }
              >
                {[
                  "Group",
                  "Company",
                  "Department",
                  "Region",
                  "Outlet",
                  "Position",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Reports under
              <select
                value={form.parentId}
                onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              >
                <option value="">Top level</option>
                {nodes
                  .filter((n) => n.id !== editing)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.unit || n.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Company / department / unit
              <Input
                value={form.unit}
                placeholder="e.g. Finance Department"
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </label>
            <label>
              Person’s name
              <Input
                value={form.name}
                placeholder={
                  form.status === "Filled"
                    ? "e.g. Dean Yong"
                    : "Leave blank if vacant"
                }
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Job title
              <Input
                value={form.title}
                placeholder="e.g. Group CFO"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              Position status
              <select
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as OrgNode["status"],
                  })
                }
              >
                <option>Filled</option>
                <option>Vacant</option>
                <option>Planned</option>
              </select>
            </label>
            <Button onClick={save}>
              {editing ? "Save changes" : "Add to chart"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Branch({
  node,
  nodes,
  add,
  edit,
  remove,
  canEdit,
  canCreate,
  canDelete,
}: {
  node: OrgNode;
  nodes: OrgNode[];
  add: (id?: string) => void;
  edit: (n: OrgNode) => void;
  remove: (id: string) => void;
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const children = nodes.filter((n) => n.parentId === node.id);
  const Icon =
    node.type === "Position"
      ? UserRound
      : node.type === "Department"
        ? Users
        : Building2;
  return (
    <div className="oc-branch">
      <article className={"oc-node " + (node.status || "Filled").toLowerCase()}>
        <div className="oc-node-top">
          <i>
            <Icon />
          </i>
          <span>{node.type}</span>
          <div>
            {canCreate && (
              <button title="Add underneath" onClick={() => add(node.id)}>
                <Plus />
              </button>
            )}
            {canEdit && (
              <button title="Edit" onClick={() => edit(node)}>
                <Pencil />
              </button>
            )}
            {canDelete && (
              <button title="Delete" onClick={() => remove(node.id)}>
                <Trash2 />
              </button>
            )}
          </div>
        </div>
        <strong>{node.unit || node.title}</strong>
        {node.name && <b>{node.name}</b>}
        {node.title && node.unit && <small>{node.title}</small>}
        <em>{node.status}</em>
      </article>
      {children.length > 0 && (
        <div className="oc-children">
          {children.map((c) => (
            <Branch
              key={c.id}
              node={c}
              nodes={nodes}
              add={add}
              edit={edit}
              remove={remove}
              canEdit={canEdit}
              canCreate={canCreate}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
