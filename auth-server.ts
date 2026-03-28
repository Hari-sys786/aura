import http from 'http';
import { URL } from 'url';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const PORT = 9876;
const REDIRECT_URI = `http://165.232.188.213:${PORT}/callback`;
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&access_type=offline` +
      `&prompt=consent`;

    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400);
      res.end('No code received');
      return;
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const data = await tokenRes.json() as Record<string, unknown>;

    if (data.refresh_token) {
      console.log('\n✅ REFRESH TOKEN:', data.refresh_token);
      console.log('\nAdd to .env: GOOGLE_REFRESH_TOKEN=' + data.refresh_token);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html><body style="font-family:sans-serif;text-align:center;padding:50px;background:#F5F0E8">
          <h1 style="color:#6B2A1A">✅ Aura Connected!</h1>
          <p>Google account linked successfully.</p>
          <p style="color:#888">You can close this page.</p>
        </body></html>
      `);

      // Shut down after 3 seconds
      setTimeout(() => { server.close(); process.exit(0); }, 3000);
    } else {
      console.error('Token exchange failed:', data);
      res.writeHead(500);
      res.end('Token exchange failed: ' + JSON.stringify(data));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🔱 Aura OAuth Server`);
  console.log(`Open: http://165.232.188.213:${PORT}/`);
  console.log(`Waiting for Google callback...\n`);
});
