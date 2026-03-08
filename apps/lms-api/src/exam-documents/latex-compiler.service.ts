import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as ejs from "ejs";

const execFileAsync = promisify(execFile);

export interface CompileOptions {
  templateName: string;
  data: Record<string, unknown>;
}

@Injectable()
export class LatexCompilerService {
  private readonly logger = new Logger(LatexCompilerService.name);
  private readonly templateDir = path.join(__dirname, "templates");

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
      const texSource = ejs.render(templateStr, options.data);

      await fs.writeFile(texPath, texSource, "utf-8");

      // Run xelatex twice for cross-references
      for (let i = 0; i < 2; i++) {
        await execFileAsync(
          "xelatex",
          [
            "-interaction=nonstopmode",
            "-halt-on-error",
            `-output-directory=${tmpDir}`,
            texPath,
          ],
          { timeout: 60_000 },
        );
      }

      return await fs.readFile(pdfPath);
    } catch (error) {
      this.logger.error(`LaTeX compilation failed: ${error}`);
      try {
        const logPath = path.join(tmpDir, "document.log");
        const log = await fs.readFile(logPath, "utf-8");
        const lastLines = log.split("\n").slice(-30).join("\n");
        this.logger.error(`LaTeX log (last 30 lines):\n${lastLines}`);
      } catch {}
      throw error;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
