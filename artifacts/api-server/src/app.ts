import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { parse as parseYaml } from "yaml";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findSpecPath(): string | null {
  const candidates = [
    resolve(__dirname, "openapi.yaml"),
    resolve(__dirname, "../../../lib/api-spec/openapi.yaml"),
    resolve(process.cwd(), "lib/api-spec/openapi.yaml"),
    resolve(process.cwd(), "openapi.yaml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadSpec(): Record<string, unknown> {
  const p = findSpecPath();
  if (!p) {
    logger.warn("Could not locate openapi.yaml — /api/docs will be unavailable");
    return {};
  }
  try {
    return parseYaml(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch (err) {
    logger.warn({ err, p }, "Failed to parse openapi.yaml");
    return {};
  }
}

const openApiSpec = loadSpec();

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.get("/api/openapi.yaml", (_req: Request, res: Response) => {
  const p = findSpecPath();
  if (!p) {
    res.status(404).json({ error: "spec_not_found" });
    return;
  }
  res.setHeader("Content-Type", "text/yaml; charset=utf-8");
  res.send(readFileSync(p, "utf8"));
});

app.use("/api", router);

export default app;
