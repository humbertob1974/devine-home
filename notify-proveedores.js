// notify-proveedores.js
// Runs daily via GitHub Actions - v3 HTML emails
// Uses Cloudflare Worker proxy to send emails via EmailJS v3

const https = require('https');

const FIREBASE_PROJECT = 'devine-home';
const FIREBASE_KEY     = process.env.FIREBASE_API_KEY;
const WORKER_HOST      = 'claude-proxy.humbertoben.workers.dev';

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
        console.log(`  HTTP ${res.statusCode}: ${raw.slice(0,200)}`);
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

function esc(str) { return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function buildTaskCard(t, proj, idx) {
  const photos = (t.photos || []).length > 0
    ? `<div style="margin-top:12px;">${(t.photos||[]).map((u,pi)=>`
      <div style="margin-bottom:12px;">
        <a href="${u}" target="_blank">
          <img src="${u}" alt="Foto ${pi+1}" width="100%"
            style="display:block;width:100%;max-width:480px;border-radius:10px;border:1px solid #E8E6E2;margin-bottom:6px;">
        </a>
        <a href="${u}" target="_blank"
          style="display:inline-block;padding:5px 12px;background:#F5F3EF;border:1px solid #E8E6E2;border-radius:8px;font-size:12px;color:#C17B2A;font-weight:700;text-decoration:none;">
          🔗 Ver Foto ${pi+1} en tamaño completo
        </a>
      </div>`).join('')}</div>`
    : '';
  return `
    <div style="background:#F5F3EF;border-radius:12px;padding:16px;margin-bottom:14px;border-left:4px solid #C17B2A;">
      <div style="font-size:11px;font-weight:700;color:#C17B2A;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Tarea ${idx+1}</div>
      <div style="font-size:17px;font-weight:800;color:#1A1A1E;margin-bottom:8px;">${esc(t.title)}</div>
      ${t.desc ? `<div style="font-size:14px;color:#6B6A66;line-height:1.6;margin-bottom:6px;">${esc(t.desc)}</div>` : ''}
      <table cellpadding="0" cellspacing="0">
        ${t.area ? `<tr><td style="font-size:13px;color:#9A9490;padding-right:8px;">📍</td><td style="font-size:13px;color:#6B6A66;">${esc(t.area)}</td></tr>` : ''}
        ${proj  ? `<tr><td style="font-size:13px;color:#9A9490;padding-right:8px;">🏗️</td><td style="font-size:13px;color:#6B6A66;">${esc(proj.name)}</td></tr>` : ''}
      </table>
      ${photos}
    </div>`;
}

function buildEmailHTML(provName, today, taskCards) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F3EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3EF;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#1A1A1E 0%,#2C2C2A 100%);padding:28px 32px;">
          <div style="font-size:11px;font-weight:700;color:#C17B2A;text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">BENAFUENTE — Recordatorio Diario</div>
          <div style="font-size:22px;font-weight:800;color:#fff;line-height:1.3;">Tareas Pendientes Asignadas</div>
          <div style="font-size:14px;color:#9A9490;margin-top:6px;">${today}</div>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <p style="font-size:15px;color:#6B6A66;line-height:1.7;margin:0 0 20px;">
            Estimado/a <strong style="color:#1A1A1E;">${esc(provName)}</strong>, este es su recordatorio diario de tareas pendientes. Por favor complete estas tareas y notifique al equipo.
          </p>
          ${taskCards}
        </td></tr>
        <tr><td style="background:#F5F3EF;padding:20px 32px;border-top:1px solid #E8E6E2;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:top;">
                <div style="font-size:13px;font-weight:800;color:#1A1A1E;">HUMBERTO BENAVIDES</div>
                <div style="font-size:12px;color:#6B6A66;margin-top:2px;">Owner — BENAFUENTE</div>
                <div style="font-size:12px;color:#6B6A66;">943 CR 652, Devine TX. 78016</div>
              </td>
              <td align="right" style="vertical-align:top;">
                <div style="font-size:11px;color:#9A9490;">Sistema de Notificaciones</div>
                <div style="font-size:11px;color:#C17B2A;font-weight:700;">Administrador de Proyectos</div>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendEmail(toEmail, toName, subject, htmlMessage, projectName) {
  console.log(`  Sending to ${toEmail}...`);
  const res = await request({
    hostname: WORKER_HOST, path: '/', method: 'POST',
    headers: { 'X-Action': 'email' }
  }, {
    to_email: toEmail, to_name: toName, subject,
    message: htmlMessage,
    from_name: 'BENAFUENTE — Administrador de Proyectos',
    project_name: projectName || 'BENAFUENTE'
  });
  return res.status;
}

async function main() {
  console.log('🔔 Iniciando recordatorios diarios v3...');
  console.log('  FIREBASE_KEY present:', !!FIREBASE_KEY);

  const [tasks, proveedores, projects] = await Promise.all([
    firestoreGet('tasks'),
    firestoreGet('proveedores'),
    firestoreGet('projects')
  ]);

  console.log(`  Tasks: ${tasks.length}, Proveedores: ${proveedores.length}`);

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
    const today = new Date().toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const taskCards = pt.map((t, i) => buildTaskCard(t, projects.find(p => p.id === t.projectId), i)).join('');
    const subject = `Recordatorio — ${pt.length} tarea${pt.length>1?'s':''} pendiente${pt.length>1?'s':''}`;
    const html = buildEmailHTML(prov.nombre, today, taskCards);
    const proj = pt[0] ? projects.find(p => p.id === pt[0].projectId) : null;

    try {
      const status = await sendEmail(prov.email, prov.nombre, subject, html, proj?.name);
      if (status === 200) { console.log(`✅ Enviado a ${prov.nombre} (${prov.email})`); sent++; }
      else { console.log(`❌ Fallo — status ${status}`); errors++; }
    } catch(e) { console.error(`❌ Error:`, e.message); errors++; }

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n📊 Resumen: ${sent} enviados, ${errors} errores`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
