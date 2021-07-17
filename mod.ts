import {
  Command,
  EnumType,
  TypeValue,
  ValidationError,
} from "https://deno.land/x/cliffy@v0.19.2/command/mod.ts";
import {
  bold,
  green,
  italic,
  red,
  underline,
} from "https://deno.land/std@0.101.0/fmt/colors.ts";
import { denoPlugin, esbuild } from "./deps.ts";

const SourceMapOptions = new EnumType(["inline", "external", "both"]);

await new Command()
  .type("sourcemap", SourceMapOptions)
  .name("dspack")
  .version("0.0.0")
  .description("Dead simple deno to browser packager")
  .option("--import-map <importMap:string>", "import map file")
  .option("--tsconfig <tsconfig:string>", "tsconfig file")
  .option("-o, --out <out:string>", "output dir", {
    default: "./dist/",
  })
  .option("-t, --target <out:string>", "compile target", {
    collect: true,
  })
  .option("-D, --define <key_value:string>", "define global identifier", {
    collect: true,
    value(input: string, previous = {}) {
      const [key, value] = input.split("=");
      if (value == null) {
        return { ...previous, [input]: true };
      } else {
        return { ...previous, [key]: value };
      }
    },
  })
  .option("--sourcemap <option:sourcemap>", "generate sourcemap style")
  .option("--source-root <path:string>", "source root for sourcemap", {
    depends: ["sourcemap"],
  })
  .option("--no-minify", "don't minify")
  .option("--no-module", "don't generate es6 module")
  .option("--tree-shaking", "do tree shaking")
  .option("--watch", "watch mode")
  .option("--serve <host>", "run built-in http server", {
    collect: true,
    value(input: string, previous = []) {
      const pos = input.lastIndexOf(":");
      if (pos == -1) throw new ValidationError("no port provided");
      const hostname = input.substring(0, pos);
      const port = parseInt(input.substring(pos + 1), 10);
      if (Number.isNaN(port)) throw new ValidationError("invalid port");
      return [...previous, { hostname, port }];
    },
  })
  .option("--serve-dir <folder:string>", "root directory of built-in server", {
    depends: ["serve"],
  })
  .option("--tls.cert, --cert <cert:string>", "TLS certificate", {
    depends: ["serve"],
  })
  .option("--tls.key, --key <key:string>", "TLS certificate private key", {
    depends: ["serve"],
  })
  .option("-i, --index <index:string>", "index path", { depends: ["serve"] })
  .option("--spa", "single page application mode", {
    depends: ["serve", "index"],
  })
  .arguments("<entry...:string>")
  .action(main)
  .parse(Deno.args);

async function main(options: {
  importMap?: string;
  tsconfig?: string;
  sourcemap?: TypeValue<typeof SourceMapOptions>;
  sourceRoot?: string;
  minify: boolean;
  treeShaking?: true;
  serve?: Array<{ hostname: string; port: number }>;
  serveDir?: string;
  index?: string;
  tls?: { cert?: string; key?: string };
  out: string;
  module: boolean;
  target?: string[];
  define?: Record<string, string>;
  watch?: true;
  spa?: true;
}, entrys: string[]) {
  try {
    const buildOptions: esbuild.BuildOptions = {
      bundle: true,
      plugins: [denoPlugin({ importMapFile: options.importMap })],
      entryPoints: entrys,
      sourcemap: options.sourcemap,
      sourceRoot: options.sourceRoot,
      watch: options.watch,
      define: options.define,
      format: options.module ? "esm" : "iife",
      outdir: options.out,
      minify: options.minify,
      tsconfig: options.tsconfig,
      treeShaking: options.treeShaking,
    };
    if (options.serve) {
      const res = await esbuild.serve({
        host: "127.254.254.254",
        servedir: options.serveDir ?? options.out,
        onRequest(req) {
          const status = req.status < 400 ? green : red;
          console.log(
            status(req.status + ""),
            bold(`[${req.method}]`),
            underline(req.path),
            italic(req.timeInMS + "ms"),
            underline(req.remoteAddress),
          );
        },
      }, buildOptions);
      try {
        const listen = options.tls
          ? ((certFile: string, keyFile: string) =>
            ({ hostname, port }: { hostname: string; port: number }) =>
              Deno.listenTls({ certFile, keyFile, hostname, port }))(
              options.tls.cert!,
              options.tls.key!,
            )
          : ({ hostname, port }: { hostname: string; port: number }) =>
            Deno.listen({ hostname, port });
        const listeners = await Promise.all(options.serve.map(listen));
        const lis = Promise.all(listeners.map(async (listener) => {
          for await (const conn of listener) {
            pipeTo(
              conn,
              { index: options.index, spa: options.spa ?? false },
              res.host,
              res.port,
            );
          }
        }));
        console.log(
          "http server started:",
          options.serve
            .map(({ hostname, port }) =>
              underline(
                `${options.tls ? "https" : "http"}://${hostname}:${port}/`,
              )
            )
            .join(", "),
        );
        await Promise.race([res.wait, lis]);
      } finally {
        res.stop();
      }
    } else {
      await esbuild.build(buildOptions);
    }
  } finally {
    esbuild.stop();
  }
}

async function pipeTo(
  conn: Deno.Conn,
  { index, spa }: { index?: string; spa: boolean },
  host: string,
  port: number,
) {
  const http = Deno.serveHttp(conn);
  let req: Deno.RequestEvent | null = null;
  while (req = await http.nextRequest(), req != null) {
    const url = new URL(req.request.url);
    url.protocol = "http:";
    url.host = host;
    url.port = port + "";
    if (index) {
      if (spa && !/\.[^/]+$/.test(url.pathname)) {
        url.pathname = `/${index}`;
      } else {
        if (url.pathname.endsWith("/")) url.pathname += index;
      }
    }
    await req.respondWith(fetch(url));
  }
}
