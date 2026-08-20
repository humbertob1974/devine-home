// notify-proveedores.js
// Runs daily via GitHub Actions
// Uses Cloudflare Worker proxy to send emails via EmailJS

const https = require('https');

const FIREBASE_PROJECT  = 'devine-home';
const FIREBASE_KEY      = process.env.FIREBASE_API_KEY;
const WORKER_URL        = 'claude-proxy.humbertoben.workers.dev';

function request(options, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(options.headers || {})
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        console.log(`  HTTP ${res.statusCode}: ${raw.slice(0, 300)}`);
        resolve({ status: res.statusCode, body: raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function firestoreGet(col) {
  const path = `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${col}?pageSize=300&key=${FIREBASE_KEY}`;
  const res = await request({ hostname: 'firestore.googleapis.com', path, method: 'GET' });
  const data = JSON.parse(res.body);
  return (data.documents || []).map(doc => {
    const id = doc.name.split('/').pop();
    const out = { id };
    for (const [k, v] of Object.entries(doc.fields || {})) {
      if ('stringValue'  in v) out[k] = v.stringValue;
      else if ('booleanValue' in v) out[k] = v.booleanValue;
      else if ('integerValue' in v) out[k] = parseInt(v.integerValue);
      else if ('nullValue'    in v) out[k] = null;
      else if ('arrayValue'   in v) out[k] = (v.arrayValue.values || []).map(i => i.stringValue || '');
    }
    return out;
  });
}

async function sendEmail(toEmail, toName, subject, message, projectName) {
  console.log(`  Sending to ${toEmail}...`);
  const res = await request({
    hostname: WORKER_URL,
    path: '/',
    method: 'POST',
    headers: { 'X-Action': 'email' }
  }, {
    to_email: toEmail,
    to_name: toName,
    subject,
    message,
    from_name: 'Administrador de Proyectos',
    project_name: projectName || 'Recordatorio diario'
  });
  return res.status;
}

async function main() {
  console.log('🔔 Iniciando recordatorios diarios...');
  console.log('  FIREBASE_KEY present:', !!FIREBASE_KEY);

  const [tasks, proveedores, projects] = await Promise.all([
    firestoreGet('tasks'),
    firestoreGet('proveedores'),
    firestoreGet('projects')
  ]);

  console.log(`  Tasks: ${tasks.length}, Proveedores: ${proveedores.length}, Projects: ${projects.length}`);

  const pending = tasks.filter(t => !t.done && t.proveedorId);
  console.log(`📋 Tareas pendientes con proveedor: ${pending.length}`);

  const byProv = {};
  for (const t of pending) {
    const prov = proveedores.find(p => p.id === t.proveedorId);
    if (!prov?.email) { console.log(`  Sin email: ${t.proveedorNombre}`); continue; }
    if (!byProv[prov.id]) byProv[prov.id] = { prov, tasks: [] };
    byProv[prov.id].tasks.push(t);
  }

  let sent = 0, errors = 0;

  for (const { prov, tasks: pt } of Object.values(byProv)) {
    const today = new Date().toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    const lines = pt.map((t, i) => {
      const proj = projects.find(p => p.id === t.projectId);
      const photos = (t.photos || []).length > 0
        ? '\nFotos: ' + (t.photos || []).map((u, pi) => `Foto ${pi+1}: ${u}`).join(' | ')
        : '';
      return `${i+1}. ${t.title}` +
        `${t.area   ? '\nArea: '     + t.area    : ''}` +
        `${t.desc   ? '\n'           + t.desc    : ''}` +
        `${proj     ? '\nProyecto: ' + proj.name : ''}` +
        photos;
    }).join('\n\n');

    const subject = `Recordatorio — ${pt.length} tarea${pt.length > 1 ? 's' : ''} pendiente${pt.length > 1 ? 's' : ''}`;
    const message =
      `Estimado/a ${prov.nombre},\n\n` +
      `Recordatorio de tareas pendientes al ${today}:\n\n` +
      `${'─'.repeat(40)}\n\n` +
      lines + '\n\n' +
      `${'─'.repeat(40)}\n` +
      `Por favor complete estas tareas y notifique al equipo.\n\n` +
      `HUMBERTO BENAVIDES (Owner)\n` +
      `Sistema de Notificaciones BENAFUENTE\n` +
      `943 CR 652, Devine TX. 78016`;

    const proj = pt[0] ? projects.find(p => p.id === pt[0].projectId) : null;

    try {
      const status = await sendEmail(prov.email, prov.nombre, subject, message, proj?.name);
      if (status === 200) {
        console.log(`✅ Enviado a ${prov.nombre} (${prov.email})`);
        sent++;
      } else {
        console.log(`❌ Fallo para ${prov.email} — status ${status}`);
        errors++;
      }
    } catch(e) {
      console.error(`❌ Error:`, e.message);
      errors++;
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n📊 Resumen: ${sent} enviados, ${errors} errores`);
  if (Object.keys(byProv).length === 0) {
    console.log('ℹ️  No hay tareas pendientes con proveedores que tengan email.');
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
