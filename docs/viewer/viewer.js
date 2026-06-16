import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

const SITE_ROOT = new URL("../", import.meta.url);

let manifest = null;
let meshData = null;
let scene, camera, renderer, controls;
let cadGroup = null;
let sphereGroup = null;
let currentStep = 0; // 0 = CAD only, 1..N = methods

const els = {
  meshSelect: document.getElementById("mesh-select"),
  countSelect: document.getElementById("count-select"),
  methodSteps: document.getElementById("method-steps"),
  infoPanel: document.getElementById("info-panel"),
  hud: document.getElementById("hud"),
  loading: document.getElementById("loading"),
  title: document.getElementById("title"),
};

async function fetchJson(url) {
  const base = typeof url === "string" ? url : url.href;
  const target = `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const res = await fetch(target, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${target}`);
  return res.json();
}

function setLoading(on) {
  els.loading.classList.toggle("hidden", !on);
}

function clearGroup(group) {
  if (!group) return;
  while (group.children.length) {
    const child = group.children.pop();
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
    else child.material?.dispose();
  }
}

function fitCamera(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.01);
  const dist = maxDim * 2.2;

  camera.position.set(center.x + dist, center.y + dist * 0.6, center.z + dist);
  controls.target.copy(center);
  camera.near = maxDim / 100;
  camera.far = maxDim * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

async function loadCadMesh(stlRelPath) {
  clearGroup(cadGroup);
  const loader = new STLLoader();
  const url = new URL(stlRelPath, SITE_ROOT);
  const geometry = await loader.loadAsync(url.href);
  geometry.computeVertexNormals();

  const solid = new THREE.Mesh(
    geometry,
    new THREE.MeshPhysicalMaterial({
      color: manifest.colors.cad,
      metalness: 0.1,
      roughness: 0.55,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const wire = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: "#08519C",
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    }),
  );
  cadGroup.add(solid);
  cadGroup.add(wire);
  fitCamera(cadGroup);
}

function renderSpheres(method) {
  clearGroup(sphereGroup);
  if (!method || !meshData) return;

  const n = els.countSelect.value;
  const variant = meshData.variants?.[method]?.[n];
  if (!variant) return;

  const color = manifest.colors[method] || "#ffaa00";
  const material = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.05,
    roughness: 0.4,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });

  for (let i = 0; i < variant.radii.length; i += 1) {
    const r = variant.radii[i];
    const c = variant.centers[i];
    const geo = new THREE.SphereGeometry(r, 24, 18);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(c[0], c[1], c[2]);
    sphereGroup.add(mesh);
  }

  fitCamera(cadGroup);
}

function updateInfoPanel() {
  const method = currentStep === 0 ? null : manifest.methods[currentStep - 1];
  const n = els.countSelect.value;
  const lines = [
    `<strong>Object:</strong> ${meshData.name}`,
    `<strong>View:</strong> ${currentStep === 0 ? "CAD only" : manifest.method_labels[method] || method}`,
    `<strong>Spheres requested:</strong> n=${n}`,
  ];

  if (method) {
    const v = meshData.variants?.[method]?.[n];
    if (v) {
      lines.push(`<strong>Actual spheres:</strong> ${v.n_spheres ?? v.radii?.length ?? "?"}`);
      if (v.coverage_pct != null) lines.push(`<strong>Coverage:</strong> ${v.coverage_pct.toFixed(1)}%`);
      if (v.outside_volume_pct != null) {
        lines.push(`<strong>Extra volume:</strong> ${v.outside_volume_pct.toFixed(1)}%`);
      }
    } else {
      const available = Object.keys(meshData.variants?.[method] || {});
      lines.push(`<em>No data for n=${n}</em>`);
      if (available.length) {
        lines.push(`<em>Available for this method: n=${available.join(", ")}</em>`);
      } else {
        lines.push(`<em>No sphere data loaded for ${method} — rebuild viewer after benchmark</em>`);
      }
    }
    const best = meshData.best?.[method];
    if (best) {
      lines.push(`<span style="color:var(--muted)">Best n for this method: ${best.n} `
        + `(${best.coverage_pct?.toFixed?.(1) ?? best.coverage_pct}% cov, `
        + `${best.outside_volume_pct?.toFixed?.(1) ?? best.outside_volume_pct}% extra)</span>`);
    }
  }

  els.infoPanel.innerHTML = lines.join("<br>");
  els.hud.textContent = currentStep === 0
    ? `${meshData.name} — CAD`
    : `${meshData.name} — ${manifest.method_labels[method] || method} (n=${n})`;
}

