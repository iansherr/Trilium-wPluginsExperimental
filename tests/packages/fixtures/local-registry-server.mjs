import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectsRoot = process.env.TRILIUM_PACKAGE_PROJECTS_DIR || path.resolve(projectRoot, "packages");
const host = process.env.TRILIUM_REGISTRY_HOST || "127.0.0.1";
const port = Number(process.env.TRILIUM_REGISTRY_PORT || 39125);
const packageDirectories = {
    wordcount: "trilium_wordcounter_plugin",
    languagetool: "trilium_languagetool_plugin",
    webserver: "trilium_webserver_plugin",
    "gmail-ingest": "trilium_mail",
    ikmal_tools_trilium: "ikmal_tools_trilium"
};

function loadRegistry() {
    const registry = JSON.parse(fs.readFileSync(path.join(projectRoot, "registry.json"), "utf8"));
    for (const manifest of registry.packages) {
        const packageName = manifest.id.split("/")[1];
        manifest.repository = `http://${host}:${port}/packages/${packageName}`;
    }
    return registry;
}

function sendJson(response, status, value) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*"
    });
    response.end(JSON.stringify(value));
}

function sendText(response, status, value) {
    response.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*"
    });
    response.end(value);
}

const server = http.createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "*");
    if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
    }

    const requestPath = new URL(request.url || "/", `http://${host}`).pathname;
    if (requestPath === "/health") {
        sendJson(response, 200, { status: "ok" });
        return;
    }
    if (requestPath === "/registry.json") {
        sendJson(response, 200, loadRegistry());
        return;
    }

    const match = requestPath.match(/^\/packages\/([^/]+)\/(.+)$/);
    const directoryName = match && packageDirectories[match[1]];
    if (!match || !directoryName) {
        sendText(response, 404, "Not found");
        return;
    }

    const packageRoot = path.resolve(projectsRoot, directoryName);
    const filename = path.resolve(packageRoot, match[2]);
    if (!filename.startsWith(`${packageRoot}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        sendText(response, 404, "Not found");
        return;
    }

    const extension = path.extname(filename);
    const contentType = extension === ".json"
        ? "application/json; charset=utf-8"
        : extension === ".jsx"
            ? "text/jsx; charset=utf-8"
            : "application/javascript; charset=utf-8";
    response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
    });
    fs.createReadStream(filename).pipe(response);
});

server.listen(port, host, () => {
    console.log(`Local Trilium package registry: http://${host}:${port}/registry.json`);
    console.log("Serving five local package projects; press Ctrl-C to stop it.");
});
