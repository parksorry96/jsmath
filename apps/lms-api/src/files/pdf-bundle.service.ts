import { Injectable } from "@nestjs/common";
import { PDFDocument } from "pdf-lib";

@Injectable()
export class PdfBundleService {
  async mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
    if (buffers.length === 1) {
      return buffers[0];
    }

    const mergedDocument = await PDFDocument.create();

    for (const buffer of buffers) {
      const sourceDocument = await PDFDocument.load(buffer);
      const copiedPages = await mergedDocument.copyPages(
        sourceDocument,
        sourceDocument.getPageIndices(),
      );

      copiedPages.forEach((page) => mergedDocument.addPage(page));
    }

    return Buffer.from(await mergedDocument.save());
  }
}
