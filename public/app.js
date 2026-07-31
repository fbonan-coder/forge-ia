const $ = (selector) => document.querySelector(selector);
const panel = $("#projectPanel");
const frame = $("#previewFrame");
const shell = $("#previewShell");

let projects = [];
let selectedId = null;
let selectedProject = null;
let currentRuns = [];
let currentFiles = [];

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

function renderCheckpoints(checkpoints) {
  $("#checkpointCount").textContent = checkpoints.length;
  $("#checkpointList").innerHTML = checkpoints.slice(0, 8).map((checkpoint) => `
    <article class="checkpoint-item ${checkpoint.available ? "" : "unavailable"}">
      <span>
        <b>${escapeHtml(checkpoint.label)}</b>
        <small>${new Date(checkpoint.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</small>
      </span>
      <button data-restore="${checkpoint.id}" ${checkpoint.available ? "" : "disabled"}>Restaurer</button>
    </article>`).join("") || '<div class="empty-result">Aucun checkpoint</div>';

  document.querySelectorAll("[data-restore]").forEach((button) => {
    button.onclick = () => restoreCheckpoint(button.dataset.restore);
  });
}

async function restoreCheckpoint(checkpointId) {
  if (!selectedId) return;
  if (!confirm("Restaurer cette version du projet ? Une sauvegarde de la version actuelle sera créée automatiquement.")) return;

  try {
    await request(`/api/projects/${selectedId}/checkpoints`, {
      method: "POST",
      body: JSON.stringify({ restoreId: checkpointId }),
    });
    await selectProject(selectedId, false);
    refreshPreview();
    alert("Checkpoint restauré.");
  } catch (error) {
    alert(error.message);
  }
}

function renderFiles(files) {
  currentFiles = files;
  $("#fileCount").textContent = files.length;
  $("#fileTree").innerHTML = files.map((file) => {
    const depth = Math.max(0, file.path.split("/").length - 1);
    return `
      <button class="file-item ${file.changedInLastRun ? "changed" : ""}" data-file="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}">
        <span class="depth" style="width:${depth * 9}px"></span>
        <i></i><span>${escapeHtml(file.name)}</span>
      </button>`;
  }).join("") || '<div class="empty-result">Aucun fichier</div>';

  document.querySelectorAll("[data-file]").forEach((button) => {
    button.onclick = () => showFile(button.dataset.file);
  });
}

function showFile(filePath) {
  const file = currentFiles.find((item) => item.path === filePath);
  if (!file) return;

  document.querySelectorAll("[data-file]").forEach((item) => {
    item.classList.toggle("on", item.dataset.file === filePath);
  });

  $("#filePath").textContent = file.path;
  $("#fileMeta").textContent = `${file.extension.toUpperCase()} · ${Math.max(1, Math.round(file.size / 1024))} Ko${file.changedInLastRun ? " · modifié récemment" : ""}`;
  const code = $("#fileContent");
  const languageMap = {
    html: "xml", svg: "xml", xml: "xml",
    js: "javascript", mjs: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript",
    css: "css", scss: "scss", json: "json", md: "markdown",
    yaml: "yaml", yml: "yaml",
  };
  const language = languageMap[file.extension] || "plaintext";
  const content = file.readable
    ? (file.content ?? "")
    : "Aperçu indisponible pour ce type de fichier.";

  code.className = `language-${language}`;
  if (file.readable && window.hljs && window.hljs.getLanguage(language)) {
    code.innerHTML = window.hljs.highlight(content, {
      language,
      ignoreIllegals: true,
    }).value || "Fichier vide";
  } else {
    code.textContent = content || "Fichier vide";
  }
  switchWorkTab("files");
}

function switchWorkTab(tab) {
  document.querySelectorAll("[data-tab]").forEach((item) => {
    item.classList.toggle("on", item.dataset.tab === tab);
  });
  shell.style.display = tab === "preview" ? "block" : "none";
  $("#activityView").style.display = tab === "activity" ? "block" : "none";
  $("#fileView").style.display = tab === "files" ? "block" : "none";
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
  const [{ project }, { messages }, { runs }, { files }, { checkpoints }] = await Promise.all([
    request(`/api/projects/${id}`),
    request(`/api/projects/${id}/messages`),
    request(`/api/projects/${id}/runs`),
    request(`/api/projects/${id}/files`),
    request(`/api/projects/${id}/checkpoints`),
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
  renderFiles(files);
  renderCheckpoints(checkpoints);
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
    await selectProject(selectedId, false);
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
  button.onclick = () => switchWorkTab(button.dataset.tab);
});

$("#showPreview").onclick = () => switchWorkTab("preview");
$("#showFiles").onclick = () => {
  switchWorkTab("files");
  if (currentFiles.length) showFile(currentFiles[0].path);
};

$("#refreshPreview").onclick = refreshPreview;
$("#openPreview").onclick = () => {
  if (!selectedId) return openPanel();
  window.open(previewUrl(selectedId), "_blank", "noopener,noreferrer");
};

request("/api/health")
  .then(({ agent, version }) => {
    $("#health").textContent = `Serveur actif · ${agent} · v${version || "0.6.0"}`;
    $("#modelName").textContent = agent === "claude" ? "＋  Claude Sonnet" : "＋  Agent mock";
  })
  .catch(() => { $("#health").textContent = "Serveur indisponible"; });

loadProjects().catch((error) => {
  console.error(error);
  $("#health").textContent = "Erreur de chargement";
});