function buildStepButtons() {
  els.methodSteps.innerHTML = "";

  const cadBtn = document.createElement("button");
  cadBtn.className = "step-btn";
  cadBtn.dataset.step = "0";
  cadBtn.innerHTML = "1. CAD mesh<small class='metric'>Original geometry</small>";
  cadBtn.addEventListener("click", () => setStep(0));
  els.methodSteps.appendChild(cadBtn);

  manifest.methods.forEach((method, idx) => {
    const btn = document.createElement("button");
    btn.className = "step-btn";
    btn.dataset.step = String(idx + 1);
    const best = meshData.best?.[method];
    const n = els.countSelect.value;
    const hasData = Boolean(meshData.variants?.[method]?.[n]);
    const bestNote = best
      ? `Best: n=${best.n}, ${best.outside_volume_pct?.toFixed?.(1)}% extra`
      : "";
    const status = hasData ? bestNote : "<em>no data at this n</em>";
    btn.innerHTML = `${idx + 2}. ${manifest.method_labels[method] || method}`
      + `<span class="metric">${status}</span>`;
    btn.addEventListener("click", () => setStep(idx + 1));
    if (!hasData) btn.classList.add("disabled");
    els.methodSteps.appendChild(btn);
  });
}

function highlightStepButtons() {
  els.methodSteps.querySelectorAll(".step-btn").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.step) === currentStep);
  });
}

function setStep(step) {
  currentStep = step;
  highlightStepButtons();
  const method = step === 0 ? null : manifest.methods[step - 1];
  renderSpheres(method);
  updateInfoPanel();
}

async function loadMeshData(name) {
  const entry = manifest.meshes.find((m) => m.name === name);
  if (!entry) return;
  setLoading(true);
  meshData = await fetchJson(new URL(entry.file, import.meta.url));
  await loadCadMesh(meshData.mesh_stl);
  buildStepButtons();
  // Default to first method with data at the selected sphere count (usually foam).
  const n = els.countSelect.value;
  let startStep = 0;
  for (let i = 0; i < manifest.methods.length; i += 1) {
    if (meshData.variants?.[manifest.methods[i]]?.[n]) {
      startStep = i + 1;
      break;
    }
  }
  setStep(startStep);
  setLoading(false);
}

function initScene() {
  const wrap = document.getElementById("canvas-wrap");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080b10);

  camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.0001, 100);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  wrap.appendChild(renderer.domElement);
  renderer.domElement.id = "canvas";

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const light1 = new THREE.DirectionalLight(0xffffff, 1.1);
  light1.position.set(2, 3, 4);
  scene.add(light1);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));

  const grid = new THREE.GridHelper(1, 20, 0x2a3545, 0x1a2230);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);

  cadGroup = new THREE.Group();
  sphereGroup = new THREE.Group();
  scene.add(cadGroup);
  scene.add(sphereGroup);

  window.addEventListener("resize", () => {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();
}

async function main() {
  initScene();
  setLoading(true);
  manifest = await fetchJson(new URL("manifest.json", import.meta.url));
  els.title.textContent = manifest.title || "Sphere coverage viewer";
  const subtitle = document.querySelector(".subtitle");
  if (subtitle && manifest.built_at) {
    subtitle.textContent = `Built ${manifest.built_at} — CAD mesh + sphere overlays`;
  }

  manifest.meshes.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = m.name;
    els.meshSelect.appendChild(opt);
  });

  manifest.sphere_counts.forEach((n) => {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `n = ${n}`;
    els.countSelect.appendChild(opt);
  });

  els.meshSelect.addEventListener("change", () => {
    currentStep = 0;
    loadMeshData(els.meshSelect.value);
  });
  els.countSelect.addEventListener("change", () => {
    buildStepButtons();
    if (currentStep > 0) {
      const method = manifest.methods[currentStep - 1];
      if (!meshData.variants?.[method]?.[els.countSelect.value]) {
        for (let i = 0; i < manifest.methods.length; i += 1) {
          if (meshData.variants?.[manifest.methods[i]]?.[els.countSelect.value]) {
            setStep(i + 1);
            return;
          }
        }
        setStep(0);
        return;
      }
    }
    setStep(currentStep);
  });

  document.addEventListener("keydown", (e) => {
    const max = manifest.methods.length;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      setStep(Math.min(currentStep + 1, max));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      setStep(Math.max(currentStep - 1, 0));
    }
  });

  if (manifest.meshes.length) {
    await loadMeshData(manifest.meshes[0].name);
  }
  setLoading(false);
}

main().catch((err) => {
  console.error(err);
  els.loading.textContent = `Error: ${err.message}`;
});
