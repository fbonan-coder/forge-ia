const $ = (selector) => document.querySelector(selector);
const panel = $("#projectPanel");
const frame = $("#previewFrame");
const shell = $("#previewShell");

let projects = [];
let selectedId = null;
let selectedProject = null;
let currentRuns = [];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
})[character]);

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function previewUrl(id, refresh = false) {
  const url = `/preview/${id}/`;
  return refresh ? `${url}?v=${Date.now()}` : url;
}

function refreshPreview() {
  if (!selectedId) return;
  $("#previewAddress").textContent = `${location.host}/preview/${selectedId}/`;
  frame.src = previewUrl(selectedId, true);
}

function openPanel() {
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  renderProjectList($("#projectSearch").value);
  setTimeout(() => $("#projectSearch").focus(), 50);
}

function closePanel() {
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
}

function renderProjectList(filter = "") {
  const query = filter.trim().toLowerCase();
  const filtered = projects.filter((project) =>
    `${project.name} ${project.slug}`.toLowerCase().includes(query)
  );
  $("#projectList").innerHTML = filtered.length
    ? filtered.map((project) => `
      <button class="project-card ${project.id === selectedId ? "active" : ""}" data-project="${project.id}">
        <span class="project-icon">${escapeHtml(project.name[0]?.toUpperCase() || "P")}</span>
        <span><b>${escapeHtml(project.name)}</b><small>${escapeHtml(project.slug)}</small></span>
        <span class="project-state ${project.state === "active" ? "" : "sleep"}"><i></i>${project.state === "active" ? "Actif" : "En veille"}</span>
      </button>`).join("")
    : '<div class="empty-result">Aucun projet trouvé</div>';

  document.querySelectorAll("[data-project]").forEach((button) => {
    button.onclick = () => selectProject(button.dataset.project);
  });
}

function renderRuns(runs) {
  $("#runCount").textContent = runs.length;
  $("#activityCount").textContent = runs.length;

  $("#runHistory").innerHTML = runs.slice(0, 6).map((run) => `
    <button class="history-item ${run.status}">
      <i></i><span><b>${escapeHtml(run.prompt)}</b><small>${escapeHtml(run.status)} · ${escapeHtml(run.model || "mock")}</small></span>
    </button>`).join("") || '<div class="empty-result">Aucune exécution</div>';

  $("#activityRuns").innerHTML = runs.map((run) => `
    <article class="activity-run ${run.status}">
      <i></i><span><b>${escapeHtml(run.prompt)}</b><small>${escapeHtml(run.status)} · ${escapeHtml(run.model || "mock")}</small></span>
      <small>$${Number(run.cost_usd || 0).toFixed(4)}</small>
    </article>`).join("") || '<div class="empty-result">Aucune exécution</div>';
}

function renderMessages(messages) {
  $("#messages").innerHTML = messages.map((message) => `
    <article class="msg ${message.role === "user" ? "user" : ""}">
      <div class="msg-head">
        ${message.role === "user" ? "" : '<span class="mini">F</span>'}
        <b>${message.role === "user" ? "Vous" : "Forge IA"}</b>
        <time>${message.role === "user" ? "demande" : "réponse"}</time>
      </div>
      <p>${escapeHtml(message.content)}</p>
    </article>`).join("") || '<div class="empty-chat">Commence par décrire ce que tu veux construire.</div>';
  $("#messages").scrollTop = $("#messages").scrollHeight;
}

async function loadProjects() {
  projects = (await request("/api/projects")).projects;
  renderProjectList();
  if (!selectedId && projects.length) selectedId = projects[0].id;
  if (selectedId && projects.some((project) => project.id === selectedId)) {
    await selectProject(selectedId, false);
  }
}

async function selectProject(id, close = true) {
  selectedId = id;
  const [{ project }, { messages }, { runs }] = await Promise.all([
    request(`/api/projects/${id}`),
    request(`/api/projects/${id}/messages`),
    request(`/api/projects/${id}/runs`),
  ]);
  selectedProject = project;
  currentRuns = runs;

  $("#projectMark").textContent = project.name[0]?.toUpperCase() || "P";
  $("#projectName").textContent = project.name;
  $("#projectSlug").textContent = project.slug;
  $("#projectState").textContent = project.state;
  $("#projectCost").textContent = `$${Number(project.total_cost_usd || 0).toFixed(4)}`;
  $("#sideCost").textContent = `$${Number(project.total_cost_usd || 0).toFixed(4)}`;
  $("#lastActivity").textContent = project.last_opened_at
    ? new Date(project.last_opened_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
    : "Jamais";

  renderMessages(messages);
  renderRuns(runs);
  renderProjectList($("#projectSearch").value);
  refreshPreview();
  if (close) closePanel();
}

$("#projectSwitcher").onclick = openPanel;
$("#railProjects").onclick = openPanel;
$("#closeProjects").onclick = closePanel;
$("#projectSearch").oninput = (event) => renderProjectList(event.target.value);
panel.onclick = (event) => { if (event.target === panel) closePanel(); };
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePanel(); });

$("#createForm").onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const { project } = await request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), description: form.get("description") }),
    });
    event.currentTarget.reset();
    projects = (await request("/api/projects")).projects;
    await selectProject(project.id);
  } catch (error) {
    alert(error.message);
  }
};

$("#promptForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!selectedId) return openPanel();
  const input = $("#prompt");
  const prompt = input.value.trim();
  if (!prompt) return;
  const button = event.currentTarget.querySelector(".send");
  button.disabled = true;
  button.textContent = "…";
  input.value = "";
  try {
    await request(`/api/projects/${selectedId}/runs`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    projects = (await request("/api/projects")).projects;
    await selectProject(selectedId, false);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "→";
  }
};

$("#checkpoint").onclick = async (event) => {
  if (!selectedId) return openPanel();
  const button = event.currentTarget;
  try {
    await request(`/api/projects/${selectedId}/checkpoints`, {
      method: "POST",
      body: JSON.stringify({ label: "Checkpoint manuel" }),
    });
    button.classList.add("ok");
    button.textContent = "✓ Checkpoint créé";
    setTimeout(() => {
      button.classList.remove("ok");
      button.textContent = "♧ Créer un checkpoint";
    }, 1600);
  } catch (error) {
    alert(error.message);
  }
};

document.querySelectorAll("[data-device]").forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll("[data-device]").forEach((item) => item.classList.remove("on"));
    button.classList.add("on");
    shell.className = `preview-shell ${button.dataset.device === "desktop" ? "" : button.dataset.device}`;
  };
});

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll("[data-tab]").forEach((item) => item.classList.remove("on"));
    button.classList.add("on");
    const showPreview = button.dataset.tab === "preview";
    shell.style.display = showPreview ? "block" : "none";
    $("#activityView").style.display = showPreview ? "none" : "block";
  };
});

$("#refreshPreview").onclick = refreshPreview;
$("#openPreview").onclick = () => {
  if (!selectedId) return openPanel();
  window.open(previewUrl(selectedId), "_blank", "noopener,noreferrer");
};

request("/api/health")
  .then(({ agent }) => {
    $("#health").textContent = `Serveur actif · ${agent}`;
    $("#modelName").textContent = agent === "claude" ? "＋  Claude Sonnet" : "＋  Agent mock";
  })
  .catch(() => { $("#health").textContent = "Serveur indisponible"; });

loadProjects().catch((error) => {
  console.error(error);
  $("#health").textContent = "Erreur de chargement";
});
