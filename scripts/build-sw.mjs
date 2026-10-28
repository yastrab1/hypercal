import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const assets = readdirSync("dist/assets")
  .filter((x) => /\.(js|css)$/.test(x))
  .map((x) => "/assets/" + x);
const version = createHash("sha256")
  .update(assets.join("|") + readFileSync("dist/index.html"))
  .digest("hex")
  .slice(0, 12);
const files = ["/", "/favicon.svg", ...assets];
writeFileSync(
  "dist/sw.js",
  `const NAME='hypercal-shell-${version}';const FILES=${JSON.stringify(files)};
self.addEventListener('install',event=>{event.waitUntil(caches.open(NAME).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('hypercal-shell-')).slice(0,-2).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/')||url.pathname.startsWith('/downloads/'))return;
if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).then(response=>response.ok?response:Promise.reject()).catch(()=>caches.open(NAME).then(cache=>cache.match('/')).then(response=>response||Response.error())));return;}
if(url.pathname.startsWith('/assets/')||url.pathname==='/favicon.svg')event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));});
`,
);
console.log(
  `Offline shell ${version}: ${files.length} assets; API responses are never service-worker cached.`,
);
