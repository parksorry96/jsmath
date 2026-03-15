import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as ejs from "ejs";
import { latexTemplateHelpers } from "./latex-template.helpers";

const execFileAsync = promisify(execFile);

const XELATEX_PATHS = [
  "/Library/TeX/texbin/xelatex",
  "/usr/local/texlive/2026/bin/universal-darwin/xelatex",
  "/usr/local/bin/xelatex",
  "xelatex",
];

export interface CompileOptions {
  templateName: string;
  data: Record<string, unknown>;
}

@Injectable()
export class LatexCompilerService {
  private readonly logger = new Logger(LatexCompilerService.name);
  private readonly templateDir = path.join(__dirname, "templates");
  private xelatexPath: string;

  constructor(private config: ConfigService) {
    this.xelatexPath = this.config.get("XELATEX_PATH", "");
  }

  async onModuleInit() {
    if (this.xelatexPath) return;

    for (const p of XELATEX_PATHS) {
      try {
        await fs.access(p);
        this.xelatexPath = p;
        this.logger.log(`Found xelatex at ${p}`);
        return;
      } catch {}
    }
    this.xelatexPath = "xelatex";
    this.logger.warn("xelatex not found at known paths, falling back to PATH lookup");
  }

  async compile(options: CompileOptions): Promise<Buffer> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jsmath-latex-"));
    const texPath = path.join(tmpDir, "document.tex");
    const pdfPath = path.join(tmpDir, "document.pdf");

    try {
      const templatePath = path.join(
        this.templateDir,
        `${options.templateName}.tex.ejs`,
      );
      const templateStr = await fs.readFile(templatePath, "utf-8");
      const texSource = ejs.render(templateStr, {
        ...options.data,
        helpers: latexTemplateHelpers,
      });

      await fs.writeFile(texPath, texSource, "utf-8");

      // Run xelatex twice for cross-references
      for (let i = 0; i < 2; i++) {
        await execFileAsync(
          this.xelatexPath,
          [
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-no-shell-escape",
            `-output-directory=${tmpDir}`,
            texPath,
          ],
          {
            cwd: tmpDir,
            timeout: 60_000,
            env: {
              ...process.env,
              TEXMFOUTPUT: tmpDir,
              openin_any: "p",
              openout_any: "p",
            },
          },
        );
      }

      return await fs.readFile(pdfPath);
    } catch (error) {
      this.logger.error(`LaTeX compilation failed: ${error}`);
      let logTail = "";
      try {
        const logPath = path.join(tmpDir, "document.log");
        const log = await fs.readFile(logPath, "utf-8");
        // Extract actual error lines (start with !) and surrounding context
        const lines = log.split("\n");
        const errorLines = lines
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => line.startsWith("!"))
          .flatMap(({ i }) => lines.slice(Math.max(0, i - 1), i + 4))
          .slice(0, 20);
        logTail = errorLines.length > 0
          ? errorLines.join("\n")
          : lines.slice(-30).join("\n");
        this.logger.error(`LaTeX error details:\n${logTail}`);
        this.logger.warn(`Temp directory preserved for debugging: ${tmpDir}`);
        // Don't delete temp dir on failure — helps debugging
        throw new Error(`LaTeX compilation failed: ${logTail.slice(0, 500)}`);
      } catch (innerError) {
        if (innerError instanceof Error && innerError.message.startsWith("LaTeX compilation failed:")) {
          throw innerError;
        }
        // If we can't read the log, clean up and rethrow original
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    } finally {
      // Only clean up on success — temp dir is preserved on failure for debugging
      if (await fs.access(pdfPath).then(() => true).catch(() => false)) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}
