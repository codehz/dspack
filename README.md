# Dead simple deno to browser platform packager

(basically a esbuild wrapper)

install:

```bash
deno install -A --unstable -n dspack https://deno.land/x/dspack/mod.ts
```

usage:

```bash
dspack index.ts # package index.ts to dist/index.js
dspack index.ts -o web --watch # package index.ts to web/index.js and watch for changes
dspack index.ts --serve 127.0.0.1:2345 # start a web server
dspack index.ts --serve 127.0.0.1:2345 --cert cert.pem --key key.pem # start a web server with tls support
```
