// The "Machines" panel: add a machine by pairing link, remove one, see which are reachable.
import { addMachine, listMachines, removeMachine } from "./hosts.ts";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

function esc(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
}

function render() {
  const list = listMachines();
  $("machine-list").innerHTML = list.length
    ? list
        .map(
          (m) =>
            `<li class="machine-row"><b>${esc(m.label)}</b><span class="state" data-state="${esc(m.label)}"></span><button data-remove="${m.id}">Remove</button></li>`
        )
        .join("")
    : `<div class="empty">No machines yet.</div>`;
}

function toggle(open?: boolean) {
  const panel = $("machines");
  const show = open ?? panel.hidden;
  panel.hidden = !show;
  $("btn-machines").setAttribute("aria-expanded", String(show));
  if (show) render();
}

/** Called after each poll so the panel shows which machines answered. */
export function showMachineStatus(
  hosts: { label: string; ok: boolean; error: string | null }[]
) {
  for (const h of hosts) {
    const el = document.querySelector<HTMLElement>(
      `[data-state="${CSS.escape(h.label)}"]`
    );
    if (el) el.textContent = h.ok ? "connected" : h.error || "unreachable";
  }
}

export function setupMachines() {
  $("btn-machines").addEventListener("click", () => toggle());
  document.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).closest("[data-open-machines]"))
      toggle(true);
  });
  $("machine-list").addEventListener("click", (ev) => {
    const id = (ev.target as HTMLElement).closest<HTMLElement>("[data-remove]")
      ?.dataset.remove;
    if (!id) return;
    removeMachine(id);
    location.reload(); // rooms are keyed by machine; a reload is the simplest clean slate
  });
  $<HTMLFormElement>("machine-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const form = ev.target as HTMLFormElement;
    const data = new FormData(form);
    const err = $("machine-error");
    try {
      addMachine(
        String(data.get("label") || ""),
        String(data.get("link") || "")
      );
      form.reset();
      err.hidden = true;
      location.reload();
    } catch (e) {
      err.textContent = (e as Error).message;
      err.hidden = false;
    }
  });
}
