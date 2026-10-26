// Entry point for the Node.js engine inside the Android app (capacitor-nodejs, Node 18).
const path = require('node:path');
const tls = require('node:tls');
const { X509Certificate } = require('node:crypto');
const { Agent, setGlobalDispatcher } = require('undici');

// Defensive: nodejs-mobile is stuck on Node 18 and its bundled CA list. The server sends the host's Spotify token
// over fetch, and neither Spotify nor MusicBrainz uses eMudhra, so outgoing requests don't trust eMudhra roots.
const ca = tls.rootCertificates.filter((pem) => !/eMudhra|emSign/i.test(new X509Certificate(pem).subject));
setGlobalDispatcher(new Agent({ connect: { ca } }));

process.env.PORT = '4173';
process.env.DJ_DATA_FILE = path.join(process.env.DATADIR, 'sessions.json');
process.env.DJ_WEB_DIR = path.join(__dirname, 'web');

import('./server.mjs');
