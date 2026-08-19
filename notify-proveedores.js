// notify-proveedores.js
// Runs daily via GitHub Actions
// Sends email reminders for pending tasks assigned to providers with email

const https = require('https');

// ── CONFIG ──
const FIREBASE_PROJECT = 'devine-home';
const EMAILJS_SERVICE  = 'casa-devine';
const EMAILJS_TEMPLATE = 'template_443j3n8';
const EMAILJS_PUBLIC   = 'rMb8s_6awE5PRaCXt';
const EMAILJS_PRIVATE  = process.env.EMAILJS_PRIVATE_KEY; // set in GitHub Secrets
const FIREBASE_KEY     = process.env.FIREBASE_API_KEY;    // set in GitHub Secrets

// ── HELPERS ──
function httpsPost(hostname, path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(hostname, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── FIRESTORE REST API ──
async function firestoreGet(collection) {
  const path = `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${collection}?key=${FIREBASE_KEY}`;
  const data = await httpsGet('firestore.googleapis.com', path);
  return (data.documents || []).map(doc => {
    const id = doc.name.split('/').pop();
    const fields = doc.fields || {};
    const parsed = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v.stringValue !== undefined) parsed[k] = v.stringValue;
      else if (v.booleanValue !== undefined) parsed[k] = v.booleanValue;
      else if (v.integerValue !== undefined) parsed[k] = parseInt(v.integerValue);
      else if (v.doubleValue !== undefined) parsed[k] = v.doubleValue;
      else if (v.arrayValue) parsed[k] = (v.arrayValue.values || []).map(i => i.stringValue || '');
      else if (v.nullValue !== undefined) parsed[k] = null;
    }
    return { id, ...parsed };
  });
}

// ── EMAILJS ──
async function sendEmail(toEmail, toName, subject, message) {
  const result = await httpsPost('api.emailjs.com', '/api/v1.0/email/send', {
    service_id: EMAILJS_SERVICE,
    template_id: EMAILJS_TEMPLATE,
    user_id: EMAILJS_PUBLIC,
    accessToken: EMAILJS_PRIVATE,
    template_params: {
      to_email: toEmail,
      to_name: toName,
      subject,
      message,
      from_name: 'Administrador de Proyectos',
      project_name: 'Recordatorio diario'
    }
  });
  return result;
}

// ── MAIN ──
async function main() {
  console.log('🔔 Iniciando recordatorios diarios...');

  // Fetch tasks, providers and projects
  const [tasks, proveedores, projects] = await Promise.all([
    firestoreGet('tasks'),
    firestoreGet('proveedores'),
    firestoreGet('projects')
  ]);

  // Filter: pending tasks with assigned provider
  const pendingWithProv = tasks.filter(t =>
    !t.done && t.proveedorId && t.proveedorNombre
  );

  console.log(`📋 Tareas pendientes con proveedor: ${pendingWithProv.length}`);

  // Group by provider
  const byProv = {};
  for (const t of pendingWithProv) {
    const prov = proveedores.find(p => p.id === t.proveedorId);
    if (!prov || !prov.email) continue; // skip if no email
    if (!byProv[prov.id]) byProv[prov.id] = { prov, tasks: [] };
    byProv[prov.id].tasks.push(t);
  }

  let sent = 0, skipped = 0;

  for (const { prov, tasks: provTasks } of Object.values(byProv)) {
    const today = new Date().toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    const taskLines = provTasks.map((t, i) => {
      const proj = projects.find(p => p.id === t.projectId);
      const photos = (t.photos || []).length > 0
        ? '\n   📷 Fotos: ' + (t.photos || []).map((u, pi) => `Foto ${pi+1}: ${u}`).join(' | ')
        : '';
      return `${i+1}. 📋 ${t.title}` +
        `${t.area ? '\n   📍 Área: ' + t.area : ''}` +
        `${t.desc ? '\n   📝 ' + t.desc : ''}` +
        `${proj ? '\n   🏗️ Proyecto: ' + proj.name : ''}` +
        photos;
    }).join('\n\n');

    const subject = `Recordatorio — Tienes ${provTasks.length} tarea${provTasks.length > 1 ? 's' : ''} pendiente${provTasks.length > 1 ? 's' : ''}`;

    const message =
      `Estimado/a ${prov.nombre},\n\n` +
      `Este es un recordatorio automático de sus tareas pendientes al día de hoy, ${today}.\n\n` +
      `${'─'.repeat(40)}\n\n` +
      taskLines + '\n\n' +
      `${'─'.repeat(40)}\n` +
      `Por favor complete estas tareas y notifique al equipo.\n\n` +
      `Administrador de Proyectos`;

    try {
      await sendEmail(prov.email, prov.nombre, subject, message);
      console.log(`✅ Email enviado a ${prov.nombre} (${prov.email}) — ${provTasks.length} tarea(s)`);
      sent++;
    } catch (e) {
      console.error(`❌ Error enviando a ${prov.email}:`, e);
      skipped++;
    }

    // Small delay between emails
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n📊 Resumen: ${sent} emails enviados, ${skipped} errores`);
  if (Object.keys(byProv).length === 0) {
    console.log('ℹ️  No hay tareas pendientes con proveedores que tengan email.');
  }
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
