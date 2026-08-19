export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Action',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const corsHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    };

    try {
      const action = request.headers.get('X-Action') || 'claude';

      // ── CLAUDE (receipt scanning) ──
      if (action === 'claude') {
        const body = await request.json();
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': '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',
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(body)
        });
        const data = await response.json();
        return new Response(JSON.stringify(data), { status: response.status, headers: corsHeaders });
      }

      // ── EMAILJS (send email) ──
      if (action === 'email') {
        const body = await request.json();
        const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'origin': 'https://humbertob1974.github.io'
          },
          body: JSON.stringify({
            service_id: 'casa-devine',
            template_id: 'template_443j3n8',
            user_id: 'rMb8s_6awE5PRaCXt',
            accessToken: 'UaUbS0DiV3Wm8pCPJ3Vja',
            template_params: body
          })
        });
        const text = await response.text();
        return new Response(JSON.stringify({ status: response.status, body: text }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
