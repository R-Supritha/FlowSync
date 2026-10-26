const ngrok = require('@ngrok/ngrok');
require('dotenv').config();

const WEBHOOK_PATH = '/api/github/webhook';
const API_PREFIX = '/api/';

function list(name) {
  return (process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildTrafficPolicy() {
  const rules = [];
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (secret) {
    rules.push({
      name: 'Verify GitHub webhook signature',
      expressions: [`req.url.path == '${WEBHOOK_PATH}'`],
      actions: [
        {
          type: 'verify-webhook',
          config: { provider: 'github', secret },
        },
      ],
    });
  } else {
    console.warn('GITHUB_WEBHOOK_SECRET is missing; ngrok will not verify webhook signatures.');
  }

  const basicUser = process.env.NGROK_BASIC_USER;
  const basicPassword = process.env.NGROK_BASIC_PASSWORD;
  if (basicUser && basicPassword) {
    rules.push({
      name: 'Basic Auth for non-webhook API routes',
      expressions: [
        `req.url.path.startsWith('${API_PREFIX}')`,
        `req.url.path != '${WEBHOOK_PATH}'`,
      ],
      actions: [
        {
          type: 'basic-auth',
          config: {
            realm: 'FlowSync API',
            credentials: [`${basicUser}:${basicPassword}`],
            enforce: true,
          },
        },
      ],
    });
  } else {
    console.warn('NGROK_BASIC_USER/NGROK_BASIC_PASSWORD are missing; non-webhook API routes are not protected by Basic Auth.');
  }

  const oauthProvider = process.env.NGROK_OAUTH_PROVIDER;
  if (oauthProvider) {
    rules.push({
      name: 'OAuth for browser/app routes',
      expressions: [`!req.url.path.startsWith('${API_PREFIX}')`],
      actions: [
        {
          type: 'oauth',
          config: {
            provider: oauthProvider,
            ...(process.env.NGROK_OAUTH_CLIENT_ID ? { client_id: process.env.NGROK_OAUTH_CLIENT_ID } : {}),
            ...(process.env.NGROK_OAUTH_CLIENT_SECRET ? { client_secret: process.env.NGROK_OAUTH_CLIENT_SECRET } : {}),
          },
        },
      ],
    });

    const emails = list('NGROK_OAUTH_ALLOW_EMAILS');
    const domains = list('NGROK_OAUTH_ALLOW_DOMAINS');
    const allowed = [
      ...emails.map((email) => `actions.ngrok.oauth.identity.email == '${email}'`),
      ...domains.map((domain) => `actions.ngrok.oauth.identity.email.endsWith('@${domain}')`),
    ];

    if (allowed.length) {
      rules.push({
        name: 'Restrict OAuth users by email or domain',
        expressions: [
          `!req.url.path.startsWith('${API_PREFIX}')`,
          `!(${allowed.join(' || ')})`,
        ],
        actions: [
          {
            type: 'deny',
            config: { status_code: 403 },
          },
        ],
      });
    } else {
      console.warn('NGROK_OAUTH_ALLOW_EMAILS/NGROK_OAUTH_ALLOW_DOMAINS are empty; any authenticated OAuth user can access non-API routes.');
    }
  } else {
    console.warn('NGROK_OAUTH_PROVIDER is missing; browser/app routes are not protected by OAuth.');
  }

  return JSON.stringify({ on_http_request: rules });
}

async function forwardToApp() {
  const addr = process.env.NGROK_ADDR || `localhost:${process.env.PORT || 5000}`;
  const domain = process.env.NGROK_DOMAIN || 'unshaken-tile-crayon.ngrok-free.dev';
  const trafficPolicy = buildTrafficPolicy();
  const pooling = process.env.NGROK_POOLING !== 'false';

  const session = await new ngrok.SessionBuilder().authtokenFromEnv().connect();
  const builder = session.httpEndpoint().domain(domain).trafficPolicy(trafficPolicy);
  if (pooling) builder.poolingEnabled(true);
  const forwardAddr = /^[a-z][a-z0-9+.-]*:\/\//i.test(addr) ? addr : `http://${addr}`;
  const forwarder = await builder.listenAndForward(forwardAddr);

  const url = forwarder.url();
  console.log(`Available at: ${url}`);
  console.log(`GitHub webhook payload URL: ${url}${WEBHOOK_PATH}`);
  console.log('Content type: application/json');
  console.log(`Webhook secret: ${process.env.GITHUB_WEBHOOK_SECRET ? 'configured in server/.env' : 'missing GITHUB_WEBHOOK_SECRET'}`);
  console.log(`Webhook signature verification: ${process.env.GITHUB_WEBHOOK_SECRET ? 'ngrok + app' : 'app only'}`);
  console.log(`Non-webhook API protection: ${process.env.NGROK_BASIC_USER ? 'Basic Auth' : 'none'}`);
  console.log(`Browser/app protection: ${process.env.NGROK_OAUTH_PROVIDER ? `OAuth (${process.env.NGROK_OAUTH_PROVIDER})` : 'none'}`);
  console.log(`Endpoint pooling: ${pooling ? 'enabled' : 'disabled'}`);

  const shutdown = async () => {
    await forwarder.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await new Promise(() => {
    setInterval(() => {}, 1 << 30);
  });
}

forwardToApp().catch((error) => {
  console.error('ngrok failed:', error.message);
  process.exit(1);
});
