import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

@Injectable()
export class EmbeddingService {
  private client: OpenAI | null = null;

  constructor(private config: ConfigService) {}

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey =
        this.config.get("AI_API_KEY") ??
        this.config.get("OPENAI_API_KEY");
      if (!apiKey) {
        throw new Error("AI_API_KEY is not configured");
      }
      const baseURL =
        this.config.get("AI_API_BASE_URL") ?? "https://api.openai.com/v1";
      this.client = new OpenAI({ apiKey, baseURL });
    }
    return this.client;
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.getClient().embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  }
}
