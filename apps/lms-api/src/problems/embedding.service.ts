import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

@Injectable()
export class EmbeddingService {
  private client: OpenAI;

  constructor(private config: ConfigService) {
    this.client = new OpenAI({ apiKey: this.config.get("OPENAI_API_KEY") });
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  }
}
