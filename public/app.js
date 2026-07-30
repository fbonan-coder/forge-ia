const $ = (selector) => document.querySelector(selector);
let projects = [];
let selectedId = null;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);

function projectList() {
  $("#projects").innerHTML = projects.map((project) => `
    <button class="project-card ${project.id === selectedId ? "active" : ""}" data-id="${project.id}">
      <span class="icon">${escapeHtml(project.name[0].toUpperCase())}</span>
      <span><b>${escapeHtml(project.name)}</b><small>${escapeHtml(project.slug)}</small></span>
      <i class="state ${project.state}"></i>
    </button>`).join("");
  document.querySelectorAll(".project-card").forEach((button) =>
    button.addEventListener("click", () => selectProject(button.dataset.id)));
}

async function loadProjects() {
  projects = (await request("/api/projects")).projects;
  projectList();
  if (selectedId && projects.some((project) => project.id === selectedId)) await selectProject(selectedId);
}

async function selectProject(id) {
  selectedId = id;
  const [{ project }, { messages }, { runs }] = await Promise.all([
    request(`/api/projects/${id}`),
    request(`/api/projects/${id}/messages`),
    request(`/api/projects/${id}/runs`),
  ]);
  $("#empty").classList.add("hidden");
  $("#view").classList.remove("hidden");
  $("#slug").textContent = project.slug;
  $("#name").textContent = project.name;
  $("#description").textContent = project.description || "Aucune description";
  $("#status").textContent = project.state;
  $("#cost").textContent = `$${Number(project.total_cost_usd).toFixed(4)}`;
  $("#runCount").textContent = runs.length;
  $("#lastActivity").textContent = project.last_opened_at
    ? new Date(project.last_opened_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
    : "Jamais";
  $("#toggleRuntime").textContent = project.state === "active" ? "Mettre en veille" : "Ouvrir le projet";
  $("#messages").innerHTML = messages.map((message) => `
    <article class="message ${message.role}"><b>${message.role === "user" ? "Vous" : "Forge IA"}</b><p>${escapeHtml(message.content)}</p></article>
  `).join("") || "<p>Aucun message.</p>";
  $("#runs").innerHTML = runs.map((run) => `
    <article class="run ${run.status}"><i></i><span><b>${escapeHtml(run.prompt)}</b><small>${run.status} · ${run.model || "mock"}</small></span><small>$${Number(run.cost_usd).toFixed(4)}</small></article>
  `).join("") || "<p>Aucune exécution.</p>";
  projectList();
}

$("#showCreate").onclick = () => $("#createDialog").showModal();
$(".close").onclick = () => $("#createDialog").close();
$("#createForm").onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const { project } = await request("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: form.get("name"), description: form.get("description") }),
  });
  event.currentTarget.reset();
  $("#createDialog").close();
  await loadProjects();
  await selectProject(project.id);
};

$("#toggleRuntime").onclick = async () => {
  const project = projects.find((item) => item.id === selectedId);
  await request(`/api/projects/${selectedId}/${project.state === "active" ? "suspend" : "open"}`, { method: "POST" });
  await loadProjects();
};

$("#checkpoint").onclick = async () => {
  await request(`/api/projects/${selectedId}/checkpoints`, {
    method: "POST",
    body: JSON.stringify({ label: "Checkpoint manuel" }),
  });
  $("#checkpoint").textContent = "✓ Checkpoint créé";
  setTimeout(() => $("#checkpoint").textContent = "Créer un checkpoint", 1400);
};

$("#promptForm").onsubmit = async (event) => {
  event.preventDefault();
  const input = $("#prompt");
  const prompt = input.value.trim();
  if (!prompt) return;
  input.value = "";
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Exécution…";
  try {
    await request(`/api/projects/${selectedId}/runs`, { method: "POST", body: JSON.stringify({ prompt }) });
    await loadProjects();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Exécuter →";
  }
};

request("/api/health").then(({ agent }) => {
  $("#health").textContent = `● Serveur actif · ${agent}`;
}).catch(() => {
  $("#health").textContent = "Serveur indisponible";
});
loadProjects();
